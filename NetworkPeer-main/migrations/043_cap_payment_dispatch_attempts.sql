-- Payment dispatch previously retried a failing operation forever.
-- release_payment_operation_dispatch backs off to a 300s ceiling but never stops,
-- and claim_payment_operations_for_dispatch orders by next_dispatch_at ASC, so an
-- operation that can never succeed -- a payout to a worker with no payout account,
-- for instance -- sorts first and consumes the batch on every sweep, delaying
-- healthy payouts behind it.
--
-- This caps how many times an operation is claimed. Exhausted operations are left
-- in CREATED with their money state untouched: whether a worker ultimately gets
-- paid is an operator decision, not something a retry loop should decide, and
-- moving them to FAILED would mark their ledger transaction failed (see
-- settle_payment_webhook in 023). They stop being claimed, become visible through
-- list_exhausted_payment_operations, and an admin requeues them with
-- reset_payment_operation_dispatch once the underlying cause is fixed.

CREATE OR REPLACE FUNCTION payment_dispatch_max_attempts()
RETURNS INTEGER
LANGUAGE sql
IMMUTABLE
AS $$ SELECT 12 $$;

COMMENT ON FUNCTION payment_dispatch_max_attempts() IS
  'Claim ceiling for payment dispatch. With the exponential backoff in '
  '036_harden_payment_reversals_and_dispatch, 12 attempts spans roughly 30 minutes '
  'before an operation is parked for operator review.';

CREATE OR REPLACE FUNCTION claim_payment_operations_for_dispatch(p_limit INTEGER)
RETURNS TABLE (
  operation_id UUID,
  operation_type payment_operation_type,
  provider VARCHAR,
  amount_cents BIGINT,
  currency CHAR(3),
  client_user_id UUID,
  worker_user_id UUID,
  payout_destination_reference VARCHAR
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public, pg_temp
AS $$
BEGIN
  IF p_limit < 1 OR p_limit > 100 THEN
    RAISE EXCEPTION 'Dispatch limit is invalid' USING ERRCODE = '22023';
  END IF;
  RETURN QUERY
  WITH candidate AS (
    SELECT operation.id
    FROM public.payment_operations AS operation
    WHERE operation.status = 'CREATED'
      AND operation.next_dispatch_at <= NOW()
      AND operation.dispatch_attempts < payment_dispatch_max_attempts()
      AND (
        operation.dispatch_lease_expires_at IS NULL
        OR operation.dispatch_lease_expires_at <= NOW()
      )
    ORDER BY operation.next_dispatch_at ASC, operation.created_at ASC
    FOR UPDATE SKIP LOCKED
    LIMIT p_limit
  ), claimed AS (
    UPDATE public.payment_operations AS operation
    SET dispatch_attempts = operation.dispatch_attempts + 1,
        dispatch_lease_expires_at = NOW() + INTERVAL '1 minute'
    FROM candidate
    WHERE operation.id = candidate.id
    RETURNING operation.id, operation.operation_type, operation.provider,
      operation.amount_cents, operation.currency, operation.client_user_id,
      operation.worker_user_id, operation.payout_destination_reference
  )
  SELECT * FROM claimed;
END;
$$;

-- Without this an exhausted operation is silently invisible: it stops being
-- claimed and nothing surfaces it.
CREATE OR REPLACE FUNCTION list_exhausted_payment_operations(p_limit INTEGER DEFAULT 50)
RETURNS TABLE (
  operation_id UUID,
  operation_type payment_operation_type,
  job_id UUID,
  amount_cents BIGINT,
  currency CHAR(3),
  client_user_id UUID,
  worker_user_id UUID,
  dispatch_attempts INTEGER,
  last_dispatch_error TEXT,
  created_at TIMESTAMPTZ
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public, pg_temp
AS $$
BEGIN
  IF p_limit < 1 OR p_limit > 200 THEN
    RAISE EXCEPTION 'Listing limit is invalid' USING ERRCODE = '22023';
  END IF;
  RETURN QUERY
  SELECT operation.id, operation.operation_type, operation.job_id,
         operation.amount_cents, operation.currency, operation.client_user_id,
         operation.worker_user_id, operation.dispatch_attempts,
         operation.last_dispatch_error, operation.created_at
  FROM public.payment_operations AS operation
  WHERE operation.status = 'CREATED'
    AND operation.dispatch_attempts >= payment_dispatch_max_attempts()
  ORDER BY operation.created_at ASC
  LIMIT p_limit;
END;
$$;

-- Requeue after the underlying cause is fixed. Deliberately admin-only and
-- audited: it puts money back in motion.
CREATE OR REPLACE FUNCTION reset_payment_operation_dispatch(
  p_actor_user_id UUID,
  p_operation_id UUID,
  p_reason TEXT
)
RETURNS TABLE (
  operation_id UUID,
  dispatch_attempts INTEGER,
  next_dispatch_at TIMESTAMPTZ
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public, pg_temp
AS $$
#variable_conflict use_column
DECLARE
  v_reason TEXT := btrim(COALESCE(p_reason, ''));
  v_status payment_operation_status;
  v_attempts INTEGER;
BEGIN
  IF length(v_reason) < 3 THEN
    RAISE EXCEPTION 'A reason is required to requeue a payment operation' USING ERRCODE = '22023';
  END IF;

  PERFORM assert_active_admin(p_actor_user_id);

  SELECT operation.status, operation.dispatch_attempts
  INTO v_status, v_attempts
  FROM public.payment_operations AS operation
  WHERE operation.id = p_operation_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Payment operation not found' USING ERRCODE = 'P0002';
  END IF;
  IF v_status <> 'CREATED' THEN
    RAISE EXCEPTION 'Only an undispatched payment operation can be requeued' USING ERRCODE = '55000';
  END IF;
  IF v_attempts < payment_dispatch_max_attempts() THEN
    RAISE EXCEPTION 'Payment operation has not exhausted its dispatch attempts' USING ERRCODE = '55000';
  END IF;

  UPDATE public.payment_operations AS operation
  SET dispatch_attempts = 0,
      next_dispatch_at = NOW(),
      dispatch_lease_expires_at = NULL,
      last_dispatch_error = NULL
  WHERE operation.id = p_operation_id;

  INSERT INTO public.admin_audit_log (
    actor_user_id, action, entity_type, entity_id, reason, before_state, after_state, metadata
  ) VALUES (
    p_actor_user_id,
    'PAYMENT_DISPATCH_REQUEUED',
    'PAYMENT_OPERATION',
    p_operation_id,
    v_reason,
    jsonb_build_object('dispatch_attempts', v_attempts, 'status', v_status),
    jsonb_build_object('dispatch_attempts', 0, 'status', v_status),
    jsonb_build_object('max_attempts', payment_dispatch_max_attempts())
  );

  RETURN QUERY
  SELECT operation.id, operation.dispatch_attempts, operation.next_dispatch_at
  FROM public.payment_operations AS operation
  WHERE operation.id = p_operation_id;
END;
$$;

-- Rebuilt from 042's list plus the new action. Every existing value must survive:
-- dropping one would reject inserts the rest of the system still makes.
ALTER TABLE public.admin_audit_log DROP CONSTRAINT IF EXISTS admin_audit_log_action_check;
ALTER TABLE public.admin_audit_log ADD CONSTRAINT admin_audit_log_action_check CHECK (
  action IN (
    'JOB_STATUS_OVERRIDE',
    'JOB_REASSIGNED',
    'JOB_CANCELLED',
    'JOB_REFUNDED',
    'USER_SUSPENDED',
    'WORKER_VERIFICATION_UPDATED',
    'PAYMENT_DISPATCH_REQUEUED'
  )
);

REVOKE EXECUTE ON FUNCTION list_exhausted_payment_operations(INTEGER) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION reset_payment_operation_dispatch(UUID, UUID, TEXT) FROM PUBLIC;
