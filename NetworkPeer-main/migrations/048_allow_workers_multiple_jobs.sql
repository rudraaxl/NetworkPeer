-- Migration 048: a worker may hold more than one job at a time.
--
-- accept_job cleared worker_profiles.is_available the moment a job was
-- claimed, and its own claimable check rejects a worker whose is_available is
-- not TRUE. Together those made the platform strictly one job at a time: after
-- accepting anything, every further job reported "Job is not claimable" until
-- the one in hand was settled -- which, with a job sitting in SUBMITTED
-- waiting on a client to review it, could be days.
--
-- Field work does not divide that way. A worker walking a street can collect
-- evidence for several jobs on the same trip, and refusing them the second one
-- costs them the journey for no benefit to anybody.
--
-- This drops the automatic clearing. It deliberately KEEPS the
-- `v_worker_available IS NOT TRUE` guard, because is_available remains
-- meaningful: a worker can mark themselves unavailable, and migration 020
-- (admin back-office) uses it to suspend one. What changes is that taking a
-- job is no longer by itself a reason to become unavailable.
--
-- Apart from the removed UPDATE, this function is what migration 023 defined.

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
  v_escrow_status escrow_status;
BEGIN
  SELECT j.client_id INTO v_initial_client_id FROM public.jobs AS j WHERE j.id = p_job_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'Job % does not exist', p_job_id USING ERRCODE = '22000'; END IF;
  PERFORM 1 FROM public.users AS u
  WHERE u.id = v_initial_client_id AND u.role = 'CLIENT' AND u.is_active = TRUE
  FOR KEY SHARE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Job client is not active' USING ERRCODE = '55000'; END IF;
  PERFORM 1 FROM public.users WHERE id = p_worker_id AND is_active = TRUE AND role = 'WORKER';
  IF NOT FOUND THEN RAISE EXCEPTION 'Worker is not active' USING ERRCODE = '22000'; END IF;

  SELECT wp.is_available, wp.verification_status, wp.current_location, wp.last_location_update, wp.preferred_radius_km
  INTO v_worker_available, v_worker_verification_status, v_worker_location, v_worker_location_updated_at, v_worker_radius_km
  FROM public.worker_profiles AS wp WHERE wp.user_id = p_worker_id FOR UPDATE;
  IF NOT FOUND OR v_worker_verification_status <> 'VERIFIED' THEN
    RAISE EXCEPTION 'Worker is not verified' USING ERRCODE = '22000';
  END IF;

  SELECT j.status, j.worker_id, j.client_id, j.location, j.escrow_status
  INTO v_current_status, v_assigned_worker, v_client_id, v_job_location, v_escrow_status
  FROM public.jobs AS j WHERE j.id = p_job_id FOR UPDATE;
  IF v_client_id IS DISTINCT FROM v_initial_client_id THEN
    RAISE EXCEPTION 'Job owner changed; retry acceptance' USING ERRCODE = '40001';
  END IF;
  IF v_current_status = 'ASSIGNED' AND v_assigned_worker = p_worker_id THEN
    RETURN QUERY SELECT j.id, j.worker_id, j.status FROM public.jobs AS j WHERE j.id = p_job_id;
    RETURN;
  END IF;
  IF v_worker_available IS NOT TRUE OR v_current_status <> 'POSTED' OR v_escrow_status <> 'HELD' THEN
    RAISE EXCEPTION 'Job is not claimable' USING ERRCODE = '55000';
  END IF;
  IF v_worker_location IS NULL OR v_worker_location_updated_at IS NULL
    OR v_worker_location_updated_at <= NOW() - INTERVAL '15 minutes' THEN
    RAISE EXCEPTION 'Worker location is missing or stale' USING ERRCODE = '22000';
  END IF;
  IF NOT ST_DWithin(v_job_location::geography, v_worker_location::geography, v_worker_radius_km * 1000) THEN
    RAISE EXCEPTION 'Job is outside the worker preferred radius' USING ERRCODE = '22000';
  END IF;

  UPDATE public.jobs SET status = 'ASSIGNED', worker_id = p_worker_id, updated_at = NOW() WHERE id = p_job_id;
  RETURN QUERY SELECT j.id, j.worker_id, j.status FROM public.jobs AS j WHERE j.id = p_job_id;
END;
$$;

-- Release the workers that the old behaviour shut out. Restricted to those who
-- have actually held a job, because that is the only case the automatic clear
-- could have caused; a profile an administrator suspended before ever working
-- is left alone, since nothing distinguishes the two states afterwards.
UPDATE public.worker_profiles wp
SET is_available = TRUE, updated_at = NOW()
WHERE wp.is_available = FALSE
  AND EXISTS (SELECT 1 FROM public.jobs j WHERE j.worker_id = wp.user_id);
