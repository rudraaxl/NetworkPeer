-- Serialize request-path and worker-path gateway dispatch. Both must acquire
-- the same PostgreSQL lease before making an external idempotent provider call.
CREATE OR REPLACE FUNCTION claim_payment_operation_for_dispatch(p_operation_id UUID)
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
  RETURN QUERY
  WITH candidate AS (
    SELECT operation.id
    FROM public.payment_operations AS operation
    WHERE operation.id = p_operation_id
      AND operation.status = 'CREATED'
      AND operation.next_dispatch_at <= NOW()
      AND (
        operation.dispatch_lease_expires_at IS NULL
        OR operation.dispatch_lease_expires_at <= NOW()
      )
    FOR UPDATE SKIP LOCKED
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

REVOKE EXECUTE ON FUNCTION claim_payment_operation_for_dispatch(UUID) FROM PUBLIC;
