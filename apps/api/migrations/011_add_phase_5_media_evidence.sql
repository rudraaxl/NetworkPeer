-- Phase 5 turns evidence into a server-authorized reservation followed by an
-- object-store confirmation. PENDING rows never satisfy job submission.
DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM job_subtask_media
    GROUP BY s3_bucket, s3_key
    HAVING COUNT(*) > 1
  ) THEN
    RAISE EXCEPTION 'Cannot add unique S3 object constraint: resolve duplicate bucket/key media rows first'
      USING ERRCODE = '23514';
  END IF;
END;
$$;

ALTER TABLE job_subtask_media
  ALTER COLUMN uploaded_at DROP NOT NULL,
  ALTER COLUMN uploaded_at DROP DEFAULT,
  ADD COLUMN upload_expires_at TIMESTAMPTZ,
  ADD COLUMN checksum_sha256 VARCHAR(64),
  ADD COLUMN s3_etag TEXT,
  ADD COLUMN s3_version_id TEXT,
  ADD COLUMN idempotency_key VARCHAR(255);

-- PENDING rows created before Phase 5 were never confirmed by object storage.
-- Expire them rather than letting legacy rows satisfy the new workflow.
UPDATE job_subtask_media
SET uploaded_at = NULL,
    upload_expires_at = NOW() - INTERVAL '1 second'
WHERE status = 'PENDING';

ALTER TABLE job_subtask_media
  ADD CONSTRAINT job_subtask_media_s3_key_not_blank
    CHECK (length(btrim(s3_key)) > 0) NOT VALID,
  ADD CONSTRAINT job_subtask_media_s3_bucket_not_blank
    CHECK (length(btrim(s3_bucket)) > 0) NOT VALID,
  ADD CONSTRAINT job_subtask_media_checksum_sha256_format
    CHECK (checksum_sha256 IS NULL OR checksum_sha256 ~ '^[0-9a-f]{64}$') NOT VALID,
  ADD CONSTRAINT job_subtask_media_s3_etag_not_blank
    CHECK (s3_etag IS NULL OR length(btrim(s3_etag)) > 0) NOT VALID,
  ADD CONSTRAINT job_subtask_media_location_wgs84_bounds
    CHECK (
      location IS NULL
      OR (
        NOT ST_IsEmpty(location)
        AND ST_X(location) BETWEEN -180 AND 180
        AND ST_Y(location) BETWEEN -90 AND 90
      )
    ) NOT VALID,
  ADD CONSTRAINT job_subtask_media_pending_has_expiry
    CHECK (
      status <> 'PENDING'
      OR (upload_expires_at IS NOT NULL AND uploaded_at IS NULL)
    ) NOT VALID,
  ADD CONSTRAINT job_subtask_media_uploaded_has_timestamp
    CHECK (status = 'PENDING' OR uploaded_at IS NOT NULL) NOT VALID,
  ADD CONSTRAINT job_subtask_media_idempotency_key_not_blank
    CHECK (idempotency_key IS NULL OR length(btrim(idempotency_key)) > 0) NOT VALID,
  ADD CONSTRAINT job_subtask_media_s3_object_key_unique
    UNIQUE (s3_bucket, s3_key);

CREATE UNIQUE INDEX job_subtask_media_worker_idempotency_key_unique
  ON job_subtask_media (worker_id, idempotency_key)
  WHERE idempotency_key IS NOT NULL;

CREATE INDEX idx_job_subtask_media_submission_check
  ON job_subtask_media (job_id, subtask_id, status);

DROP TRIGGER IF EXISTS enforce_job_subtask_media_worker ON job_subtask_media;

CREATE OR REPLACE FUNCTION enforce_job_subtask_media_workflow()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
DECLARE
  v_assigned_worker UUID;
  v_job_status job_status;
BEGIN
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
      OR NEW.upload_expires_at IS DISTINCT FROM OLD.upload_expires_at
      OR NEW.verification_notes IS DISTINCT FROM OLD.verification_notes THEN
      RAISE EXCEPTION 'Evidence may only be confirmed while work is in progress'
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

CREATE TRIGGER enforce_job_subtask_media_workflow
  BEFORE INSERT OR UPDATE ON job_subtask_media
  FOR EACH ROW EXECUTE FUNCTION enforce_job_subtask_media_workflow();

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
    OR length(btrim(p_s3_etag)) = 0 THEN
    RAISE EXCEPTION 'Stored object does not match its evidence reservation'
      USING ERRCODE = '23514';
  END IF;

  IF v_subtask_status = 'SKIPPED' THEN
    RAISE EXCEPTION 'Skipped subtask cannot receive evidence'
      USING ERRCODE = '55000';
  END IF;

  UPDATE public.job_subtask_media
  SET status = 'UPLOADED',
      uploaded_at = NOW(),
      s3_etag = p_s3_etag,
      s3_version_id = p_s3_version_id
  WHERE id = p_media_id;

  UPDATE public.job_subtasks
  SET status = 'COMPLETED',
      completed_at = NOW(),
      updated_at = NOW()
  WHERE id = v_subtask_id
    AND job_id = v_job_id
    AND status <> 'COMPLETED';

  RETURN QUERY
    SELECT m.id, m.subtask_id, m.job_id, m.status, m.uploaded_at
    FROM public.job_subtask_media m
    WHERE m.id = p_media_id;
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
  SELECT status, worker_id
  INTO v_status, v_assigned_worker
  FROM public.jobs
  WHERE id = p_job_id
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
        )
      )
  ) THEN
    RAISE EXCEPTION 'Required subtask evidence is incomplete'
      USING ERRCODE = '23514';
  END IF;

  UPDATE public.jobs
  SET status = 'SUBMITTED',
      updated_at = NOW()
  WHERE id = p_job_id;

  RETURN QUERY
    SELECT j.id, j.status
    FROM public.jobs j
    WHERE j.id = p_job_id;
END;
$$;

COMMENT ON FUNCTION confirm_job_subtask_media_upload(UUID, UUID, BIGINT, VARCHAR, VARCHAR, TEXT, TEXT) IS
  'Atomically confirms a storage-validated evidence reservation and completes its subtask.';

COMMENT ON FUNCTION submit_job_with_evidence(UUID, UUID) IS
  'Atomically transitions an in-progress job to SUBMITTED only after required evidence is uploaded.';
