-- Keep suspension-specific frozen transitions while rejecting every other
-- noncanonical audit authorization before it can reach the job trigger.
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
  v_suspension_cause := (NEW.metadata ->> 'cause') IN ('CLIENT_SUSPENDED', 'WORKER_SUSPENDED');
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

  IF NEW.action = 'JOB_STATUS_OVERRIDE' THEN
    IF NOT (
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
      RAISE EXCEPTION 'Administrative status transition is not canonical' USING ERRCODE = '23514';
    END IF;
    RETURN NEW;
  END IF;

  IF NEW.action = 'JOB_CANCELLED' THEN
    IF NOT (
      (v_from_status = 'POSTED' AND v_to_status = 'CANCELLED') OR
      (v_from_status = 'ASSIGNED' AND v_to_status = 'CANCELLED') OR
      (v_from_status = 'EN_ROUTE' AND v_to_status = 'CANCELLED') OR
      (v_from_status = 'AT_LOCATION' AND v_to_status = 'CANCELLED') OR
      (v_from_status = 'IN_PROGRESS' AND v_to_status = 'CANCELLED')
    ) THEN
      RAISE EXCEPTION 'Administrative cancellation is not canonical' USING ERRCODE = '23514';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;
