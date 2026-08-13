-- Phase 7 creates an append-only operational audit trail and narrowly scoped
-- SECURITY DEFINER controls. Administrative power is explicit, transactional,
-- and cannot be simulated by a direct state update from the runtime role.

CREATE TABLE admin_audit_log (
  id BIGSERIAL PRIMARY KEY,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  actor_user_id UUID NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  action VARCHAR(64) NOT NULL CHECK (
    action IN (
      'JOB_STATUS_OVERRIDE',
      'JOB_REASSIGNED',
      'JOB_CANCELLED',
      'USER_SUSPENDED',
      'WORKER_VERIFICATION_UPDATED'
    )
  ),
  entity_type VARCHAR(64) NOT NULL CHECK (length(btrim(entity_type)) > 0),
  entity_id UUID NOT NULL,
  reason TEXT NOT NULL CHECK (length(btrim(reason)) >= 3),
  before_state JSONB NOT NULL DEFAULT '{}'::jsonb,
  after_state JSONB NOT NULL DEFAULT '{}'::jsonb,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  override_txid BIGINT
);

CREATE INDEX idx_admin_audit_log_actor_id
  ON admin_audit_log (actor_user_id, id DESC);
CREATE INDEX idx_admin_audit_log_entity_id
  ON admin_audit_log (entity_type, entity_id, id DESC);
CREATE INDEX idx_wallet_ledger_completed_analytics
  ON wallet_ledger (currency, transaction_type, created_at DESC)
  INCLUDE (amount_cents)
  WHERE transaction_status = 'COMPLETED'
    AND transaction_type IN ('ESCROW_HOLD', 'PLATFORM_FEE');

CREATE OR REPLACE FUNCTION assert_active_admin(p_actor_user_id UUID)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public, pg_temp
AS $$
BEGIN
  PERFORM 1
  FROM public.users AS u
  WHERE u.id = p_actor_user_id
    AND u.role = 'ADMIN'
    AND u.is_active = TRUE
    AND u.is_verified = TRUE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Active administrator privileges are required' USING ERRCODE = '42501';
  END IF;
END;
$$;

CREATE OR REPLACE FUNCTION job_override_is_authorized(
  p_job_id UUID,
  p_old_status job_status,
  p_new_status job_status,
  p_old_worker_id UUID,
  p_new_worker_id UUID
)
RETURNS BOOLEAN
LANGUAGE sql
SECURITY DEFINER
SET search_path = pg_catalog, public, pg_temp
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.admin_audit_log AS audit
    WHERE audit.entity_type = 'JOB'
      AND audit.entity_id = p_job_id
      AND audit.override_txid = txid_current()
      AND audit.action IN ('JOB_STATUS_OVERRIDE', 'JOB_REASSIGNED', 'JOB_CANCELLED')
      AND audit.before_state @> jsonb_build_object(
        'status', p_old_status::text,
        'worker_id', p_old_worker_id
      )
      AND audit.after_state @> jsonb_build_object(
        'status', p_new_status::text,
        'worker_id', p_new_worker_id
      )
  );
$$;

-- Preserve the canonical graph for normal operations. A noncanonical edge is
-- permitted only when the same transaction contains an exact, immutable audit
-- authorization inserted by an admin SECURITY DEFINER function.
CREATE OR REPLACE FUNCTION enforce_job_lifecycle_transition()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = pg_catalog, public, pg_temp
AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    IF NEW.status <> 'POSTED' THEN
      RAISE EXCEPTION 'Jobs must be created in POSTED status' USING ERRCODE = '23514';
    END IF;
    RETURN NEW;
  END IF;
  IF NEW.status = OLD.status THEN
    RETURN NEW;
  END IF;

  IF (
    (OLD.status = 'POSTED' AND NEW.status IN ('ASSIGNED', 'CANCELLED')) OR
    (OLD.status = 'ASSIGNED' AND NEW.status IN ('EN_ROUTE', 'CANCELLED', 'DISPUTED')) OR
    (OLD.status = 'EN_ROUTE' AND NEW.status IN ('AT_LOCATION', 'CANCELLED', 'DISPUTED')) OR
    (OLD.status = 'AT_LOCATION' AND NEW.status IN ('IN_PROGRESS', 'CANCELLED', 'DISPUTED')) OR
    (OLD.status = 'IN_PROGRESS' AND NEW.status IN ('SUBMITTED', 'CANCELLED', 'DISPUTED')) OR
    (OLD.status = 'SUBMITTED' AND NEW.status IN ('APPROVED', 'DISPUTED')) OR
    (OLD.status = 'APPROVED' AND NEW.status IN ('COMPLETED', 'DISPUTED')) OR
    (OLD.status = 'DISPUTED' AND NEW.status = 'APPROVED')
  ) THEN
    RETURN NEW;
  END IF;

  IF NOT public.job_override_is_authorized(
    NEW.id, OLD.status, NEW.status, OLD.worker_id, NEW.worker_id
  ) THEN
    RAISE EXCEPTION 'Invalid job state transition: % -> %', OLD.status, NEW.status
      USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION enforce_job_worker_assignment_change()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = pg_catalog, public, pg_temp
AS $$
BEGIN
  IF NEW.worker_id IS NOT DISTINCT FROM OLD.worker_id THEN
    RETURN NEW;
  END IF;

  -- Normal assignment is performed by accept_job() from a POSTED job. Every
  -- reassignment/removal needs the exact admin audit authorization above.
  IF OLD.status = 'POSTED'
    AND OLD.worker_id IS NULL
    AND NEW.status = 'ASSIGNED'
    AND NEW.worker_id IS NOT NULL THEN
    RETURN NEW;
  END IF;

  IF NOT public.job_override_is_authorized(
    NEW.id, OLD.status, NEW.status, OLD.worker_id, NEW.worker_id
  ) THEN
    RAISE EXCEPTION 'Worker assignment changes require an audited administrative override'
      USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER enforce_job_worker_assignment_change
  BEFORE UPDATE OF worker_id ON jobs
  FOR EACH ROW EXECUTE FUNCTION enforce_job_worker_assignment_change();

CREATE OR REPLACE FUNCTION admin_override_job(
  p_actor_user_id UUID,
  p_job_id UUID,
  p_action VARCHAR,
  p_target_status job_status,
  p_target_worker_id UUID,
  p_reason TEXT,
  p_cancellation_reason TEXT DEFAULT NULL
)
RETURNS TABLE (
  audit_id BIGINT,
  job_id UUID,
  worker_id UUID,
  status job_status
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public, pg_temp
AS $$
DECLARE
  v_action VARCHAR := upper(btrim(p_action));
  v_reason TEXT := btrim(p_reason);
  v_status job_status;
  v_worker_id UUID;
  v_client_id UUID;
  v_job_location geometry;
  v_old_worker_id UUID;
  v_target_verification_status VARCHAR;
  v_target_available BOOLEAN;
  v_target_location geometry;
  v_target_location_updated_at TIMESTAMPTZ;
  v_target_radius_km INTEGER;
  v_before JSONB;
  v_after JSONB;
  v_audit_id BIGINT;
  v_next_status job_status;
  v_next_worker_id UUID;
BEGIN
  PERFORM public.assert_active_admin(p_actor_user_id);
  IF length(v_reason) < 3 THEN
    RAISE EXCEPTION 'An administrative reason is required' USING ERRCODE = '22023';
  END IF;
  IF v_action NOT IN ('STATUS', 'REASSIGN', 'CANCEL') THEN
    RAISE EXCEPTION 'Unsupported administrative job action' USING ERRCODE = '22023';
  END IF;

  -- Discover the current assignment without taking the job update lock, then
  -- lock involved profiles in UUID order before locking the job.
  SELECT j.worker_id INTO v_old_worker_id FROM public.jobs AS j WHERE j.id = p_job_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Job not found' USING ERRCODE = 'P0002';
  END IF;
  FOR v_worker_id IN
    SELECT wp.user_id
    FROM public.worker_profiles AS wp
    WHERE wp.user_id = ANY(ARRAY[v_old_worker_id, p_target_worker_id]::uuid[])
    ORDER BY wp.user_id
    FOR UPDATE
  LOOP
    NULL;
  END LOOP;

  SELECT j.status, j.worker_id, j.client_id, j.location
  INTO v_status, v_worker_id, v_client_id, v_job_location
  FROM public.jobs AS j
  WHERE j.id = p_job_id
  FOR UPDATE;
  IF v_worker_id IS DISTINCT FROM v_old_worker_id THEN
    RAISE EXCEPTION 'Job assignment changed; retry the override' USING ERRCODE = '40001';
  END IF;
  IF v_status IN ('COMPLETED', 'CANCELLED') THEN
    RAISE EXCEPTION 'Terminal jobs cannot be overridden' USING ERRCODE = '55000';
  END IF;

  v_next_status := v_status;
  v_next_worker_id := v_worker_id;
  IF v_action = 'STATUS' THEN
    IF p_target_status IS NULL OR p_target_status NOT IN ('DISPUTED', 'APPROVED', 'COMPLETED') THEN
      RAISE EXCEPTION 'Administrative status overrides may target DISPUTED, APPROVED, or COMPLETED'
        USING ERRCODE = '22023';
    END IF;
    v_next_status := p_target_status;
  ELSIF v_action = 'CANCEL' THEN
    v_next_status := 'CANCELLED';
    v_next_worker_id := NULL;
  ELSE
    IF p_target_worker_id IS NULL OR p_target_worker_id = v_worker_id THEN
      RAISE EXCEPTION 'A different target worker is required for reassignment' USING ERRCODE = '22023';
    END IF;
    IF v_status NOT IN ('ASSIGNED', 'EN_ROUTE', 'AT_LOCATION') THEN
      RAISE EXCEPTION 'Only pre-progress jobs may be reassigned' USING ERRCODE = '55000';
    END IF;
    IF EXISTS (SELECT 1 FROM public.job_subtask_media AS m WHERE m.job_id = p_job_id) THEN
      RAISE EXCEPTION 'Jobs with evidence cannot be reassigned' USING ERRCODE = '55000';
    END IF;
    SELECT wp.verification_status,
           wp.is_available,
           wp.current_location,
           wp.last_location_update,
           wp.preferred_radius_km
    INTO v_target_verification_status,
         v_target_available,
         v_target_location,
         v_target_location_updated_at,
         v_target_radius_km
    FROM public.worker_profiles AS wp
    JOIN public.users AS u ON u.id = wp.user_id
    WHERE wp.user_id = p_target_worker_id
      AND u.role = 'WORKER'
      AND u.is_active = TRUE;
    IF NOT FOUND
      OR v_target_verification_status <> 'VERIFIED'
      OR v_target_available IS NOT TRUE
      OR v_target_location IS NULL
      OR v_target_location_updated_at IS NULL
      OR v_target_location_updated_at <= NOW() - INTERVAL '15 minutes'
      OR NOT ST_DWithin(v_job_location::geography, v_target_location::geography, v_target_radius_km * 1000) THEN
      RAISE EXCEPTION 'Target worker is not an eligible nearby verified worker' USING ERRCODE = '55000';
    END IF;
    IF EXISTS (
      SELECT 1 FROM public.jobs AS active_job
      WHERE active_job.worker_id = p_target_worker_id
        AND active_job.status IN ('ASSIGNED', 'EN_ROUTE', 'AT_LOCATION', 'IN_PROGRESS', 'SUBMITTED', 'APPROVED', 'DISPUTED')
    ) THEN
      RAISE EXCEPTION 'Target worker has active work' USING ERRCODE = '55000';
    END IF;
    v_next_status := 'ASSIGNED';
    v_next_worker_id := p_target_worker_id;
  END IF;

  v_before := jsonb_build_object('status', v_status::text, 'worker_id', v_worker_id);
  v_after := jsonb_build_object('status', v_next_status::text, 'worker_id', v_next_worker_id);
  INSERT INTO public.admin_audit_log (
    actor_user_id,
    action,
    entity_type,
    entity_id,
    reason,
    before_state,
    after_state,
    metadata,
    override_txid
  ) VALUES (
    p_actor_user_id,
    CASE v_action
      WHEN 'REASSIGN' THEN 'JOB_REASSIGNED'
      WHEN 'CANCEL' THEN 'JOB_CANCELLED'
      ELSE 'JOB_STATUS_OVERRIDE'
    END,
    'JOB',
    p_job_id,
    v_reason,
    v_before,
    v_after,
    jsonb_build_object('client_id', v_client_id),
    txid_current()
  ) RETURNING id INTO v_audit_id;

  UPDATE public.jobs AS j
  SET status = v_next_status,
      worker_id = v_next_worker_id,
      completed_at = CASE WHEN v_next_status = 'COMPLETED' THEN NOW() ELSE j.completed_at END,
      cancelled_at = CASE WHEN v_next_status = 'CANCELLED' THEN NOW() ELSE j.cancelled_at END,
      cancellation_reason = CASE
        WHEN v_next_status = 'CANCELLED' THEN COALESCE(NULLIF(btrim(p_cancellation_reason), ''), v_reason)
        ELSE j.cancellation_reason
      END,
      updated_at = NOW()
  WHERE j.id = p_job_id;

  IF v_worker_id IS NOT NULL AND (v_action IN ('REASSIGN', 'CANCEL') OR v_next_status = 'COMPLETED') THEN
    UPDATE public.worker_profiles AS wp
    SET is_available = TRUE, updated_at = NOW()
    WHERE wp.user_id = v_worker_id
      AND wp.verification_status = 'VERIFIED'
      AND EXISTS (SELECT 1 FROM public.users AS u WHERE u.id = v_worker_id AND u.is_active = TRUE)
      AND NOT EXISTS (
        SELECT 1 FROM public.jobs AS active_job
        WHERE active_job.worker_id = v_worker_id
          AND active_job.status IN ('ASSIGNED', 'EN_ROUTE', 'AT_LOCATION', 'IN_PROGRESS', 'SUBMITTED', 'APPROVED', 'DISPUTED')
      );
  END IF;
  IF v_action = 'REASSIGN' THEN
    UPDATE public.worker_profiles AS wp
    SET is_available = FALSE, updated_at = NOW()
    WHERE wp.user_id = p_target_worker_id;
  END IF;

  RETURN QUERY SELECT v_audit_id, p_job_id, v_next_worker_id, v_next_status;
END;
$$;

CREATE OR REPLACE FUNCTION admin_set_worker_verification(
  p_actor_user_id UUID,
  p_worker_id UUID,
  p_verification_status VARCHAR,
  p_is_available BOOLEAN,
  p_reason TEXT
)
RETURNS TABLE (
  audit_id BIGINT,
  verification_status VARCHAR,
  preferred_radius_km INTEGER,
  is_available BOOLEAN
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public, pg_temp
AS $$
DECLARE
  v_reason TEXT := btrim(p_reason);
  v_before JSONB;
  v_after JSONB;
  v_active_job BOOLEAN;
  v_audit_id BIGINT;
BEGIN
  PERFORM public.assert_active_admin(p_actor_user_id);
  IF p_verification_status NOT IN ('PENDING', 'VERIFIED', 'REJECTED', 'SUSPENDED') OR length(v_reason) < 3 THEN
    RAISE EXCEPTION 'Invalid verification update' USING ERRCODE = '22023';
  END IF;

  SELECT jsonb_build_object(
           'verification_status', wp.verification_status,
           'is_available', wp.is_available
         )
  INTO v_before
  FROM public.worker_profiles AS wp
  WHERE wp.user_id = p_worker_id
  FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Worker profile not found' USING ERRCODE = 'P0002';
  END IF;

  SELECT EXISTS (
    SELECT 1 FROM public.jobs AS j
    WHERE j.worker_id = p_worker_id
      AND j.status IN ('ASSIGNED', 'EN_ROUTE', 'AT_LOCATION', 'IN_PROGRESS', 'SUBMITTED', 'APPROVED', 'DISPUTED')
    FOR UPDATE
  ) INTO v_active_job;
  IF v_active_job AND (p_verification_status <> 'VERIFIED' OR p_is_available IS NOT FALSE) THEN
    RAISE EXCEPTION 'Resolve active work before downgrading worker verification' USING ERRCODE = '55000';
  END IF;
  IF p_verification_status = 'VERIFIED' AND p_is_available AND v_active_job THEN
    RAISE EXCEPTION 'Worker has active work' USING ERRCODE = '55000';
  END IF;

  UPDATE public.worker_profiles AS wp
  SET verification_status = p_verification_status,
      is_available = CASE WHEN p_verification_status = 'VERIFIED' THEN p_is_available ELSE FALSE END,
      updated_at = NOW()
  WHERE wp.user_id = p_worker_id
  RETURNING jsonb_build_object(
    'verification_status', wp.verification_status,
    'is_available', wp.is_available
  ), wp.verification_status, wp.preferred_radius_km, wp.is_available
  INTO v_after, verification_status, preferred_radius_km, is_available;

  INSERT INTO public.admin_audit_log (
    actor_user_id, action, entity_type, entity_id, reason, before_state, after_state
  ) VALUES (
    p_actor_user_id, 'WORKER_VERIFICATION_UPDATED', 'WORKER_PROFILE', p_worker_id,
    v_reason, v_before, v_after
  ) RETURNING id INTO v_audit_id;
  audit_id := v_audit_id;
  RETURN NEXT;
END;
$$;

CREATE OR REPLACE FUNCTION admin_suspend_user(
  p_actor_user_id UUID,
  p_user_id UUID,
  p_reason TEXT
)
RETURNS TABLE (
  audit_id BIGINT,
  active_job_count INTEGER
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public, pg_temp
AS $$
DECLARE
  v_reason TEXT := btrim(p_reason);
  v_role user_role;
  v_was_active BOOLEAN;
  v_job RECORD;
  v_user_audit_id BIGINT;
  v_job_audit_id BIGINT;
  v_count INTEGER := 0;
  v_before JSONB;
  v_after JSONB;
BEGIN
  PERFORM public.assert_active_admin(p_actor_user_id);
  IF p_actor_user_id = p_user_id OR length(v_reason) < 3 THEN
    RAISE EXCEPTION 'Invalid user suspension request' USING ERRCODE = '22023';
  END IF;

  SELECT u.role, u.is_active INTO v_role, v_was_active
  FROM public.users AS u WHERE u.id = p_user_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'User not found' USING ERRCODE = 'P0002';
  END IF;
  IF v_role = 'ADMIN' THEN
    RAISE EXCEPTION 'Administrative accounts cannot be suspended through this endpoint' USING ERRCODE = '42501';
  END IF;

  IF v_role = 'WORKER' THEN
    PERFORM 1 FROM public.worker_profiles AS wp WHERE wp.user_id = p_user_id FOR UPDATE;
    FOR v_job IN
      SELECT j.id, j.status, j.worker_id
      FROM public.jobs AS j
      WHERE j.worker_id = p_user_id
        AND j.status IN ('ASSIGNED', 'EN_ROUTE', 'AT_LOCATION', 'IN_PROGRESS', 'SUBMITTED', 'APPROVED')
      FOR UPDATE
    LOOP
      v_before := jsonb_build_object('status', v_job.status::text, 'worker_id', v_job.worker_id);
      v_after := jsonb_build_object('status', 'DISPUTED', 'worker_id', v_job.worker_id);
      INSERT INTO public.admin_audit_log (
        actor_user_id, action, entity_type, entity_id, reason,
        before_state, after_state, metadata, override_txid
      ) VALUES (
        p_actor_user_id, 'JOB_STATUS_OVERRIDE', 'JOB', v_job.id, v_reason,
        v_before, v_after, jsonb_build_object('cause', 'WORKER_SUSPENDED'), txid_current()
      ) RETURNING id INTO v_job_audit_id;
      UPDATE public.jobs AS j
      SET status = 'DISPUTED', updated_at = NOW()
      WHERE j.id = v_job.id;
      v_count := v_count + 1;
    END LOOP;

    UPDATE public.worker_profiles AS wp
    SET verification_status = 'SUSPENDED', is_available = FALSE, updated_at = NOW()
    WHERE wp.user_id = p_user_id;
  END IF;

  UPDATE public.users AS u
  SET is_active = FALSE, updated_at = NOW()
  WHERE u.id = p_user_id;
  UPDATE public.device_push_tokens AS token
  SET is_active = FALSE, updated_at = NOW()
  WHERE token.user_id = p_user_id;

  INSERT INTO public.admin_audit_log (
    actor_user_id, action, entity_type, entity_id, reason, before_state, after_state,
    metadata
  ) VALUES (
    p_actor_user_id,
    'USER_SUSPENDED',
    'USER',
    p_user_id,
    v_reason,
    jsonb_build_object('is_active', v_was_active, 'role', v_role::text),
    jsonb_build_object('is_active', FALSE, 'role', v_role::text),
    jsonb_build_object('disputed_active_jobs', v_count)
  ) RETURNING id INTO v_user_audit_id;

  PERFORM pg_notify('networkpeer_auth_revoked', p_user_id::text);
  RETURN QUERY SELECT v_user_audit_id, v_count;
END;
$$;

REVOKE ALL ON admin_audit_log FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION assert_active_admin(UUID) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION job_override_is_authorized(UUID, job_status, job_status, UUID, UUID) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION admin_override_job(UUID, UUID, VARCHAR, job_status, UUID, TEXT, TEXT) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION admin_set_worker_verification(UUID, UUID, VARCHAR, BOOLEAN, TEXT) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION admin_suspend_user(UUID, UUID, TEXT) FROM PUBLIC;
