-- Qualify subtask columns because RETURNS TABLE output names are visible as
-- PL/pgSQL variables inside the confirmation function.
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
