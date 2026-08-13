-- A valid lifecycle transition alone is not enough: direct SQL must not move an
-- in-progress job to SUBMITTED until every required checklist item has usable
-- evidence. This is intentionally separate from the HTTP/service workflow.
CREATE OR REPLACE FUNCTION enforce_job_submission_evidence()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  IF OLD.status = 'IN_PROGRESS' AND NEW.status = 'SUBMITTED' AND EXISTS (
    SELECT 1
    FROM public.job_subtasks s
    WHERE s.job_id = NEW.id
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
  RETURN NEW;
END;
$$;

CREATE TRIGGER enforce_job_submission_evidence
  BEFORE UPDATE OF status ON jobs
  FOR EACH ROW EXECUTE FUNCTION enforce_job_submission_evidence();
