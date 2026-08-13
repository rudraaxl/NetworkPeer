-- Close Phase 1-5 integrity gaps at the PostgreSQL authority layer. Application
-- services may provide friendlier errors, but cannot bypass these controls.

ALTER TABLE worker_profiles VALIDATE CONSTRAINT worker_profiles_verification_status_check;
ALTER TABLE worker_profiles VALIDATE CONSTRAINT worker_profiles_only_verified_available;
ALTER TABLE worker_profiles VALIDATE CONSTRAINT worker_profiles_location_wgs84_bounds;
ALTER TABLE jobs VALIDATE CONSTRAINT jobs_location_wgs84_bounds;
ALTER TABLE job_subtask_media VALIDATE CONSTRAINT job_subtask_media_s3_key_not_blank;
ALTER TABLE job_subtask_media VALIDATE CONSTRAINT job_subtask_media_s3_bucket_not_blank;
ALTER TABLE job_subtask_media VALIDATE CONSTRAINT job_subtask_media_checksum_sha256_format;
ALTER TABLE job_subtask_media VALIDATE CONSTRAINT job_subtask_media_s3_etag_not_blank;
ALTER TABLE job_subtask_media VALIDATE CONSTRAINT job_subtask_media_location_wgs84_bounds;
ALTER TABLE job_subtask_media VALIDATE CONSTRAINT job_subtask_media_pending_has_expiry;
ALTER TABLE job_subtask_media VALIDATE CONSTRAINT job_subtask_media_uploaded_has_timestamp;
ALTER TABLE job_subtask_media VALIDATE CONSTRAINT job_subtask_media_idempotency_key_not_blank;
ALTER TABLE job_subtask_media VALIDATE CONSTRAINT job_subtask_media_confirmed_has_version;
ALTER TABLE job_subtask_media VALIDATE CONSTRAINT job_subtask_media_confirmed_version_is_immutable;

-- Client request idempotency prevents a lost create response from posting an
-- otherwise identical second job. The fingerprint makes key reuse detectable.
ALTER TABLE jobs
  ADD COLUMN idempotency_key VARCHAR(255),
  ADD COLUMN idempotency_fingerprint CHAR(64);

ALTER TABLE jobs
  ADD CONSTRAINT jobs_idempotency_key_not_blank
    CHECK (idempotency_key IS NULL OR length(btrim(idempotency_key)) >= 8),
  ADD CONSTRAINT jobs_idempotency_fingerprint_format
    CHECK (
      idempotency_fingerprint IS NULL
      OR idempotency_fingerprint ~ '^[0-9a-f]{64}$'
    ),
  ADD CONSTRAINT jobs_idempotency_pair
    CHECK (
      (idempotency_key IS NULL AND idempotency_fingerprint IS NULL)
      OR (idempotency_key IS NOT NULL AND idempotency_fingerprint IS NOT NULL)
    );

CREATE UNIQUE INDEX jobs_client_idempotency_key_unique
  ON jobs (client_id, idempotency_key)
  WHERE idempotency_key IS NOT NULL;

CREATE INDEX idx_job_subtask_media_pending_expiry
  ON job_subtask_media (subtask_id, upload_expires_at)
  WHERE status = 'PENDING';

-- Worker discovery is based on a recently supplied profile location, not an
-- arbitrary coordinate submitted with every search request.
CREATE OR REPLACE FUNCTION update_worker_location(
  p_worker_id UUID,
  p_longitude DOUBLE PRECISION,
  p_latitude DOUBLE PRECISION
)
RETURNS TIMESTAMPTZ
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public, pg_temp
AS $$
DECLARE
  v_last_location_update TIMESTAMPTZ;
  v_updated_at TIMESTAMPTZ;
BEGIN
  IF p_longitude < -180 OR p_longitude > 180 OR p_latitude < -90 OR p_latitude > 90 THEN
    RAISE EXCEPTION 'Worker location is outside WGS84 bounds' USING ERRCODE = '22023';
  END IF;

  PERFORM 1
  FROM public.users AS u
  WHERE u.id = p_worker_id
    AND u.role = 'WORKER'
    AND u.is_active = TRUE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Worker is not active' USING ERRCODE = 'P0002';
  END IF;

  SELECT wp.last_location_update
  INTO v_last_location_update
  FROM public.worker_profiles AS wp
  WHERE wp.user_id = p_worker_id
    AND wp.verification_status = 'VERIFIED'
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Worker is not verified' USING ERRCODE = '55000';
  END IF;

  IF v_last_location_update IS NOT NULL
    AND v_last_location_update > NOW() - INTERVAL '15 seconds' THEN
    RAISE EXCEPTION 'Worker location was updated too recently' USING ERRCODE = '55000';
  END IF;

  UPDATE public.worker_profiles AS wp
  SET current_location = ST_SetSRID(ST_MakePoint(p_longitude, p_latitude), 4326),
      last_location_update = NOW(),
      updated_at = NOW()
  WHERE wp.user_id = p_worker_id
  RETURNING wp.last_location_update INTO v_updated_at;

  RETURN v_updated_at;
END;
$$;

-- A claim must use the worker's recent server-held location and cannot claim
-- a suspended client's job. Lock order remains profile then job.
CREATE OR REPLACE FUNCTION accept_job(p_job_id UUID, p_worker_id UUID)
RETURNS TABLE (job_id UUID, worker_id UUID, status job_status)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public, pg_temp
AS $$
DECLARE
  v_worker_available BOOLEAN;
  v_worker_verification_status TEXT;
  v_worker_location geometry;
  v_worker_location_updated_at TIMESTAMPTZ;
  v_worker_radius_km INTEGER;
  v_current_status job_status;
  v_assigned_worker UUID;
  v_client_id UUID;
  v_job_location geometry;
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM public.users
    WHERE id = p_worker_id AND is_active = TRUE AND role = 'WORKER'
  ) THEN
    RAISE EXCEPTION 'Worker % does not exist, is inactive, or is not a WORKER', p_worker_id
      USING ERRCODE = '22000';
  END IF;

  SELECT wp.is_available,
         wp.verification_status,
         wp.current_location,
         wp.last_location_update,
         wp.preferred_radius_km
  INTO v_worker_available,
       v_worker_verification_status,
       v_worker_location,
       v_worker_location_updated_at,
       v_worker_radius_km
  FROM public.worker_profiles AS wp
  WHERE wp.user_id = p_worker_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Worker % does not have a worker profile', p_worker_id USING ERRCODE = '22000';
  END IF;
  IF v_worker_verification_status <> 'VERIFIED' THEN
    RAISE EXCEPTION 'Worker % is not verified', p_worker_id USING ERRCODE = '22000';
  END IF;

  SELECT j.status, j.worker_id, j.client_id, j.location
  INTO v_current_status, v_assigned_worker, v_client_id, v_job_location
  FROM public.jobs AS j
  WHERE j.id = p_job_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Job % does not exist', p_job_id USING ERRCODE = '22000';
  END IF;

  -- A same-worker retry is safe even if their current location has since aged.
  IF v_current_status = 'ASSIGNED' AND v_assigned_worker = p_worker_id THEN
    RETURN QUERY SELECT j.id, j.worker_id, j.status FROM public.jobs AS j WHERE j.id = p_job_id;
    RETURN;
  END IF;

  IF v_worker_available IS NOT TRUE THEN
    RAISE EXCEPTION 'Worker % is currently unavailable', p_worker_id USING ERRCODE = '22000';
  END IF;
  IF v_current_status <> 'POSTED' THEN
    RAISE EXCEPTION 'Job % is not claimable; current status is %', p_job_id, v_current_status
      USING ERRCODE = '55000';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM public.users AS u
    WHERE u.id = v_client_id AND u.role = 'CLIENT' AND u.is_active = TRUE
  ) THEN
    RAISE EXCEPTION 'Job client is not active' USING ERRCODE = '55000';
  END IF;
  IF v_worker_location IS NULL
    OR v_worker_location_updated_at IS NULL
    OR v_worker_location_updated_at <= NOW() - INTERVAL '15 minutes' THEN
    RAISE EXCEPTION 'Worker location is missing or stale' USING ERRCODE = '22000';
  END IF;
  IF NOT ST_DWithin(
    v_job_location::geography,
    v_worker_location::geography,
    v_worker_radius_km * 1000
  ) THEN
    RAISE EXCEPTION 'Job is outside the worker preferred radius' USING ERRCODE = '22000';
  END IF;

  UPDATE public.jobs AS j
  SET status = 'ASSIGNED', worker_id = p_worker_id, updated_at = NOW()
  WHERE j.id = p_job_id;
  UPDATE public.worker_profiles AS wp
  SET is_available = FALSE, updated_at = NOW()
  WHERE wp.user_id = p_worker_id;

  RETURN QUERY SELECT j.id, j.worker_id, j.status FROM public.jobs AS j WHERE j.id = p_job_id;
END;
$$;

CREATE OR REPLACE FUNCTION cancel_client_job(
  p_job_id UUID,
  p_client_id UUID,
  p_reason TEXT
)
RETURNS TABLE (job_id UUID, status job_status)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public, pg_temp
AS $$
DECLARE
  v_status job_status;
  v_owner UUID;
BEGIN
  PERFORM 1 FROM public.users AS u
  WHERE u.id = p_client_id AND u.role = 'CLIENT' AND u.is_active = TRUE;
  IF NOT FOUND THEN
    RETURN;
  END IF;

  SELECT j.status, j.client_id INTO v_status, v_owner
  FROM public.jobs AS j WHERE j.id = p_job_id FOR UPDATE;
  IF NOT FOUND OR v_owner IS DISTINCT FROM p_client_id OR v_status <> 'POSTED' THEN
    RETURN;
  END IF;

  UPDATE public.jobs AS j
  SET status = 'CANCELLED',
      cancelled_at = NOW(),
      cancellation_reason = NULLIF(btrim(p_reason), ''),
      updated_at = NOW()
  WHERE j.id = p_job_id;

  RETURN QUERY SELECT j.id, j.status FROM public.jobs AS j WHERE j.id = p_job_id;
END;
$$;

-- Normal client resolution is intentionally separate from administrative
-- override logic. Approval, completion, and disputes remain canonical state
-- transitions and completion releases a worker only after active-work checks.
CREATE OR REPLACE FUNCTION resolve_client_job(
  p_job_id UUID,
  p_client_id UUID,
  p_action VARCHAR
)
RETURNS TABLE (job_id UUID, status job_status)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public, pg_temp
AS $$
DECLARE
  v_status job_status;
  v_owner UUID;
  v_worker_id UUID;
  v_action VARCHAR := upper(btrim(p_action));
BEGIN
  PERFORM 1 FROM public.users AS u
  WHERE u.id = p_client_id AND u.role = 'CLIENT' AND u.is_active = TRUE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Client is not active' USING ERRCODE = 'P0002';
  END IF;

  -- Read the worker first, lock its profile, then lock the job. This keeps the
  -- profile -> job order used by worker status/evidence functions.
  SELECT j.worker_id INTO v_worker_id FROM public.jobs AS j WHERE j.id = p_job_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Job not found' USING ERRCODE = 'P0002';
  END IF;
  IF v_worker_id IS NOT NULL THEN
    PERFORM 1 FROM public.worker_profiles AS wp WHERE wp.user_id = v_worker_id FOR UPDATE;
  END IF;

  SELECT j.status, j.client_id, j.worker_id INTO v_status, v_owner, v_worker_id
  FROM public.jobs AS j WHERE j.id = p_job_id FOR UPDATE;
  IF v_owner IS DISTINCT FROM p_client_id THEN
    RAISE EXCEPTION 'Job not found' USING ERRCODE = 'P0002';
  END IF;

  IF v_action = 'APPROVE' THEN
    IF v_status <> 'SUBMITTED' THEN
      RAISE EXCEPTION 'Job cannot be approved in its current state' USING ERRCODE = '55000';
    END IF;
    UPDATE public.jobs AS j SET status = 'APPROVED', updated_at = NOW() WHERE j.id = p_job_id;
  ELSIF v_action = 'COMPLETE' THEN
    IF v_status <> 'APPROVED' THEN
      RAISE EXCEPTION 'Job cannot be completed in its current state' USING ERRCODE = '55000';
    END IF;
    UPDATE public.jobs AS j
    SET status = 'COMPLETED', completed_at = NOW(), updated_at = NOW()
    WHERE j.id = p_job_id;

    UPDATE public.worker_profiles AS wp
    SET is_available = TRUE, updated_at = NOW()
    WHERE wp.user_id = v_worker_id
      AND wp.verification_status = 'VERIFIED'
      AND EXISTS (
        SELECT 1 FROM public.users AS u WHERE u.id = v_worker_id AND u.is_active = TRUE
      )
      AND NOT EXISTS (
        SELECT 1 FROM public.jobs AS other_job
        WHERE other_job.worker_id = v_worker_id
          AND other_job.status IN ('ASSIGNED', 'EN_ROUTE', 'AT_LOCATION', 'IN_PROGRESS', 'SUBMITTED', 'APPROVED', 'DISPUTED')
      );
  ELSIF v_action = 'DISPUTE' THEN
    IF v_status NOT IN ('ASSIGNED', 'EN_ROUTE', 'AT_LOCATION', 'IN_PROGRESS', 'SUBMITTED', 'APPROVED') THEN
      RAISE EXCEPTION 'Job cannot be disputed in its current state' USING ERRCODE = '55000';
    END IF;
    UPDATE public.jobs AS j SET status = 'DISPUTED', updated_at = NOW() WHERE j.id = p_job_id;
  ELSE
    RAISE EXCEPTION 'Unsupported client resolution action' USING ERRCODE = '22023';
  END IF;

  RETURN QUERY SELECT j.id, j.status FROM public.jobs AS j WHERE j.id = p_job_id;
END;
$$;

CREATE OR REPLACE FUNCTION submit_job_with_evidence(p_job_id UUID, p_worker_id UUID)
RETURNS TABLE (job_id UUID, status job_status)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public, pg_temp
AS $$
DECLARE
  v_status job_status;
  v_assigned_worker UUID;
BEGIN
  PERFORM 1
  FROM public.users AS u
  JOIN public.worker_profiles AS wp ON wp.user_id = u.id
  WHERE u.id = p_worker_id
    AND u.is_active = TRUE
    AND u.role = 'WORKER'
    AND wp.verification_status = 'VERIFIED'
  FOR UPDATE OF wp;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Job not found' USING ERRCODE = 'P0002';
  END IF;

  SELECT j.status, j.worker_id INTO v_status, v_assigned_worker
  FROM public.jobs AS j WHERE j.id = p_job_id FOR UPDATE;
  IF NOT FOUND OR v_assigned_worker IS DISTINCT FROM p_worker_id THEN
    RAISE EXCEPTION 'Job not found' USING ERRCODE = 'P0002';
  END IF;
  IF v_status = 'SUBMITTED' THEN
    RETURN QUERY SELECT j.id, j.status FROM public.jobs AS j WHERE j.id = p_job_id;
    RETURN;
  END IF;
  IF v_status <> 'IN_PROGRESS' THEN
    RAISE EXCEPTION 'Job cannot be submitted in its current state' USING ERRCODE = '55000';
  END IF;
  IF EXISTS (
    SELECT 1 FROM public.job_subtasks AS s
    WHERE s.job_id = p_job_id
      AND s.is_required = TRUE
      AND (
        s.status <> 'COMPLETED'
        OR NOT EXISTS (
          SELECT 1 FROM public.job_subtask_media AS m
          WHERE m.job_id = s.job_id
            AND m.subtask_id = s.id
            AND m.status IN ('UPLOADED', 'VERIFIED')
            AND m.checksum_sha256 IS NOT NULL
            AND m.s3_etag IS NOT NULL
            AND m.s3_version_id IS NOT NULL
            AND lower(btrim(m.s3_version_id)) <> 'null'
        )
      )
  ) THEN
    RAISE EXCEPTION 'Required subtask evidence is incomplete' USING ERRCODE = '23514';
  END IF;

  UPDATE public.jobs AS j SET status = 'SUBMITTED', updated_at = NOW() WHERE j.id = p_job_id;
  RETURN QUERY SELECT j.id, j.status FROM public.jobs AS j WHERE j.id = p_job_id;
END;
$$;

CREATE OR REPLACE FUNCTION advance_worker_job_status(
  p_job_id UUID,
  p_worker_id UUID,
  p_target_status job_status
)
RETURNS TABLE (job_id UUID, status job_status)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public, pg_temp
AS $$
DECLARE
  v_status job_status;
  v_assigned_worker UUID;
BEGIN
  PERFORM 1
  FROM public.users AS u
  JOIN public.worker_profiles AS wp ON wp.user_id = u.id
  WHERE u.id = p_worker_id
    AND u.is_active = TRUE
    AND u.role = 'WORKER'
    AND wp.verification_status = 'VERIFIED'
  FOR UPDATE OF wp;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Job not found' USING ERRCODE = 'P0002';
  END IF;

  SELECT j.status, j.worker_id INTO v_status, v_assigned_worker
  FROM public.jobs AS j WHERE j.id = p_job_id FOR UPDATE;
  IF NOT FOUND OR v_assigned_worker IS DISTINCT FROM p_worker_id THEN
    RAISE EXCEPTION 'Job not found' USING ERRCODE = 'P0002';
  END IF;
  IF v_status = p_target_status THEN
    RETURN QUERY SELECT j.id, j.status FROM public.jobs AS j WHERE j.id = p_job_id;
    RETURN;
  END IF;
  IF NOT (
    (v_status = 'ASSIGNED' AND p_target_status = 'EN_ROUTE')
    OR (v_status = 'EN_ROUTE' AND p_target_status = 'AT_LOCATION')
    OR (v_status = 'AT_LOCATION' AND p_target_status = 'IN_PROGRESS')
  ) THEN
    RAISE EXCEPTION 'Job cannot advance to the requested status' USING ERRCODE = '55000';
  END IF;

  UPDATE public.jobs AS j
  SET status = p_target_status,
      started_at = CASE WHEN p_target_status = 'IN_PROGRESS' THEN NOW() ELSE j.started_at END,
      updated_at = NOW()
  WHERE j.id = p_job_id;
  RETURN QUERY SELECT j.id, j.status FROM public.jobs AS j WHERE j.id = p_job_id;
END;
$$;

CREATE OR REPLACE FUNCTION confirm_job_subtask_media_upload(
  p_media_id UUID,
  p_worker_id UUID,
  p_file_size_bytes BIGINT,
  p_mime_type VARCHAR,
  p_checksum_sha256 VARCHAR,
  p_s3_etag TEXT,
  p_s3_version_id TEXT
)
RETURNS TABLE (
  media_id UUID,
  subtask_id UUID,
  job_id UUID,
  status media_status,
  uploaded_at TIMESTAMPTZ
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public, pg_temp
AS $$
DECLARE
  v_status media_status;
  v_assigned_worker UUID;
  v_job_status job_status;
  v_subtask_status subtask_status;
  v_expected_file_size BIGINT;
  v_expected_mime_type VARCHAR;
  v_expected_checksum VARCHAR;
  v_upload_expires_at TIMESTAMPTZ;
  v_subtask_id UUID;
  v_job_id UUID;
BEGIN
  PERFORM 1
  FROM public.users AS u
  JOIN public.worker_profiles AS wp ON wp.user_id = u.id
  WHERE u.id = p_worker_id
    AND u.is_active = TRUE
    AND u.role = 'WORKER'
    AND wp.verification_status = 'VERIFIED'
  FOR UPDATE OF wp;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Evidence not found' USING ERRCODE = 'P0002';
  END IF;

  SELECT m.status, j.worker_id, j.status, s.status, m.file_size_bytes,
         m.mime_type, m.checksum_sha256, m.upload_expires_at, m.subtask_id, m.job_id
  INTO v_status, v_assigned_worker, v_job_status, v_subtask_status, v_expected_file_size,
       v_expected_mime_type, v_expected_checksum, v_upload_expires_at, v_subtask_id, v_job_id
  FROM public.job_subtask_media AS m
  JOIN public.jobs AS j ON j.id = m.job_id
  JOIN public.job_subtasks AS s ON s.id = m.subtask_id AND s.job_id = m.job_id
  WHERE m.id = p_media_id
  FOR UPDATE OF m, j, s;
  IF NOT FOUND OR v_assigned_worker IS DISTINCT FROM p_worker_id THEN
    RAISE EXCEPTION 'Evidence not found' USING ERRCODE = 'P0002';
  END IF;
  IF v_status = 'UPLOADED' THEN
    RETURN QUERY SELECT m.id, m.subtask_id, m.job_id, m.status, m.uploaded_at
      FROM public.job_subtask_media AS m WHERE m.id = p_media_id;
    RETURN;
  END IF;
  IF v_status <> 'PENDING' OR v_job_status <> 'IN_PROGRESS' THEN
    RAISE EXCEPTION 'Evidence cannot be confirmed in its current state' USING ERRCODE = '55000';
  END IF;
  IF v_upload_expires_at <= NOW() THEN
    RAISE EXCEPTION 'Evidence upload reservation has expired' USING ERRCODE = '22023';
  END IF;
  IF v_expected_file_size IS DISTINCT FROM p_file_size_bytes
    OR lower(btrim(v_expected_mime_type)) IS DISTINCT FROM lower(btrim(p_mime_type))
    OR v_expected_checksum IS DISTINCT FROM p_checksum_sha256
    OR p_s3_etag IS NULL OR length(btrim(p_s3_etag)) = 0
    OR p_s3_version_id IS NULL OR length(btrim(p_s3_version_id)) = 0
    OR lower(btrim(p_s3_version_id)) = 'null' THEN
    RAISE EXCEPTION 'Stored object does not match its evidence reservation' USING ERRCODE = '23514';
  END IF;
  IF v_subtask_status = 'SKIPPED' THEN
    RAISE EXCEPTION 'Skipped subtask cannot receive evidence' USING ERRCODE = '55000';
  END IF;

  UPDATE public.job_subtask_media AS m
  SET status = 'UPLOADED', uploaded_at = NOW(), s3_etag = p_s3_etag, s3_version_id = p_s3_version_id
  WHERE m.id = p_media_id;
  UPDATE public.job_subtasks AS s
  SET status = 'COMPLETED', completed_at = NOW(), updated_at = NOW()
  WHERE s.id = v_subtask_id AND s.job_id = v_job_id AND s.status <> 'COMPLETED';

  RETURN QUERY SELECT m.id, m.subtask_id, m.job_id, m.status, m.uploaded_at
    FROM public.job_subtask_media AS m WHERE m.id = p_media_id;
END;
$$;

-- Different idempotency keys cannot create an unbounded number of active S3
-- reservations for a single checklist item. Expired pending rows are removed;
-- their pending S3 tag leaves physical objects to the bucket lifecycle policy.
CREATE OR REPLACE FUNCTION enforce_pending_media_reservation_limit()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = pg_catalog, public, pg_temp
AS $$
DECLARE
  v_pending_count INTEGER;
BEGIN
  IF TG_OP <> 'INSERT' OR NEW.status <> 'PENDING' THEN
    RETURN NEW;
  END IF;

  PERFORM pg_advisory_xact_lock(hashtextextended(NEW.subtask_id::text, 41));
  DELETE FROM public.job_subtask_media AS expired
  WHERE expired.subtask_id = NEW.subtask_id
    AND expired.worker_id = NEW.worker_id
    AND expired.status = 'PENDING'
    AND expired.upload_expires_at <= NOW();

  SELECT COUNT(*)::int INTO v_pending_count
  FROM public.job_subtask_media AS m
  WHERE m.subtask_id = NEW.subtask_id
    AND m.worker_id = NEW.worker_id
    AND m.status = 'PENDING'
    AND m.upload_expires_at > NOW();

  IF v_pending_count >= 5 THEN
    RAISE EXCEPTION 'Too many pending evidence reservations for this subtask'
      USING ERRCODE = '22000';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER enforce_pending_media_reservation_limit
  BEFORE INSERT ON job_subtask_media
  FOR EACH ROW EXECUTE FUNCTION enforce_pending_media_reservation_limit();

REVOKE EXECUTE ON FUNCTION update_worker_location(UUID, DOUBLE PRECISION, DOUBLE PRECISION) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION cancel_client_job(UUID, UUID, TEXT) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION resolve_client_job(UUID, UUID, VARCHAR) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION accept_job(UUID, UUID) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION submit_job_with_evidence(UUID, UUID) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION advance_worker_job_status(UUID, UUID, job_status) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION confirm_job_subtask_media_upload(UUID, UUID, BIGINT, VARCHAR, VARCHAR, TEXT, TEXT) FROM PUBLIC;
