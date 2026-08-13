-- Confirmation must pin a versioned object. A later overwrite of the key then
-- cannot alter the evidence version recorded in PostgreSQL.
ALTER TABLE job_subtask_media
  ADD CONSTRAINT job_subtask_media_confirmed_has_version
  CHECK (
    status = 'PENDING'
    OR (s3_version_id IS NOT NULL AND length(btrim(s3_version_id)) > 0)
  ) NOT VALID;

CREATE OR REPLACE FUNCTION enforce_job_subtask_media_workflow()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
DECLARE
  v_worker_verification_status VARCHAR;
  v_assigned_worker UUID;
  v_job_status job_status;
BEGIN
  -- Keep the profile -> job lock order used by all worker work functions.
  SELECT verification_status
  INTO v_worker_verification_status
  FROM public.worker_profiles
  WHERE user_id = NEW.worker_id
  FOR KEY SHARE;

  IF NOT FOUND OR v_worker_verification_status <> 'VERIFIED' THEN
    RAISE EXCEPTION 'Evidence requires a verified worker'
      USING ERRCODE = '23514';
  END IF;

  SELECT worker_id, status
  INTO v_assigned_worker, v_job_status
  FROM public.jobs
  WHERE id = NEW.job_id
  FOR KEY SHARE;

  IF NOT FOUND OR v_assigned_worker IS NULL OR NEW.worker_id <> v_assigned_worker THEN
    RAISE EXCEPTION 'Evidence must belong to the worker assigned to its job'
      USING ERRCODE = '23514';
  END IF;

  IF TG_OP = 'INSERT' THEN
    IF v_job_status <> 'IN_PROGRESS'
      OR NEW.status <> 'PENDING'
      OR NEW.uploaded_at IS NOT NULL
      OR NEW.upload_expires_at IS NULL
      OR NEW.checksum_sha256 IS NULL THEN
      RAISE EXCEPTION 'Evidence reservations require an in-progress job and pending upload state'
        USING ERRCODE = '23514';
    END IF;
    RETURN NEW;
  END IF;

  IF NEW.subtask_id IS DISTINCT FROM OLD.subtask_id
    OR NEW.job_id IS DISTINCT FROM OLD.job_id
    OR NEW.worker_id IS DISTINCT FROM OLD.worker_id
    OR NEW.s3_key IS DISTINCT FROM OLD.s3_key
    OR NEW.s3_bucket IS DISTINCT FROM OLD.s3_bucket
    OR NEW.media_type IS DISTINCT FROM OLD.media_type
    OR NEW.mime_type IS DISTINCT FROM OLD.mime_type
    OR NEW.file_size_bytes IS DISTINCT FROM OLD.file_size_bytes
    OR NEW.width IS DISTINCT FROM OLD.width
    OR NEW.height IS DISTINCT FROM OLD.height
    OR NEW.duration_seconds IS DISTINCT FROM OLD.duration_seconds
    OR NEW.location IS DISTINCT FROM OLD.location
    OR NEW.captured_at IS DISTINCT FROM OLD.captured_at
    OR NEW.checksum_sha256 IS DISTINCT FROM OLD.checksum_sha256
    OR NEW.idempotency_key IS DISTINCT FROM OLD.idempotency_key
    OR NEW.metadata IS DISTINCT FROM OLD.metadata THEN
    RAISE EXCEPTION 'Evidence reservation fields are immutable'
      USING ERRCODE = '23514';
  END IF;

  IF OLD.status = 'PENDING' AND NEW.status = 'PENDING' THEN
    IF v_job_status <> 'IN_PROGRESS'
      OR NEW.uploaded_at IS DISTINCT FROM OLD.uploaded_at
      OR NEW.s3_etag IS DISTINCT FROM OLD.s3_etag
      OR NEW.s3_version_id IS DISTINCT FROM OLD.s3_version_id
      OR NEW.verification_notes IS DISTINCT FROM OLD.verification_notes THEN
      RAISE EXCEPTION 'Only an in-progress pending reservation expiry may be renewed'
        USING ERRCODE = '23514';
    END IF;
    RETURN NEW;
  END IF;

  IF OLD.status = 'PENDING' AND NEW.status = 'UPLOADED' THEN
    IF v_job_status <> 'IN_PROGRESS'
      OR NEW.uploaded_at IS NULL
      OR NEW.s3_etag IS NULL
      OR NEW.s3_version_id IS NULL
      OR length(btrim(NEW.s3_version_id)) = 0
      OR NEW.upload_expires_at IS DISTINCT FROM OLD.upload_expires_at
      OR NEW.verification_notes IS DISTINCT FROM OLD.verification_notes THEN
      RAISE EXCEPTION 'Evidence may only be confirmed while work is in progress with a versioned object'
        USING ERRCODE = '23514';
    END IF;
    RETURN NEW;
  END IF;

  IF OLD.status = 'UPLOADED' AND NEW.status IN ('VERIFIED', 'REJECTED') THEN
    IF NEW.uploaded_at IS DISTINCT FROM OLD.uploaded_at
      OR NEW.upload_expires_at IS DISTINCT FROM OLD.upload_expires_at
      OR NEW.s3_etag IS DISTINCT FROM OLD.s3_etag
      OR NEW.s3_version_id IS DISTINCT FROM OLD.s3_version_id THEN
      RAISE EXCEPTION 'Verified evidence storage metadata is immutable'
        USING ERRCODE = '23514';
    END IF;
    RETURN NEW;
  END IF;

  RAISE EXCEPTION 'Invalid evidence status transition: % -> %', OLD.status, NEW.status
    USING ERRCODE = '23514';
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
SET search_path = pg_catalog, public
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
  FROM public.worker_profiles
  WHERE user_id = p_worker_id
    AND verification_status = 'VERIFIED'
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Evidence not found'
      USING ERRCODE = 'P0002';
  END IF;

  SELECT
    m.status,
    j.worker_id,
    j.status,
    s.status,
    m.file_size_bytes,
    m.mime_type,
    m.checksum_sha256,
    m.upload_expires_at,
    m.subtask_id,
    m.job_id
  INTO
    v_status,
    v_assigned_worker,
    v_job_status,
    v_subtask_status,
    v_expected_file_size,
    v_expected_mime_type,
    v_expected_checksum,
    v_upload_expires_at,
    v_subtask_id,
    v_job_id
  FROM public.job_subtask_media m
  JOIN public.jobs j ON j.id = m.job_id
  JOIN public.job_subtasks s ON s.id = m.subtask_id AND s.job_id = m.job_id
  WHERE m.id = p_media_id
  FOR UPDATE OF m, j, s;

  IF NOT FOUND OR v_assigned_worker IS DISTINCT FROM p_worker_id THEN
    RAISE EXCEPTION 'Evidence not found'
      USING ERRCODE = 'P0002';
  END IF;

  IF v_status = 'UPLOADED' THEN
    RETURN QUERY
      SELECT m.id, m.subtask_id, m.job_id, m.status, m.uploaded_at
      FROM public.job_subtask_media m
      WHERE m.id = p_media_id;
    RETURN;
  END IF;

  IF v_status <> 'PENDING' OR v_job_status <> 'IN_PROGRESS' THEN
    RAISE EXCEPTION 'Evidence cannot be confirmed in its current state'
      USING ERRCODE = '55000';
  END IF;

  IF v_upload_expires_at <= NOW() THEN
    RAISE EXCEPTION 'Evidence upload reservation has expired'
      USING ERRCODE = '22023';
  END IF;

  IF v_expected_file_size IS DISTINCT FROM p_file_size_bytes
    OR lower(btrim(v_expected_mime_type)) IS DISTINCT FROM lower(btrim(p_mime_type))
    OR v_expected_checksum IS DISTINCT FROM p_checksum_sha256
    OR p_s3_etag IS NULL
    OR length(btrim(p_s3_etag)) = 0
    OR p_s3_version_id IS NULL
    OR length(btrim(p_s3_version_id)) = 0 THEN
    RAISE EXCEPTION 'Stored object does not match its evidence reservation'
      USING ERRCODE = '23514';
  END IF;

  IF v_subtask_status = 'SKIPPED' THEN
    RAISE EXCEPTION 'Skipped subtask cannot receive evidence'
      USING ERRCODE = '55000';
  END IF;

  UPDATE public.job_subtask_media AS m
  SET status = 'UPLOADED',
      uploaded_at = NOW(),
      s3_etag = p_s3_etag,
      s3_version_id = p_s3_version_id
  WHERE m.id = p_media_id;

  UPDATE public.job_subtasks AS s
  SET status = 'COMPLETED',
      completed_at = NOW(),
      updated_at = NOW()
  WHERE s.id = v_subtask_id
    AND s.job_id = v_job_id
    AND s.status <> 'COMPLETED';

  RETURN QUERY
    SELECT m.id, m.subtask_id, m.job_id, m.status, m.uploaded_at
    FROM public.job_subtask_media m
    WHERE m.id = p_media_id;
END;
$$;

CREATE OR REPLACE FUNCTION enforce_job_submission_evidence()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  IF OLD.status = 'IN_PROGRESS' AND NEW.status = 'SUBMITTED' AND EXISTS (
    SELECT 1
    FROM public.job_subtasks s
    WHERE s.job_id = NEW.id
      AND s.is_required = TRUE
      AND (
        s.status <> 'COMPLETED'
        OR NOT EXISTS (
          SELECT 1
          FROM public.job_subtask_media m
          WHERE m.job_id = s.job_id
            AND m.subtask_id = s.id
            AND m.status IN ('UPLOADED', 'VERIFIED')
            AND m.checksum_sha256 IS NOT NULL
            AND m.s3_etag IS NOT NULL
            AND m.s3_version_id IS NOT NULL
        )
      )
  ) THEN
    RAISE EXCEPTION 'Required subtask evidence is incomplete'
      USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION submit_job_with_evidence(p_job_id UUID, p_worker_id UUID)
RETURNS TABLE (job_id UUID, status job_status)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  v_status job_status;
  v_assigned_worker UUID;
BEGIN
  PERFORM 1
  FROM public.worker_profiles
  WHERE user_id = p_worker_id
    AND verification_status = 'VERIFIED'
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Job not found'
      USING ERRCODE = 'P0002';
  END IF;

  SELECT j.status, j.worker_id
  INTO v_status, v_assigned_worker
  FROM public.jobs j
  WHERE j.id = p_job_id
  FOR UPDATE;

  IF NOT FOUND OR v_assigned_worker IS DISTINCT FROM p_worker_id THEN
    RAISE EXCEPTION 'Job not found'
      USING ERRCODE = 'P0002';
  END IF;

  IF v_status = 'SUBMITTED' THEN
    RETURN QUERY
      SELECT j.id, j.status
      FROM public.jobs j
      WHERE j.id = p_job_id;
    RETURN;
  END IF;

  IF v_status <> 'IN_PROGRESS' THEN
    RAISE EXCEPTION 'Job cannot be submitted in its current state'
      USING ERRCODE = '55000';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM public.job_subtasks s
    WHERE s.job_id = p_job_id
      AND s.is_required = TRUE
      AND (
        s.status <> 'COMPLETED'
        OR NOT EXISTS (
          SELECT 1
          FROM public.job_subtask_media m
          WHERE m.job_id = s.job_id
            AND m.subtask_id = s.id
            AND m.status IN ('UPLOADED', 'VERIFIED')
            AND m.checksum_sha256 IS NOT NULL
            AND m.s3_etag IS NOT NULL
            AND m.s3_version_id IS NOT NULL
        )
      )
  ) THEN
    RAISE EXCEPTION 'Required subtask evidence is incomplete'
      USING ERRCODE = '23514';
  END IF;

  UPDATE public.jobs AS j
  SET status = 'SUBMITTED',
      updated_at = NOW()
  WHERE j.id = p_job_id;

  RETURN QUERY
    SELECT j.id, j.status
    FROM public.jobs j
    WHERE j.id = p_job_id;
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
SET search_path = pg_catalog, public
AS $$
DECLARE
  v_status job_status;
  v_assigned_worker UUID;
BEGIN
  PERFORM 1
  FROM public.worker_profiles
  WHERE user_id = p_worker_id
    AND verification_status = 'VERIFIED'
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Job not found'
      USING ERRCODE = 'P0002';
  END IF;

  SELECT j.status, j.worker_id
  INTO v_status, v_assigned_worker
  FROM public.jobs j
  WHERE j.id = p_job_id
  FOR UPDATE;

  IF NOT FOUND OR v_assigned_worker IS DISTINCT FROM p_worker_id THEN
    RAISE EXCEPTION 'Job not found'
      USING ERRCODE = 'P0002';
  END IF;

  IF v_status = p_target_status THEN
    RETURN QUERY
      SELECT j.id, j.status
      FROM public.jobs j
      WHERE j.id = p_job_id;
    RETURN;
  END IF;

  IF NOT (
    (v_status = 'ASSIGNED' AND p_target_status = 'EN_ROUTE')
    OR (v_status = 'EN_ROUTE' AND p_target_status = 'AT_LOCATION')
    OR (v_status = 'AT_LOCATION' AND p_target_status = 'IN_PROGRESS')
  ) THEN
    RAISE EXCEPTION 'Job cannot advance to the requested status'
      USING ERRCODE = '55000';
  END IF;

  UPDATE public.jobs AS j
  SET status = p_target_status,
      started_at = CASE WHEN p_target_status = 'IN_PROGRESS' THEN NOW() ELSE j.started_at END,
      updated_at = NOW()
  WHERE j.id = p_job_id;

  RETURN QUERY
    SELECT j.id, j.status
    FROM public.jobs j
    WHERE j.id = p_job_id;
END;
$$;

REVOKE EXECUTE ON FUNCTION accept_job(UUID, UUID) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION set_worker_verification(UUID, VARCHAR, BOOLEAN) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION confirm_job_subtask_media_upload(UUID, UUID, BIGINT, VARCHAR, VARCHAR, TEXT, TEXT) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION submit_job_with_evidence(UUID, UUID) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION advance_worker_job_status(UUID, UUID, job_status) FROM PUBLIC;

COMMENT ON FUNCTION advance_worker_job_status(UUID, UUID, job_status) IS
  'Advances an assigned worker job one permitted lifecycle step with profile-first locking.';
