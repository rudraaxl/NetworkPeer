-- Phase 10: compliance and trust layer.
-- DPDP consent records, client KYC, gig-worker government registration,
-- dispute resolution for frozen escrow, and perceptual-hash duplicate detection.

-- ---------------------------------------------------------------------------
-- DPDP consent records (opt-in, withdrawal, deletion)
-- ---------------------------------------------------------------------------
CREATE TABLE consent_records (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  purpose VARCHAR(64) NOT NULL CHECK (length(btrim(purpose)) >= 3),
  status VARCHAR(16) NOT NULL DEFAULT 'GRANTED'
    CHECK (status IN ('GRANTED', 'WITHDRAWN', 'DELETED')),
  granted_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  withdrawn_at TIMESTAMPTZ,
  deleted_at TIMESTAMPTZ,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  UNIQUE (user_id, purpose)
);

CREATE INDEX idx_consent_records_user ON consent_records (user_id);
CREATE INDEX idx_consent_records_status ON consent_records (status);

-- ---------------------------------------------------------------------------
-- Client KYC verification
-- ---------------------------------------------------------------------------
CREATE TABLE client_kyc_verifications (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  status VARCHAR(16) NOT NULL DEFAULT 'PENDING'
    CHECK (status IN ('PENDING', 'VERIFIED', 'REJECTED', 'SUSPENDED')),
  verification_documents JSONB NOT NULL DEFAULT '{}'::jsonb,
  reviewer_user_id UUID REFERENCES users(id),
  review_reason TEXT,
  reviewed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE UNIQUE INDEX idx_client_kyc_user ON client_kyc_verifications (user_id);
CREATE INDEX idx_client_kyc_status ON client_kyc_verifications (status);

-- ---------------------------------------------------------------------------
-- Gig-worker government registration
-- ---------------------------------------------------------------------------
CREATE TABLE government_worker_registrations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  worker_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  registration_status VARCHAR(16) NOT NULL DEFAULT 'NOT_REGISTERED'
    CHECK (registration_status IN ('NOT_REGISTERED', 'REGISTERED', 'EXITED', 'FAILED')),
  government_worker_id VARCHAR(128),
  registration_payload JSONB NOT NULL DEFAULT '{}'::jsonb,
  registered_at TIMESTAMPTZ,
  exited_at TIMESTAMPTZ,
  last_sync_at TIMESTAMPTZ,
  last_error TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE UNIQUE INDEX idx_gov_worker_reg_worker ON government_worker_registrations (worker_id);

-- ---------------------------------------------------------------------------
-- Dispute resolution for frozen escrow
-- ---------------------------------------------------------------------------
CREATE TABLE disputes (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  job_id UUID NOT NULL REFERENCES jobs(id) ON DELETE CASCADE,
  opened_by UUID NOT NULL REFERENCES users(id),
  status VARCHAR(16) NOT NULL DEFAULT 'OPEN'
    CHECK (status IN ('OPEN', 'MEDIATION', 'RESOLVED_REFUND', 'RESOLVED_RELEASE')),
  reason TEXT NOT NULL CHECK (length(btrim(reason)) >= 3),
  resolution TEXT,
  resolved_by UUID REFERENCES users(id),
  resolved_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_disputes_job ON disputes (job_id);
CREATE INDEX idx_disputes_status ON disputes (status);

-- ---------------------------------------------------------------------------
-- Perceptual-hash duplicate detection
-- ---------------------------------------------------------------------------
CREATE TABLE media_perceptual_hashes (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  media_id UUID NOT NULL REFERENCES job_subtask_media(id) ON DELETE CASCADE,
  hash_type VARCHAR(16) NOT NULL DEFAULT 'PHASH'
    CHECK (hash_type IN ('PHASH', 'DHASH', 'AHASH')),
  hash_value VARCHAR(128) NOT NULL,
  duplicate_group_id UUID,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_media_phash_media ON media_perceptual_hashes (media_id);
CREATE INDEX idx_media_phash_value ON media_perceptual_hashes (hash_type, hash_value);
CREATE INDEX idx_media_phash_group ON media_perceptual_hashes (duplicate_group_id);

-- Hamming distance between two hex-encoded perceptual hashes. This is a pure
-- SQL helper for duplicate detection and does not mutate any table.
CREATE OR REPLACE FUNCTION hamming_distance(p_left TEXT, p_right TEXT)
RETURNS INTEGER
LANGUAGE plpgsql
IMMUTABLE
AS $$
DECLARE
  v_distance INTEGER := 0;
  v_left_bytes BYTEA;
  v_right_bytes BYTEA;
  v_index INTEGER;
  v_xor INTEGER;
BEGIN
  IF length(p_left) <> length(p_right) OR length(p_left) % 2 <> 0 THEN
    RETURN 2147483647;
  END IF;

  v_left_bytes := decode(p_left, 'hex');
  v_right_bytes := decode(p_right, 'hex');

  FOR v_index IN 0..octet_length(v_left_bytes) - 1 LOOP
    v_xor := get_byte(v_left_bytes, v_index) # get_byte(v_right_bytes, v_index);
    WHILE v_xor > 0 LOOP
      v_distance := v_distance + (v_xor & 1);
      v_xor := v_xor >> 1;
    END LOOP;
  END LOOP;

  RETURN v_distance;
END;
$$;

REVOKE EXECUTE ON FUNCTION hamming_distance(TEXT, TEXT) FROM PUBLIC;

-- Add phash column to job_subtask_media for fast duplicate lookup.
ALTER TABLE job_subtask_media
  ADD COLUMN IF NOT EXISTS phash VARCHAR(128);

-- SECURITY DEFINER function to atomically create a dispute and freeze escrow.
CREATE OR REPLACE FUNCTION open_dispute_and_freeze_escrow(
  p_actor_user_id UUID,
  p_job_id UUID,
  p_reason TEXT
)
RETURNS TABLE (dispute_id UUID)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public, pg_temp
AS $$
DECLARE
  v_dispute_id UUID;
  v_escrow_status escrow_status;
BEGIN
  IF length(btrim(p_reason)) < 3 THEN
    RAISE EXCEPTION 'Dispute reason must be at least 3 characters' USING ERRCODE = '22023';
  END IF;

  SELECT j.escrow_status INTO v_escrow_status
  FROM public.jobs AS j
  WHERE j.id = p_job_id
  FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Job not found' USING ERRCODE = 'P0002';
  END IF;
  IF v_escrow_status <> 'FROZEN' THEN
    RAISE EXCEPTION 'Disputes require frozen escrow' USING ERRCODE = '55000';
  END IF;

  INSERT INTO public.disputes (job_id, opened_by, reason)
  VALUES (p_job_id, p_actor_user_id, btrim(p_reason))
  RETURNING id INTO v_dispute_id;

  RETURN QUERY SELECT v_dispute_id;
END;
$$;

REVOKE EXECUTE ON FUNCTION open_dispute_and_freeze_escrow(UUID, UUID, TEXT) FROM PUBLIC;

-- SECURITY DEFINER function to resolve a dispute with refund or release.
CREATE OR REPLACE FUNCTION resolve_dispute(
  p_actor_user_id UUID,
  p_dispute_id UUID,
  p_resolution VARCHAR,
  p_resolution_text TEXT
)
RETURNS TABLE (resolved BOOLEAN)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public, pg_temp
AS $$
BEGIN
  PERFORM public.assert_active_admin(p_actor_user_id);

  IF p_resolution NOT IN ('RESOLVED_REFUND', 'RESOLVED_RELEASE') THEN
    RAISE EXCEPTION 'Resolution must be refund or release' USING ERRCODE = '22023';
  END IF;
  IF length(btrim(p_resolution_text)) < 3 THEN
    RAISE EXCEPTION 'Resolution text must be at least 3 characters' USING ERRCODE = '22023';
  END IF;

  UPDATE public.disputes AS d
  SET status = p_resolution,
      resolution = btrim(p_resolution_text),
      resolved_by = p_actor_user_id,
      resolved_at = NOW(),
      updated_at = NOW()
  WHERE d.id = p_dispute_id
    AND d.status IN ('OPEN', 'MEDIATION');

  IF NOT FOUND THEN
    RETURN QUERY SELECT FALSE;
    RETURN;
  END IF;

  RETURN QUERY SELECT TRUE;
END;
$$;

REVOKE EXECUTE ON FUNCTION resolve_dispute(UUID, UUID, VARCHAR, TEXT) FROM PUBLIC;
