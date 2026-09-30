-- Migration 051: a job must carry evidence before it can be submitted, and
-- before its escrow can be released.
--
-- THE HOLE. Both submission gates -- submit_job_with_evidence (last rewritten in
-- 018) and the enforce_job_submission_evidence trigger (016) -- ask the same
-- question:
--
--   IF EXISTS (SELECT 1 FROM job_subtasks s
--              WHERE s.job_id = ... AND s.is_required = TRUE
--                AND (s.status <> 'COMPLETED' OR NOT EXISTS (usable media)))
--   THEN RAISE ...
--
-- That is "no REQUIRED subtask is missing its evidence", which is not the same
-- thing as "this job has evidence". It is vacuously true in two shapes:
--
--   1. The job has no subtasks at all. subtasks is optional on job creation --
--      JobService normalises `params.subtasks ?? []` and the client-jobs route
--      accepts the field being absent -- so a client who does not spell out a
--      checklist produces a job with zero rows in job_subtasks.
--   2. The job has subtasks but every one has is_required = FALSE.
--
-- In either shape the EXISTS finds nothing, no exception is raised, and the job
-- moves IN_PROGRESS -> SUBMITTED having never had a single byte uploaded.
--
-- WHY THAT IS A PAYOUT BUG, not just a data-quality one.
-- approve_client_job_with_settlement (030) is the function that moves the money.
-- Its only preconditions are status = 'SUBMITTED' and escrow_status = 'HELD'. It
-- does not look at evidence at all -- it never had to, because the submit gate
-- was assumed to have done so. So the vacuous gate above was the ONLY thing
-- standing between an empty job and a released escrow: submit with nothing
-- attached, get approved, and the worker is paid for no delivered work with
-- nothing in the record to dispute against.
--
-- WHAT THIS CHANGES.
--   * job_has_usable_evidence(job) -- one definition of "usable", so the three
--     call sites cannot drift apart again. Usable means an UPLOADED or VERIFIED
--     row whose S3 identity is fully pinned, which is the same predicate 016 and
--     018 already used inline, including 016's guard against the literal string
--     'null' having been written into s3_version_id.
--   * submit_job_with_evidence and enforce_job_submission_evidence: keep the
--     per-required-subtask rule AND add "the job has at least one usable file".
--   * approve_client_job_with_settlement: refuses to settle a job with no usable
--     evidence. Defence in depth -- this is the layer where money actually
--     moves, so it should not depend on an upstream gate being correct. It is
--     also the layer that protects jobs that reached SUBMITTED before today.
--
-- ON ALREADY-SUBMITTED JOBS. Any job sitting in SUBMITTED with no usable
-- evidence can no longer be approved; the client gets
-- EVIDENCE_REQUIRED_FOR_PAYOUT (55000) instead of a silent payout. That is the
-- intended outcome -- refusing to pay for nothing -- but it does mean such a job
-- has to be resolved by the worker uploading evidence or by a cancellation
-- rather than by approval. Nothing is migrated or rewritten: no existing row is
-- touched by this migration at all.
--
-- ON THE ERROR CODES. The existing "required evidence incomplete" path keeps
-- 23514 so the API's current mapping to REQUIRED_EVIDENCE_INCOMPLETE is
-- unchanged. The new no-evidence-at-all condition raises 55000 at the settlement
-- layer, which work-evidence-service and ledger-service already surface as a
-- "not ready" conflict rather than a 500.

-- One shared definition of usable evidence. STABLE rather than IMMUTABLE: it
-- reads tables. SECURITY INVOKER (the default) is deliberate -- it must be
-- evaluated with the privileges of whatever calls it, and every caller either
-- already holds the rows or is itself SECURITY DEFINER.
CREATE OR REPLACE FUNCTION job_has_usable_evidence(p_job_id UUID)
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SET search_path = pg_catalog, public, pg_temp
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.job_subtask_media AS m
    WHERE m.job_id = p_job_id
      AND m.status IN ('UPLOADED', 'VERIFIED')
      AND m.checksum_sha256 IS NOT NULL
      AND m.s3_etag IS NOT NULL
      AND m.s3_version_id IS NOT NULL
      AND lower(btrim(m.s3_version_id)) <> 'null'
  );
$$;

COMMENT ON FUNCTION job_has_usable_evidence(UUID) IS
  'True when the job holds at least one confirmed, S3-pinned evidence file. Used by the submission gates and by approval settlement so all three agree on what counts.';

-- Direct-SQL guard. Unchanged in shape from 016 apart from the added floor.
CREATE OR REPLACE FUNCTION enforce_job_submission_evidence()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  IF OLD.status = 'IN_PROGRESS' AND NEW.status = 'SUBMITTED' THEN
    -- The floor: regardless of how the checklist was configured, or whether one
    -- was configured at all, a submission has to carry something.
    IF NOT public.job_has_usable_evidence(NEW.id) THEN
      RAISE EXCEPTION 'Job cannot be submitted without evidence' USING ERRCODE = '23514';
    END IF;

    IF EXISTS (
      SELECT 1
      FROM public.job_subtasks AS s
      WHERE s.job_id = NEW.id
        AND s.is_required = TRUE
        AND (
          s.status <> 'COMPLETED'
          OR NOT EXISTS (
            SELECT 1
            FROM public.job_subtask_media AS m
            WHERE m.job_id = s.job_id
              AND m.subtask_id = s.id
              AND m.status IN ('UPLOADED', 'VERIFIED')
              AND m.checksum_sha256 IS NOT NULL
              AND m.s3_etag IS NOT NULL
              AND m.s3_version_id IS NOT NULL
              AND lower(btrim(m.s3_version_id)) <> 'null'
          )
        )
    ) THEN
      RAISE EXCEPTION 'Required subtask evidence is incomplete' USING ERRCODE = '23514';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

-- The application's submission path. Body carried over from 018 verbatim except
-- for the added floor, so the worker/ownership/locking semantics are untouched.
CREATE OR REPLACE FUNCTION submit_job_with_evidence(p_job_id UUID, p_worker_id UUID)
RETURNS TABLE (job_id UUID, status job_status)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public, pg_temp
AS $$
DECLARE
  v_status job_status;
  v_assigned_worker UUID;
BEGIN
  PERFORM 1
  FROM public.users AS u
  JOIN public.worker_profiles AS wp ON wp.user_id = u.id
  WHERE u.id = p_worker_id
    AND u.is_active = TRUE
    AND u.role = 'WORKER'
    AND wp.verification_status = 'VERIFIED'
  FOR UPDATE OF wp;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Job not found' USING ERRCODE = 'P0002';
  END IF;

  SELECT j.status, j.worker_id INTO v_status, v_assigned_worker
  FROM public.jobs AS j WHERE j.id = p_job_id FOR UPDATE;
  IF NOT FOUND OR v_assigned_worker IS DISTINCT FROM p_worker_id THEN
    RAISE EXCEPTION 'Job not found' USING ERRCODE = 'P0002';
  END IF;
  IF v_status = 'SUBMITTED' THEN
    RETURN QUERY SELECT j.id, j.status FROM public.jobs AS j WHERE j.id = p_job_id;
    RETURN;
  END IF;
  IF v_status <> 'IN_PROGRESS' THEN
    RAISE EXCEPTION 'Job cannot be submitted in its current state' USING ERRCODE = '55000';
  END IF;

  -- The floor, checked before the per-subtask rule so a job with no checklist
  -- gets the accurate message rather than passing silently.
  IF NOT public.job_has_usable_evidence(p_job_id) THEN
    RAISE EXCEPTION 'Job cannot be submitted without evidence' USING ERRCODE = '23514';
  END IF;

  IF EXISTS (
    SELECT 1 FROM public.job_subtasks AS s
    WHERE s.job_id = p_job_id
      AND s.is_required = TRUE
      AND (
        s.status <> 'COMPLETED'
        OR NOT EXISTS (
          SELECT 1 FROM public.job_subtask_media AS m
          WHERE m.job_id = s.job_id
            AND m.subtask_id = s.id
            AND m.status IN ('UPLOADED', 'VERIFIED')
            AND m.checksum_sha256 IS NOT NULL
            AND m.s3_etag IS NOT NULL
            AND m.s3_version_id IS NOT NULL
            AND lower(btrim(m.s3_version_id)) <> 'null'
        )
      )
  ) THEN
    RAISE EXCEPTION 'Required subtask evidence is incomplete' USING ERRCODE = '23514';
  END IF;

  UPDATE public.jobs AS j SET status = 'SUBMITTED', updated_at = NOW() WHERE j.id = p_job_id;
  RETURN QUERY SELECT j.id, j.status FROM public.jobs AS j WHERE j.id = p_job_id;
END;
$$;

-- The payout guard.
--
-- Deliberately a trigger rather than an edit to approve_client_job_with_settlement.
-- That function is ~200 lines of locking, idempotency-fingerprint and ledger
-- work; reproducing it here to insert one IF would risk silently dropping one of
-- its existing guards in transcription. A BEFORE UPDATE trigger composes with it
-- instead -- it fires inside the settlement transaction, so raising here aborts
-- the whole settlement, ledger postings and payment operation included.
--
-- It covers both routes to APPROVED that a client can drive:
--   * approve_client_job_with_settlement (030), which releases escrow, and
--   * the review/APPROVE branch in 018, which does not.
-- and independently refuses any move of escrow_status to RELEASED, because that
-- is the single statement where the money actually leaves escrow.
--
-- DISPUTED -> APPROVED is intentionally NOT covered. That is an admin
-- adjudication, it does not run the settlement function, and it does not release
-- escrow -- settlement requires status = 'SUBMITTED'. An adjudicated outcome
-- should not be overridden by this rule.
CREATE OR REPLACE FUNCTION enforce_job_payout_evidence()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  IF OLD.status = 'SUBMITTED' AND NEW.status = 'APPROVED'
     AND NOT public.job_has_usable_evidence(NEW.id) THEN
    RAISE EXCEPTION 'Job cannot be approved without evidence' USING ERRCODE = '55000';
  END IF;

  IF OLD.escrow_status IS DISTINCT FROM 'RELEASED' AND NEW.escrow_status = 'RELEASED'
     AND NOT public.job_has_usable_evidence(NEW.id) THEN
    RAISE EXCEPTION 'Escrow cannot be released without evidence' USING ERRCODE = '55000';
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS enforce_job_payout_evidence ON jobs;
CREATE TRIGGER enforce_job_payout_evidence
  BEFORE UPDATE OF status, escrow_status ON jobs
  FOR EACH ROW EXECUTE FUNCTION enforce_job_payout_evidence();

-- Privileges, following the pattern 023 established for settlement functions:
-- new functions are revoked from PUBLIC rather than left with the EXECUTE that
-- CREATE FUNCTION grants by default.
--
-- The explicit grants are belt and braces. Every UPDATE that can reach these
-- triggers runs inside a SECURITY DEFINER function -- networkpeer_app holds only
-- SELECT on jobs, never UPDATE -- so current_user at trigger time is the function
-- owner and the predicate would resolve regardless. Granting anyway costs nothing:
-- job_has_usable_evidence is SECURITY INVOKER and reads only job_subtask_media,
-- which these roles can already SELECT, so it discloses nothing they could not
-- query directly. The conditional guard keeps the migration runnable on a
-- database provisioned without these roles, such as a local or CI instance.
REVOKE EXECUTE ON FUNCTION job_has_usable_evidence(UUID) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION enforce_job_payout_evidence() FROM PUBLIC;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'networkpeer_app') THEN
    EXECUTE 'GRANT EXECUTE ON FUNCTION public.job_has_usable_evidence(UUID) TO networkpeer_app';
  END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'networkpeer_admin_api') THEN
    EXECUTE 'GRANT EXECUTE ON FUNCTION public.job_has_usable_evidence(UUID) TO networkpeer_admin_api';
  END IF;
END;
$$;
