-- The API uses src/state-machine.ts for workflow decisions, while this trigger
-- makes the same lifecycle invariant durable at the PostgreSQL source of truth.

ALTER TABLE job_subtasks
  ADD CONSTRAINT job_subtasks_job_sequence_key UNIQUE (job_id, sequence_order);

CREATE OR REPLACE FUNCTION enforce_job_lifecycle_transition()
RETURNS TRIGGER AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    IF NEW.status <> 'POSTED' THEN
      RAISE EXCEPTION 'Jobs must be created in POSTED status'
        USING ERRCODE = '23514';
    END IF;
    RETURN NEW;
  END IF;

  IF NEW.status = OLD.status THEN
    RETURN NEW;
  END IF;

  IF NOT (
    (OLD.status = 'POSTED' AND NEW.status IN ('ASSIGNED', 'CANCELLED')) OR
    (OLD.status = 'ASSIGNED' AND NEW.status IN ('EN_ROUTE', 'CANCELLED', 'DISPUTED')) OR
    (OLD.status = 'EN_ROUTE' AND NEW.status IN ('AT_LOCATION', 'CANCELLED', 'DISPUTED')) OR
    (OLD.status = 'AT_LOCATION' AND NEW.status IN ('IN_PROGRESS', 'CANCELLED', 'DISPUTED')) OR
    (OLD.status = 'IN_PROGRESS' AND NEW.status IN ('SUBMITTED', 'CANCELLED', 'DISPUTED')) OR
    (OLD.status = 'SUBMITTED' AND NEW.status IN ('APPROVED', 'DISPUTED')) OR
    (OLD.status = 'APPROVED' AND NEW.status IN ('COMPLETED', 'DISPUTED')) OR
    (OLD.status = 'DISPUTED' AND NEW.status = 'APPROVED')
  ) THEN
    RAISE EXCEPTION 'Invalid job state transition: % -> %', OLD.status, NEW.status
      USING ERRCODE = '23514';
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER enforce_job_lifecycle_transition
  BEFORE INSERT OR UPDATE OF status ON jobs
  FOR EACH ROW EXECUTE FUNCTION enforce_job_lifecycle_transition();
