-- Output-column names in RETURNS TABLE are PL/pgSQL variables. Qualify the
-- jobs columns so the submit function remains unambiguous at runtime.
CREATE OR REPLACE FUNCTION submit_job_with_evidence(p_job_id UUID, p_worker_id UUID)
RETURNS TABLE (job_id UUID, status job_status)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  v_status job_status;
  v_assigned_worker UUID;
BEGIN
  SELECT j.status, j.worker_id
  INTO v_status, v_assigned_worker
  FROM public.jobs j
  WHERE j.id = p_job_id
  FOR UPDATE;

  IF NOT FOUND OR v_assigned_worker IS DISTINCT FROM p_worker_id THEN
    RAISE EXCEPTION 'Job not found'
      USING ERRCODE = 'P0002';
  END IF;

  IF v_status = 'SUBMITTED' THEN
    RETURN QUERY
      SELECT j.id, j.status
      FROM public.jobs j
      WHERE j.id = p_job_id;
    RETURN;
  END IF;

  IF v_status <> 'IN_PROGRESS' THEN
    RAISE EXCEPTION 'Job cannot be submitted in its current state'
      USING ERRCODE = '55000';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM public.job_subtasks s
    WHERE s.job_id = p_job_id
      AND s.is_required = TRUE
      AND (
        s.status <> 'COMPLETED'
        OR NOT EXISTS (
          SELECT 1
          FROM public.job_subtask_media m
          WHERE m.job_id = s.job_id
            AND m.subtask_id = s.id
            AND m.status IN ('UPLOADED', 'VERIFIED')
        )
      )
  ) THEN
    RAISE EXCEPTION 'Required subtask evidence is incomplete'
      USING ERRCODE = '23514';
  END IF;

  UPDATE public.jobs
  SET status = 'SUBMITTED',
      updated_at = NOW()
  WHERE id = p_job_id;

  RETURN QUERY
    SELECT j.id, j.status
    FROM public.jobs j
    WHERE j.id = p_job_id;
END;
$$;
