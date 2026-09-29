-- Migration 050: clear the test data held by two named accounts.
--
-- This is a data migration, not a schema change. It exists because the
-- database sits in a private subnet with no bastion and ECS Exec disabled, so
-- a migration is the only route to it, and because the work it does cannot be
-- done through the API: cancel_client_job only accepts FUNDING/UNFUNDED jobs,
-- and both admin paths that could retire a POSTED one require an ADMIN
-- principal that can only be granted in SQL.
--
-- WHAT IT DELETES: every job posted by rudraax.mini@gmail.com or worked by
-- vipulrs28dec@gmail.com, and everything hanging off those jobs -- subtasks,
-- evidence rows, ledger postings and transactions, payment operations and
-- their webhook events. Both user accounts SURVIVE, with their profiles reset
-- so the next job is their first.
--
-- WHAT IT DOES NOT TOUCH: the objects in S3. The evidence rows go, so nothing
-- references those photographs any more, but the bytes stay in
-- networkpeer-media-staging-trivaro. That was a deliberate choice -- they are
-- recoverable if a specific photograph turns out to have been wanted, at the
-- cost of storing files nothing points at.
--
-- ON MAINTENANCE MODE: ledger postings, transactions and accounts are all
-- immutable by trigger, and deleting one normally raises 55000. Each of those
-- triggers checks networkpeer.maintenance_mode first and yields when it is on
-- -- see 024 and 025, whose comment states the intent: "Constraint triggers
-- remain strict for runtime writes but skip migration-owner maintenance
-- transactions." This is the supported path for exactly this operation, not a
-- way around the rules. set_config's third argument scopes it to this
-- transaction, so it cannot leak into anything the API later runs.
--
-- ON THE CIRCULAR REFERENCE: jobs and ledger_transactions reference each
-- other. Deleting the transactions first fails on jobs' two RESTRICT columns;
-- deleting the jobs first fails on ledger_transactions.job_id. The knot is cut
-- by nulling those two columns on the jobs being removed, which no trigger
-- objects to, before deleting either table.
--
-- The whole block is defensive: it resolves the accounts by address, does
-- nothing at all if neither exists, and reports what it removed. Re-running it
-- is harmless, because the second run finds no jobs.

DO $$
DECLARE
  v_client_id  UUID;
  v_worker_id  UUID;
  v_job_ids    UUID[];
  v_txn_ids    UUID[];
  v_jobs       INTEGER := 0;
  v_media      INTEGER := 0;
  v_subtasks   INTEGER := 0;
  v_postings   INTEGER := 0;
  v_txns       INTEGER := 0;
  v_ops        INTEGER := 0;
  v_events     INTEGER := 0;
BEGIN
  PERFORM set_config('networkpeer.maintenance_mode', 'on', TRUE);

  SELECT id INTO v_client_id FROM public.users
  WHERE lower(email) = lower('rudraax.mini@gmail.com');

  SELECT id INTO v_worker_id FROM public.users
  WHERE lower(email) = lower('vipulrs28dec@gmail.com');

  IF v_client_id IS NULL AND v_worker_id IS NULL THEN
    RAISE NOTICE '050: neither account exists; nothing to do';
    RETURN;
  END IF;

  RAISE NOTICE '050: client=% worker=%', v_client_id, v_worker_id;

  -- Every job either account touched, from either side.
  SELECT COALESCE(array_agg(j.id), '{}'::uuid[])
  INTO v_job_ids
  FROM public.jobs AS j
  WHERE (v_client_id IS NOT NULL AND j.client_id = v_client_id)
     OR (v_worker_id IS NOT NULL AND j.worker_id = v_worker_id);

  IF array_length(v_job_ids, 1) IS NULL THEN
    RAISE NOTICE '050: no jobs found for either account';
  ELSE
    -- Both sides of every posting have to go together, so the transactions are
    -- collected first and postings removed by transaction as well as by job.
    -- A transaction's other leg belongs to the platform account, which has no
    -- job_id of its own and would otherwise be left orphaned.
    SELECT COALESCE(array_agg(t.id), '{}'::uuid[])
    INTO v_txn_ids
    FROM public.ledger_transactions AS t
    WHERE t.job_id = ANY(v_job_ids);

    DELETE FROM public.payment_webhook_events
    WHERE payment_operation_id IN (
      SELECT id FROM public.payment_operations WHERE job_id = ANY(v_job_ids)
    );
    GET DIAGNOSTICS v_events = ROW_COUNT;

    DELETE FROM public.payment_operations WHERE job_id = ANY(v_job_ids);
    GET DIAGNOSTICS v_ops = ROW_COUNT;

    DELETE FROM public.wallet_ledger
    WHERE job_id = ANY(v_job_ids)
       OR (array_length(v_txn_ids, 1) IS NOT NULL AND ledger_transaction_id = ANY(v_txn_ids));
    GET DIAGNOSTICS v_postings = ROW_COUNT;

    -- jobs points BACK at ledger_transactions through two columns, both
    -- ON DELETE RESTRICT (migration 023): escrow_ledger_transaction_id and
    -- settlement_ledger_transaction_id. The reference is circular -- a job
    -- names its escrow transaction while that transaction names the job -- so
    -- the transactions cannot be deleted while the jobs still point at them,
    -- even though the jobs are about to be deleted themselves. The first
    -- attempt at this migration failed here with 23503 for exactly that reason.
    --
    -- Clearing the columns first is safe: enforce_job_financial_state only
    -- compares status against escrow_status and never reads these, and
    -- enforce_job_lifecycle_transition returns immediately when the status is
    -- unchanged.
    UPDATE public.jobs
    SET escrow_ledger_transaction_id = NULL,
        settlement_ledger_transaction_id = NULL
    WHERE id = ANY(v_job_ids);

    DELETE FROM public.ledger_transactions WHERE job_id = ANY(v_job_ids);
    GET DIAGNOSTICS v_txns = ROW_COUNT;

    -- Both of these cascade from jobs anyway; they are explicit so the counts
    -- appear in the log rather than happening silently.
    DELETE FROM public.job_subtask_media WHERE job_id = ANY(v_job_ids);
    GET DIAGNOSTICS v_media = ROW_COUNT;

    DELETE FROM public.job_subtasks WHERE job_id = ANY(v_job_ids);
    GET DIAGNOSTICS v_subtasks = ROW_COUNT;

    DELETE FROM public.jobs WHERE id = ANY(v_job_ids);
    GET DIAGNOSTICS v_jobs = ROW_COUNT;
  END IF;

  -- The counter is stored rather than derived, so it has to be reset by hand
  -- or the worker keeps a completion count for jobs that no longer exist. The
  -- rating goes with it: it was computed from those same jobs.
  IF v_worker_id IS NOT NULL THEN
    UPDATE public.worker_profiles
    SET total_jobs_completed = 0,
        rating = 0.00,
        is_available = TRUE,
        updated_at = NOW()
    WHERE user_id = v_worker_id;
  END IF;

  RAISE NOTICE '050: removed % job(s), % subtask(s), % evidence row(s), % posting(s), % transaction(s), % payment op(s), % webhook event(s)',
    v_jobs, v_subtasks, v_media, v_postings, v_txns, v_ops, v_events;
END;
$$;
