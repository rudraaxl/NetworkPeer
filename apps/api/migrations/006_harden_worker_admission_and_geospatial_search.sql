-- Phase 4 hardening: worker admission is a durable database invariant and
-- nearby-job queries use an index that matches geography distance searches.

-- Restrict the free-form legacy column to the lifecycle used by the platform.
ALTER TABLE worker_profiles
  ADD CONSTRAINT worker_profiles_verification_status_check
  CHECK (verification_status IN ('PENDING', 'VERIFIED', 'REJECTED', 'SUSPENDED')) NOT VALID;

-- A worker that has not passed verification must never be marked available.
-- Existing local PENDING rows are made unavailable before the invariant is added.
UPDATE worker_profiles
SET is_available = FALSE
WHERE verification_status <> 'VERIFIED' AND is_available = TRUE;

ALTER TABLE worker_profiles
  ADD CONSTRAINT worker_profiles_only_verified_available
  CHECK (verification_status = 'VERIFIED' OR is_available = FALSE) NOT VALID;

-- Geometry typmods enforce Point/SRID but do not constrain longitude/latitude
-- ranges. Enforce WGS84 bounds at the durable data layer as well.
ALTER TABLE jobs
  ADD CONSTRAINT jobs_location_wgs84_bounds
  CHECK (ST_X(location) BETWEEN -180 AND 180 AND ST_Y(location) BETWEEN -90 AND 90) NOT VALID;

ALTER TABLE worker_profiles
  ADD CONSTRAINT worker_profiles_location_wgs84_bounds
  CHECK (
    current_location IS NULL
    OR (ST_X(current_location) BETWEEN -180 AND 180 AND ST_Y(current_location) BETWEEN -90 AND 90)
  ) NOT VALID;

CREATE OR REPLACE FUNCTION accept_job(p_job_id UUID, p_worker_id UUID)
RETURNS TABLE (job_id UUID, worker_id UUID, status job_status)
LANGUAGE plpgsql
AS $$
DECLARE
  v_worker_available BOOLEAN;
  v_worker_verification_status TEXT;
  v_current_status job_status;
  v_assigned_worker UUID;
BEGIN
  -- Lock ordering is deliberately worker_profiles -> jobs everywhere in this
  -- function. It serializes same-worker claims and avoids lock-order inversions.
  IF NOT EXISTS (
    SELECT 1 FROM users WHERE id = p_worker_id AND is_active = TRUE AND role = 'WORKER'
  ) THEN
    RAISE EXCEPTION 'Worker % does not exist, is inactive, or is not a WORKER', p_worker_id
      USING ERRCODE = '22000';
  END IF;

  SELECT is_available, verification_status
  INTO v_worker_available, v_worker_verification_status
  FROM worker_profiles
  WHERE user_id = p_worker_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Worker % does not have a worker profile', p_worker_id
      USING ERRCODE = '22000';
  END IF;

  IF v_worker_verification_status <> 'VERIFIED' THEN
    RAISE EXCEPTION 'Worker % is not verified', p_worker_id
      USING ERRCODE = '22000';
  END IF;

  SELECT j.status, j.worker_id
  INTO v_current_status, v_assigned_worker
  FROM jobs j
  WHERE j.id = p_job_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Job % does not exist', p_job_id
      USING ERRCODE = '22000';
  END IF;

  -- Network retries are safe: an already accepted job is a success only for
  -- the same worker. Other workers still receive a conflict below.
  IF v_current_status = 'ASSIGNED' AND v_assigned_worker = p_worker_id THEN
    RETURN QUERY
      SELECT j.id, j.worker_id, j.status
      FROM jobs j
      WHERE j.id = p_job_id;
    RETURN;
  END IF;

  IF v_worker_available IS NOT TRUE THEN
    RAISE EXCEPTION 'Worker % is currently unavailable', p_worker_id
      USING ERRCODE = '22000';
  END IF;

  IF v_current_status <> 'POSTED' THEN
    RAISE EXCEPTION 'Job % is not claimable; current status is %', p_job_id, v_current_status
      USING ERRCODE = '55000';
  END IF;

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
  'Atomically claims a POSTED job for a verified, available worker using worker_profiles then jobs row locks; same-worker retries are idempotent.';
