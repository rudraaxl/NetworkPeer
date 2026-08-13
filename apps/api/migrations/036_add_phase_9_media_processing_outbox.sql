-- Phase 9: Redis/BullMQ transports background work, but this PostgreSQL outbox
-- remains the durable authority for confirmed evidence processing.
CREATE TABLE media_processing_outbox (
  media_id UUID PRIMARY KEY REFERENCES job_subtask_media(id) ON DELETE CASCADE,
  processing_state VARCHAR(16) NOT NULL DEFAULT 'PENDING'
    CHECK (processing_state IN ('PENDING', 'PROCESSING', 'COMPLETED', 'SKIPPED')),
  processing_attempts INTEGER NOT NULL DEFAULT 0 CHECK (processing_attempts >= 0),
  processing_claimed_at TIMESTAMPTZ,
  processed_at TIMESTAMPTZ,
  processing_last_error TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_media_processing_outbox_pending
  ON media_processing_outbox (created_at ASC)
  WHERE processing_state = 'PENDING';

CREATE TRIGGER update_media_processing_outbox_updated_at
  BEFORE UPDATE ON media_processing_outbox
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE OR REPLACE FUNCTION enqueue_uploaded_media_processing()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public, pg_temp
AS $$
BEGIN
  IF NEW.status = 'UPLOADED' AND OLD.status IS DISTINCT FROM 'UPLOADED' THEN
    INSERT INTO public.media_processing_outbox (media_id)
    VALUES (NEW.id)
    ON CONFLICT (media_id) DO NOTHING;
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER enqueue_uploaded_media_processing
  AFTER UPDATE OF status ON job_subtask_media
  FOR EACH ROW EXECUTE FUNCTION enqueue_uploaded_media_processing();

-- Existing accepted evidence must receive the same eventual processing as new
-- uploads when Phase 9 is deployed.
INSERT INTO public.media_processing_outbox (media_id)
SELECT media.id
FROM public.job_subtask_media AS media
WHERE media.status = 'UPLOADED'
ON CONFLICT (media_id) DO NOTHING;

CREATE OR REPLACE FUNCTION list_media_processing_candidates(p_limit INTEGER)
RETURNS TABLE (media_id UUID)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public, pg_temp
AS $$
BEGIN
  IF p_limit IS NULL OR p_limit < 1 OR p_limit > 500 THEN
    RAISE EXCEPTION 'Media processing limit is invalid' USING ERRCODE = '22023';
  END IF;

  UPDATE public.media_processing_outbox AS outbox
  SET processing_state = 'SKIPPED',
      processing_claimed_at = NULL,
      processing_last_error = COALESCE(processing_last_error, 'Media processing exhausted retries')
  WHERE outbox.processing_state = 'PROCESSING'
    AND outbox.processing_attempts >= 5
    AND outbox.processing_claimed_at <= NOW() - INTERVAL '15 minutes';

  UPDATE public.media_processing_outbox AS outbox
  SET processing_state = 'SKIPPED',
      processing_claimed_at = NULL,
      processing_last_error = COALESCE(processing_last_error, 'Evidence no longer requires media processing')
  WHERE outbox.processing_state IN ('PENDING', 'PROCESSING')
    AND NOT EXISTS (
      SELECT 1
      FROM public.job_subtask_media AS media
      WHERE media.id = outbox.media_id AND media.status = 'UPLOADED'
    );

  RETURN QUERY
  SELECT outbox.media_id
  FROM public.media_processing_outbox AS outbox
  JOIN public.job_subtask_media AS media ON media.id = outbox.media_id
  WHERE media.status = 'UPLOADED'
    AND outbox.processing_attempts < 5
    AND (
      outbox.processing_state = 'PENDING'
      OR (
        outbox.processing_state = 'PROCESSING'
        AND outbox.processing_claimed_at <= NOW() - INTERVAL '15 minutes'
      )
    )
  ORDER BY outbox.created_at ASC
  LIMIT p_limit;
END;
$$;

CREATE OR REPLACE FUNCTION claim_media_processing(p_media_id UUID)
RETURNS TABLE (
  media_id UUID,
  s3_bucket TEXT,
  s3_key TEXT,
  s3_version_id TEXT,
  mime_type VARCHAR,
  file_size_bytes BIGINT,
  checksum_sha256 VARCHAR,
  s3_etag TEXT
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public, pg_temp
AS $$
#variable_conflict use_column
BEGIN
  UPDATE public.media_processing_outbox AS outbox
  SET processing_state = 'SKIPPED',
      processing_claimed_at = NULL,
      processing_last_error = COALESCE(processing_last_error, 'Evidence no longer requires media processing')
  WHERE outbox.media_id = p_media_id
    AND outbox.processing_state IN ('PENDING', 'PROCESSING')
    AND NOT EXISTS (
      SELECT 1
      FROM public.job_subtask_media AS media
      WHERE media.id = outbox.media_id AND media.status = 'UPLOADED'
    );

  RETURN QUERY
  WITH candidate AS (
    SELECT outbox.media_id
    FROM public.media_processing_outbox AS outbox
    JOIN public.job_subtask_media AS media ON media.id = outbox.media_id
    WHERE outbox.media_id = p_media_id
      AND media.status = 'UPLOADED'
      AND outbox.processing_attempts < 5
      AND (
        outbox.processing_state = 'PENDING'
        OR (
          outbox.processing_state = 'PROCESSING'
          AND outbox.processing_claimed_at <= NOW() - INTERVAL '15 minutes'
        )
      )
    FOR UPDATE OF outbox, media
  ), claimed AS (
    UPDATE public.media_processing_outbox AS outbox
    SET processing_state = 'PROCESSING',
        processing_claimed_at = NOW(),
        processing_attempts = outbox.processing_attempts + 1,
        processing_last_error = NULL
    FROM candidate
    WHERE outbox.media_id = candidate.media_id
    RETURNING outbox.media_id
  )
  SELECT media.id,
         media.s3_bucket,
         media.s3_key,
         media.s3_version_id,
         media.mime_type,
         media.file_size_bytes,
         media.checksum_sha256,
         media.s3_etag
  FROM claimed
  JOIN public.job_subtask_media AS media ON media.id = claimed.media_id;
END;
$$;

CREATE OR REPLACE FUNCTION complete_media_processing(p_media_id UUID)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public, pg_temp
AS $$
DECLARE
  v_completed BOOLEAN;
BEGIN
  UPDATE public.media_processing_outbox
  SET processing_state = 'COMPLETED',
      processing_claimed_at = NULL,
      processed_at = NOW(),
      processing_last_error = NULL
  WHERE media_id = p_media_id AND processing_state = 'PROCESSING'
  RETURNING TRUE INTO v_completed;
  RETURN COALESCE(v_completed, FALSE);
END;
$$;

CREATE OR REPLACE FUNCTION release_media_processing(p_media_id UUID, p_error TEXT)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public, pg_temp
AS $$
BEGIN
  UPDATE public.media_processing_outbox
  SET processing_state = CASE WHEN processing_attempts >= 5 THEN 'SKIPPED' ELSE 'PENDING' END,
      processing_claimed_at = NULL,
      processing_last_error = LEFT(COALESCE(NULLIF(btrim(p_error), ''), 'Media processing failed'), 1000)
  WHERE media_id = p_media_id AND processing_state = 'PROCESSING';
END;
$$;

REVOKE EXECUTE ON FUNCTION enqueue_uploaded_media_processing() FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION list_media_processing_candidates(INTEGER) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION claim_media_processing(UUID) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION complete_media_processing(UUID) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION release_media_processing(UUID, TEXT) FROM PUBLIC;
