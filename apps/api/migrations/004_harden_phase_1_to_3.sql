-- Hardening migration for Phase 1-3 invariants that must hold even when SQL is
-- issued outside the HTTP application layer.

-- A subtask ID must be paired with its own job. The original independent
-- foreign keys allowed evidence for job A to reference a subtask from job B.
ALTER TABLE job_subtasks
  ADD CONSTRAINT job_subtasks_id_job_id_key UNIQUE (id, job_id);

ALTER TABLE job_subtask_media
  DROP CONSTRAINT job_subtask_media_subtask_id_fkey;

ALTER TABLE job_subtask_media
  ADD CONSTRAINT job_subtask_media_subtask_job_fkey
  FOREIGN KEY (subtask_id, job_id)
  REFERENCES job_subtasks (id, job_id)
  ON DELETE CASCADE;

-- POSTED jobs must not already be assigned, and every active lifecycle state
-- must have exactly one worker. CANCELLED intentionally permits either shape.
ALTER TABLE jobs
  ADD CONSTRAINT jobs_posted_has_no_worker
  CHECK (status <> 'POSTED' OR worker_id IS NULL);

ALTER TABLE jobs
  ADD CONSTRAINT jobs_active_lifecycle_requires_worker
  CHECK (
    status NOT IN ('ASSIGNED', 'EN_ROUTE', 'AT_LOCATION', 'IN_PROGRESS', 'SUBMITTED', 'APPROVED', 'COMPLETED', 'DISPUTED')
    OR worker_id IS NOT NULL
  );

-- Roles are identity-bound. Allowing a user role to change after jobs or a
-- profile exist silently invalidates the role checks on those dependent rows.
CREATE OR REPLACE FUNCTION prevent_user_role_change()
RETURNS TRIGGER AS $$
BEGIN
  IF NEW.role <> OLD.role THEN
    RAISE EXCEPTION 'A user role cannot be changed after account creation'
      USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER prevent_user_role_change
  BEFORE UPDATE OF role ON users
  FOR EACH ROW EXECUTE FUNCTION prevent_user_role_change();

-- Evidence may only be submitted by the worker assigned to the same job.
CREATE OR REPLACE FUNCTION enforce_job_subtask_media_worker()
RETURNS TRIGGER AS $$
DECLARE
  v_assigned_worker UUID;
BEGIN
  SELECT worker_id INTO v_assigned_worker
  FROM jobs
  WHERE id = NEW.job_id;

  IF v_assigned_worker IS NULL OR NEW.worker_id <> v_assigned_worker THEN
    RAISE EXCEPTION 'job_subtask_media.worker_id must be the worker assigned to the job'
      USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER enforce_job_subtask_media_worker
  BEFORE INSERT OR UPDATE OF job_id, worker_id ON job_subtask_media
  FOR EACH ROW EXECUTE FUNCTION enforce_job_subtask_media_worker();
