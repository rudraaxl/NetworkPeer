-- A version ID of literal "null" is emitted by S3 when bucket versioning is
-- suspended. It is mutable and therefore cannot be accepted as evidence.
ALTER TABLE job_subtask_media
  ADD CONSTRAINT job_subtask_media_confirmed_version_is_immutable
  CHECK (
    status = 'PENDING'
    OR lower(btrim(s3_version_id)) <> 'null'
  ) NOT VALID;

CREATE OR REPLACE FUNCTION enforce_job_submission_evidence()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  IF OLD.status = 'IN_PROGRESS' AND NEW.status = 'SUBMITTED' AND EXISTS (
    SELECT 1
    FROM public.job_subtasks AS s
    WHERE s.job_id = NEW.id
      AND s.is_required = TRUE
      AND (
        s.status <> 'COMPLETED'
        OR NOT EXISTS (
          SELECT 1
          FROM public.job_subtask_media AS m
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
  RETURN NEW;
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
  FROM public.worker_profiles
  WHERE user_id = p_worker_id
    AND verification_status = 'VERIFIED'
  FOR UPDATE;

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
    RETURN QUERY
      SELECT m.id, m.subtask_id, m.job_id, m.status, m.uploaded_at
      FROM public.job_subtask_media AS m
      WHERE m.id = p_media_id;
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

  RETURN QUERY
    SELECT m.id, m.subtask_id, m.job_id, m.status, m.uploaded_at
    FROM public.job_subtask_media AS m
    WHERE m.id = p_media_id;
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
  FROM public.worker_profiles
  WHERE user_id = p_worker_id AND verification_status = 'VERIFIED'
  FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Job not found' USING ERRCODE = 'P0002';
  END IF;

  SELECT j.status, j.worker_id INTO v_status, v_assigned_worker
  FROM public.jobs AS j
  WHERE j.id = p_job_id
  FOR UPDATE;
  IF NOT FOUND OR v_assigned_worker IS DISTINCT FROM p_worker_id THEN
    RAISE EXCEPTION 'Job not found' USING ERRCODE = 'P0002';
  END IF;
  IF v_status <> 'IN_PROGRESS' THEN
    RAISE EXCEPTION 'Job cannot be submitted in its current state' USING ERRCODE = '55000';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM public.job_subtasks AS s
    WHERE s.job_id = p_job_id
      AND s.is_required = TRUE
      AND (
        s.status <> 'COMPLETED'
        OR NOT EXISTS (
          SELECT 1
          FROM public.job_subtask_media AS m
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

ALTER FUNCTION public.accept_job(UUID, UUID) SET search_path = pg_catalog, public, pg_temp;
ALTER FUNCTION public.set_worker_verification(UUID, VARCHAR, BOOLEAN) SET search_path = pg_catalog, public, pg_temp;
ALTER FUNCTION public.advance_worker_job_status(UUID, UUID, job_status) SET search_path = pg_catalog, public, pg_temp;

REVOKE EXECUTE ON FUNCTION confirm_job_subtask_media_upload(UUID, UUID, BIGINT, VARCHAR, VARCHAR, TEXT, TEXT) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION submit_job_with_evidence(UUID, UUID) FROM PUBLIC;
