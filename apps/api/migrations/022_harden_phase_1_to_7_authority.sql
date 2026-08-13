-- Phase 1-7 authority hardening. Runtime credentials may perform normal user
-- workflows, but privileged definer functions are isolated to dedicated roles.

CREATE OR REPLACE FUNCTION register_otp_user(
  p_phone_number VARCHAR,
  p_role user_role,
  p_full_name VARCHAR DEFAULT 'Unnamed user'
)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public, pg_temp
AS $$
DECLARE
  v_user_id UUID;
  v_existing_role user_role;
BEGIN
  IF p_role NOT IN ('CLIENT', 'WORKER')
    OR p_phone_number IS NULL
    OR p_phone_number !~ '^\+[1-9][0-9]{1,14}$'
    OR length(btrim(COALESCE(p_full_name, ''))) = 0 THEN
    RAISE EXCEPTION 'Invalid public registration request' USING ERRCODE = '22023';
  END IF;

  -- A concurrent OTP verification can race a first registration. Lock an
  -- existing account, otherwise retry after a unique-key collision.
  LOOP
    SELECT u.id, u.role
    INTO v_user_id, v_existing_role
    FROM public.users AS u
    WHERE u.phone_number = p_phone_number
    FOR UPDATE;

    IF FOUND THEN
      IF v_existing_role <> p_role THEN
        RAISE EXCEPTION 'The requested role does not match this account' USING ERRCODE = '42501';
      END IF;
      RETURN v_user_id;
    END IF;

    BEGIN
      INSERT INTO public.users (phone_number, full_name, role, is_verified)
      VALUES (p_phone_number, btrim(p_full_name), p_role, TRUE)
      RETURNING id INTO v_user_id;

      IF p_role = 'WORKER' THEN
        INSERT INTO public.worker_profiles (user_id, is_available)
        VALUES (v_user_id, FALSE);
      END IF;
      RETURN v_user_id;
    EXCEPTION WHEN unique_violation THEN
      -- Another transaction created the phone number; inspect it on the next
      -- iteration rather than trusting the role supplied by this request.
    END;
  END LOOP;
END;
$$;

-- Checklist scope is frozen when work starts. The normal secure job-creation
-- command inserts subtasks while the parent is FUNDING; legacy owner fixtures
-- may insert while POSTED, but request-path DML has no such grant.
CREATE OR REPLACE FUNCTION enforce_job_subtask_insert_window()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public, pg_temp
AS $$
DECLARE
  v_job_status job_status;
BEGIN
  SELECT j.status INTO v_job_status
  FROM public.jobs AS j
  WHERE j.id = NEW.job_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Job subtask parent does not exist' USING ERRCODE = '23503';
  END IF;
  IF v_job_status NOT IN ('FUNDING', 'POSTED') THEN
    RAISE EXCEPTION 'Job subtasks can only be created before work begins' USING ERRCODE = '55000';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER enforce_job_subtask_insert_window
  BEFORE INSERT ON job_subtasks
  FOR EACH ROW EXECUTE FUNCTION enforce_job_subtask_insert_window();

-- Lock the client before the worker profile/job. This prevents a concurrent
-- suspension from racing an acceptance based on a stale active-client read.
CREATE OR REPLACE FUNCTION accept_job(p_job_id UUID, p_worker_id UUID)
RETURNS TABLE (job_id UUID, worker_id UUID, status job_status)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public, pg_temp
AS $$
DECLARE
  v_initial_client_id UUID;
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
  SELECT j.client_id INTO v_initial_client_id
  FROM public.jobs AS j
  WHERE j.id = p_job_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Job % does not exist', p_job_id USING ERRCODE = '22000';
  END IF;

  PERFORM 1
  FROM public.users AS u
  WHERE u.id = v_initial_client_id
    AND u.role = 'CLIENT'
    AND u.is_active = TRUE
  FOR KEY SHARE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Job client is not active' USING ERRCODE = '55000';
  END IF;

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

  IF v_client_id IS DISTINCT FROM v_initial_client_id THEN
    RAISE EXCEPTION 'Job owner changed; retry acceptance' USING ERRCODE = '40001';
  END IF;
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

-- An audit row authorizes an exceptional update, but it cannot expand the
-- canonical lifecycle. This keeps TypeScript's ADMIN_TRANSITIONS mirror and
-- PostgreSQL policy aligned while retaining audited reassignment at ASSIGNED.
CREATE OR REPLACE FUNCTION enforce_admin_audit_job_transition()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public, pg_temp
AS $$
DECLARE
  v_from_status TEXT;
  v_to_status TEXT;
BEGIN
  IF NEW.entity_type <> 'JOB' THEN
    RETURN NEW;
  END IF;

  v_from_status := NEW.before_state ->> 'status';
  v_to_status := NEW.after_state ->> 'status';
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

  IF NEW.action = 'JOB_STATUS_OVERRIDE' AND NOT (
    (v_from_status = 'ASSIGNED' AND v_to_status IN ('EN_ROUTE', 'DISPUTED', 'CANCELLED')) OR
    (v_from_status = 'EN_ROUTE' AND v_to_status IN ('AT_LOCATION', 'DISPUTED', 'CANCELLED')) OR
    (v_from_status = 'AT_LOCATION' AND v_to_status IN ('IN_PROGRESS', 'DISPUTED', 'CANCELLED')) OR
    (v_from_status = 'IN_PROGRESS' AND v_to_status IN ('SUBMITTED', 'DISPUTED', 'CANCELLED')) OR
    (v_from_status = 'SUBMITTED' AND v_to_status IN ('APPROVED', 'DISPUTED')) OR
    (v_from_status = 'APPROVED' AND v_to_status IN ('COMPLETED', 'DISPUTED')) OR
    (v_from_status = 'DISPUTED' AND v_to_status = 'APPROVED')
  ) THEN
    RAISE EXCEPTION 'Administrative status transition is not canonical' USING ERRCODE = '23514';
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

CREATE TRIGGER enforce_admin_audit_job_transition
  BEFORE INSERT ON admin_audit_log
  FOR EACH ROW EXECUTE FUNCTION enforce_admin_audit_job_transition();

REVOKE EXECUTE ON FUNCTION register_otp_user(VARCHAR, user_role, VARCHAR) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION enforce_job_subtask_insert_window() FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION enforce_admin_audit_job_transition() FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION accept_job(UUID, UUID) FROM PUBLIC;
