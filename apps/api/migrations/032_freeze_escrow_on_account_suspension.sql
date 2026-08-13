-- Suspension must stop operational work and preserve any held funds for
-- audited dispute/refund handling rather than silently releasing them.

CREATE OR REPLACE FUNCTION enforce_job_financial_state()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = pg_catalog, public, pg_temp
AS $$
BEGIN
  IF NEW.status = 'FUNDING' AND NEW.escrow_status NOT IN ('UNFUNDED', 'PENDING', 'FROZEN') THEN
    RAISE EXCEPTION 'Funding jobs must not expose settled escrow' USING ERRCODE = '23514';
  END IF;
  IF NEW.status IN ('POSTED', 'ASSIGNED', 'EN_ROUTE', 'AT_LOCATION', 'IN_PROGRESS', 'SUBMITTED')
    AND NEW.escrow_status <> 'HELD' THEN
    RAISE EXCEPTION 'Active jobs require a completed escrow hold' USING ERRCODE = '23514';
  END IF;
  IF NEW.status IN ('APPROVED', 'COMPLETED') AND NEW.escrow_status <> 'RELEASED' THEN
    RAISE EXCEPTION 'Approved/completed jobs require an escrow settlement' USING ERRCODE = '23514';
  END IF;
  IF NEW.status = 'CANCELLED' AND NEW.escrow_status NOT IN ('UNFUNDED', 'REFUNDED') THEN
    RAISE EXCEPTION 'Funded jobs require an explicit refund before cancellation' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION enforce_admin_audit_job_transition()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public, pg_temp
AS $$
DECLARE
  v_from_status TEXT;
  v_to_status TEXT;
  v_from_escrow TEXT;
  v_to_escrow TEXT;
  v_suspension_cause BOOLEAN;
BEGIN
  IF NEW.entity_type <> 'JOB' THEN
    RETURN NEW;
  END IF;

  v_from_status := NEW.before_state ->> 'status';
  v_to_status := NEW.after_state ->> 'status';
  v_from_escrow := NEW.before_state ->> 'escrow_status';
  v_to_escrow := NEW.after_state ->> 'escrow_status';
  v_suspension_cause := NEW.metadata ->> 'cause' IN ('CLIENT_SUSPENDED', 'WORKER_SUSPENDED');
  IF v_from_status IS NULL OR v_to_status IS NULL THEN
    RAISE EXCEPTION 'Job audit entries require before and after status' USING ERRCODE = '23514';
  END IF;

  IF NEW.action = 'JOB_REASSIGNED' THEN
    IF v_from_status <> 'ASSIGNED'
      OR v_to_status <> 'ASSIGNED'
      OR (NEW.before_state ->> 'worker_id') IS NOT DISTINCT FROM (NEW.after_state ->> 'worker_id') THEN
      RAISE EXCEPTION 'Administrative reassignment is allowed only while ASSIGNED' USING ERRCODE = '23514';
    END IF;
    RETURN NEW;
  END IF;

  IF NEW.action = 'JOB_STATUS_OVERRIDE' AND (
    (v_from_status = 'ASSIGNED' AND v_to_status IN ('EN_ROUTE', 'DISPUTED', 'CANCELLED')) OR
    (v_from_status = 'EN_ROUTE' AND v_to_status IN ('AT_LOCATION', 'DISPUTED', 'CANCELLED')) OR
    (v_from_status = 'AT_LOCATION' AND v_to_status IN ('IN_PROGRESS', 'DISPUTED', 'CANCELLED')) OR
    (v_from_status = 'IN_PROGRESS' AND v_to_status IN ('SUBMITTED', 'DISPUTED', 'CANCELLED')) OR
    (v_from_status = 'SUBMITTED' AND v_to_status IN ('APPROVED', 'DISPUTED')) OR
    (v_from_status = 'APPROVED' AND v_to_status IN ('COMPLETED', 'DISPUTED')) OR
    (v_from_status = 'DISPUTED' AND v_to_status = 'APPROVED') OR
    (v_suspension_cause AND v_from_status = 'POSTED' AND v_to_status = 'DISPUTED') OR
    (v_suspension_cause AND v_from_status = 'FUNDING' AND v_to_status = 'FUNDING'
      AND v_from_escrow = 'PENDING' AND v_to_escrow = 'FROZEN') OR
    (v_suspension_cause AND v_from_status = 'DISPUTED' AND v_to_status = 'DISPUTED'
      AND v_from_escrow = 'HELD' AND v_to_escrow = 'FROZEN')
  ) THEN
    RETURN NEW;
  END IF;

  IF NEW.action = 'JOB_CANCELLED' AND NOT (
    (v_from_status = 'POSTED' AND v_to_status = 'CANCELLED') OR
    (v_from_status = 'ASSIGNED' AND v_to_status = 'CANCELLED') OR
    (v_from_status = 'EN_ROUTE' AND v_to_status = 'CANCELLED') OR
    (v_from_status = 'AT_LOCATION' AND v_to_status = 'CANCELLED') OR
    (v_from_status = 'IN_PROGRESS' AND v_to_status = 'CANCELLED')
  ) THEN
    RAISE EXCEPTION 'Administrative cancellation is not canonical' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
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
  v_next_status job_status;
  v_next_escrow_status escrow_status;
  v_cause TEXT;
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
  v_cause := CASE WHEN v_role = 'WORKER' THEN 'WORKER_SUSPENDED' ELSE 'CLIENT_SUSPENDED' END;

  IF v_role = 'WORKER' THEN
    PERFORM 1 FROM public.worker_profiles AS wp WHERE wp.user_id = p_user_id FOR UPDATE;
  END IF;

  FOR v_job IN
    SELECT j.id, j.status, j.worker_id, j.escrow_status
    FROM public.jobs AS j
    WHERE (
      v_role = 'WORKER'
      AND j.worker_id = p_user_id
      AND j.status IN ('ASSIGNED', 'EN_ROUTE', 'AT_LOCATION', 'IN_PROGRESS', 'SUBMITTED', 'APPROVED', 'DISPUTED')
    ) OR (
      v_role = 'CLIENT'
      AND j.client_id = p_user_id
      AND (
        j.status IN ('POSTED', 'ASSIGNED', 'EN_ROUTE', 'AT_LOCATION', 'IN_PROGRESS', 'SUBMITTED', 'APPROVED', 'DISPUTED')
        OR (j.status = 'FUNDING' AND j.escrow_status = 'PENDING')
      )
    )
    ORDER BY j.id
    FOR UPDATE
  LOOP
    v_next_status := CASE
      WHEN v_job.status = 'FUNDING' THEN 'FUNDING'::job_status
      ELSE 'DISPUTED'::job_status
    END;
    v_next_escrow_status := CASE
      WHEN v_job.escrow_status = 'HELD' THEN 'FROZEN'::escrow_status
      WHEN v_job.status = 'FUNDING' AND v_job.escrow_status = 'PENDING' THEN 'FROZEN'::escrow_status
      ELSE v_job.escrow_status
    END;
    IF v_next_status = v_job.status AND v_next_escrow_status = v_job.escrow_status THEN
      CONTINUE;
    END IF;
    v_before := jsonb_build_object(
      'status', v_job.status::text,
      'worker_id', v_job.worker_id,
      'escrow_status', v_job.escrow_status::text
    );
    v_after := jsonb_build_object(
      'status', v_next_status::text,
      'worker_id', v_job.worker_id,
      'escrow_status', v_next_escrow_status::text
    );
    INSERT INTO public.admin_audit_log (
      actor_user_id, action, entity_type, entity_id, reason,
      before_state, after_state, metadata, override_txid
    ) VALUES (
      p_actor_user_id, 'JOB_STATUS_OVERRIDE', 'JOB', v_job.id, v_reason,
      v_before, v_after, jsonb_build_object('cause', v_cause), txid_current()
    ) RETURNING id INTO v_job_audit_id;
    UPDATE public.jobs AS j
    SET status = v_next_status,
        escrow_status = v_next_escrow_status,
        updated_at = NOW()
    WHERE j.id = v_job.id;
    v_count := v_count + 1;
  END LOOP;

  IF v_role = 'WORKER' THEN
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
    jsonb_build_object('frozen_active_jobs', v_count)
  ) RETURNING id INTO v_user_audit_id;

  PERFORM pg_notify('networkpeer_auth_revoked', p_user_id::text);
  RETURN QUERY SELECT v_user_audit_id, v_count;
END;
$$;
