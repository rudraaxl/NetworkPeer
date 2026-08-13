-- @nontransactional
-- Rebuild the Phase 4 index so an invalid concurrent build can never be
-- mistaken for a usable index, and make one active assignment per worker a
-- database invariant.
DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM jobs
    WHERE worker_id IS NOT NULL
      AND status IN ('ASSIGNED', 'EN_ROUTE', 'AT_LOCATION', 'IN_PROGRESS', 'SUBMITTED', 'APPROVED', 'DISPUTED')
    GROUP BY worker_id
    HAVING COUNT(*) > 1
  ) THEN
    RAISE EXCEPTION 'Cannot add one-active-job-per-worker index: resolve duplicate active assignments first'
      USING ERRCODE = '23514';
  END IF;
END;
$$;

-- @statement
DROP INDEX CONCURRENTLY IF EXISTS idx_jobs_posted_geography;

-- @statement
CREATE INDEX CONCURRENTLY idx_jobs_posted_geography
  ON jobs USING GIST ((location::geography))
  WHERE status = 'POSTED' AND worker_id IS NULL;

-- @statement
DROP INDEX CONCURRENTLY IF EXISTS idx_jobs_one_active_job_per_worker;

-- @statement
CREATE UNIQUE INDEX CONCURRENTLY idx_jobs_one_active_job_per_worker
  ON jobs (worker_id)
  WHERE worker_id IS NOT NULL
    AND status IN ('ASSIGNED', 'EN_ROUTE', 'AT_LOCATION', 'IN_PROGRESS', 'SUBMITTED', 'APPROVED', 'DISPUTED');

-- @statement
-- The shared application role may claim work only through this function.
ALTER FUNCTION accept_job(UUID, UUID)
  SECURITY DEFINER
  SET search_path = pg_catalog, public;

-- Profile locking here matches accept_job's worker_profiles -> jobs lock order.
-- It prevents an administrator from reactivating a worker who still owns work.
-- @statement
CREATE OR REPLACE FUNCTION set_worker_verification(
  p_worker_id UUID,
  p_verification_status VARCHAR,
  p_is_available BOOLEAN
)
RETURNS TABLE (
  verification_status VARCHAR,
  preferred_radius_km INTEGER,
  is_available BOOLEAN
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
BEGIN
  PERFORM 1
  FROM public.worker_profiles
  WHERE user_id = p_worker_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RETURN;
  END IF;

  IF p_verification_status = 'VERIFIED' AND p_is_available THEN
    PERFORM 1
    FROM public.jobs
    WHERE worker_id = p_worker_id
      AND status IN ('ASSIGNED', 'EN_ROUTE', 'AT_LOCATION', 'IN_PROGRESS', 'SUBMITTED', 'APPROVED', 'DISPUTED')
    FOR UPDATE;

    IF FOUND THEN
      RAISE EXCEPTION 'Worker has an active job'
        USING ERRCODE = '55000';
    END IF;
  END IF;

  UPDATE public.worker_profiles
  SET verification_status = p_verification_status,
      is_available = CASE WHEN p_verification_status = 'VERIFIED' THEN p_is_available ELSE FALSE END,
      updated_at = NOW()
  WHERE user_id = p_worker_id
  RETURNING worker_profiles.verification_status,
            worker_profiles.preferred_radius_km,
            worker_profiles.is_available
  INTO verification_status, preferred_radius_km, is_available;

  RETURN NEXT;
END;
$$;

COMMENT ON FUNCTION set_worker_verification(UUID, VARCHAR, BOOLEAN) IS
  'Updates worker verification under the profile lock and refuses activation while active work exists.';

REVOKE EXECUTE ON FUNCTION accept_job(UUID, UUID) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION set_worker_verification(UUID, VARCHAR, BOOLEAN) FROM PUBLIC;
