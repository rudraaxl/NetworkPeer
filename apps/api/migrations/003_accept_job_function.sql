-- Migration: 003_accept_job_function.sql
-- Database-level atomic job acceptance using row-level locking

CREATE OR REPLACE FUNCTION accept_job(p_job_id UUID, p_worker_id UUID)
RETURNS TABLE (job_id UUID, worker_id UUID, status job_status)
LANGUAGE plpgsql
AS $$
DECLARE
  v_worker_available BOOLEAN;
  v_current_status job_status;
BEGIN
  -- 1. Validate worker exists and is active
  IF NOT EXISTS (
    SELECT 1 FROM users WHERE id = p_worker_id AND is_active = TRUE AND role = 'WORKER'
  ) THEN
    RAISE EXCEPTION 'Worker % does not exist, is inactive, or is not a WORKER', p_worker_id
      USING ERRCODE = '22000';
  END IF;

  -- 2. Lock the worker profile so one worker cannot concurrently claim multiple jobs.
  SELECT is_available INTO v_worker_available
  FROM worker_profiles
  WHERE user_id = p_worker_id
  FOR UPDATE;

  IF v_worker_available IS NOT TRUE THEN
    RAISE EXCEPTION 'Worker % is currently unavailable', p_worker_id
      USING ERRCODE = '22000';
  END IF;

  -- 3. Acquire an exclusive row lock on the job to serialize concurrent accept attempts.
  --    Only one concurrent transaction can hold this lock; the rest block here and,
  --    once released, observe the already-advanced status.
  SELECT j.status
  INTO v_current_status
  FROM jobs j
  WHERE j.id = p_job_id
  FOR UPDATE;

  IF v_current_status IS NULL THEN
    RAISE EXCEPTION 'Job % does not exist', p_job_id
      USING ERRCODE = '22000';
  END IF;

  -- 4. Only POSTED jobs may be claimed
  IF v_current_status <> 'POSTED' THEN
    RAISE EXCEPTION 'Job % is not claimable; current status is %', p_job_id, v_current_status
      USING ERRCODE = '55000';
  END IF;

  -- 5. Atomic transition POSTED -> ASSIGNED under the held lock
  UPDATE jobs
  SET status = 'ASSIGNED',
      worker_id = p_worker_id,
      updated_at = NOW()
  WHERE id = p_job_id;

  UPDATE worker_profiles
  SET is_available = FALSE,
      updated_at = NOW()
  WHERE user_id = p_worker_id;

  RETURN QUERY
    SELECT j.id, j.worker_id, j.status
    FROM jobs j
    WHERE j.id = p_job_id;
END;
$$;

COMMENT ON FUNCTION accept_job(UUID, UUID) IS
  'Atomically claims a job for a worker using FOR UPDATE row locking; only transitions POSTED -> ASSIGNED.';
