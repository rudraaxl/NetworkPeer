-- @nontransactional
-- Phase 8 hardening: preserve the payout destination, reconcile partial Stripe
-- transfer reversals as compensating double-entry postings, and provide a
-- durable PostgreSQL-backed dispatch lease for operations that were committed
-- before an external gateway call failed.

ALTER TYPE transaction_type ADD VALUE IF NOT EXISTS 'PAYOUT_REVERSAL';

-- @statement

ALTER TABLE public.payment_operations
  ADD COLUMN payout_destination_reference VARCHAR(255),
  ADD COLUMN reversed_amount_cents BIGINT NOT NULL DEFAULT 0,
  ADD COLUMN next_dispatch_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  ADD COLUMN dispatch_lease_expires_at TIMESTAMPTZ;

UPDATE public.payment_operations AS operation
SET payout_destination_reference = recipient.external_account_id
FROM public.payment_recipient_accounts AS recipient
WHERE operation.operation_type = 'PAYOUT'
  AND operation.provider = 'STRIPE'
  AND operation.worker_user_id = recipient.worker_id
  AND recipient.is_active = TRUE;

DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM public.payment_operations
    WHERE operation_type = 'PAYOUT'
      AND provider = 'STRIPE'
      AND payout_destination_reference IS NULL
  ) THEN
    RAISE EXCEPTION 'Existing Stripe payout operations require a destination snapshot before migration';
  END IF;
END;
$$;

ALTER TABLE public.payment_operations
  ADD CONSTRAINT payment_operations_reversed_amount_check
    CHECK (reversed_amount_cents >= 0 AND reversed_amount_cents <= amount_cents),
  ADD CONSTRAINT payment_operations_payout_destination_check
    CHECK (
      (operation_type = 'FUNDING' AND payout_destination_reference IS NULL)
      OR (operation_type = 'PAYOUT' AND (provider = 'STUB' OR payout_destination_reference IS NOT NULL))
    );

CREATE OR REPLACE FUNCTION set_payment_operation_payout_destination()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public, pg_temp
AS $$
DECLARE
  v_destination VARCHAR;
BEGIN
  IF NEW.operation_type <> 'PAYOUT' OR NEW.provider <> 'STRIPE' THEN
    RETURN NEW;
  END IF;

  SELECT recipient.external_account_id
  INTO v_destination
  FROM public.payment_recipient_accounts AS recipient
  WHERE recipient.worker_id = NEW.worker_user_id
    AND recipient.provider = 'STRIPE'
    AND recipient.is_active = TRUE
  FOR KEY SHARE;

  IF v_destination IS NULL THEN
    RAISE EXCEPTION 'Worker payout account is not active' USING ERRCODE = '55000';
  END IF;
  NEW.payout_destination_reference := v_destination;
  RETURN NEW;
END;
$$;

CREATE TRIGGER set_payment_operation_payout_destination_before_insert
  BEFORE INSERT ON public.payment_operations
  FOR EACH ROW EXECUTE FUNCTION set_payment_operation_payout_destination();

CREATE INDEX idx_payment_operations_dispatch_ready
  ON public.payment_operations (next_dispatch_at ASC, created_at ASC)
  WHERE status = 'CREATED';

CREATE OR REPLACE FUNCTION mark_payment_operation_dispatched(
  p_operation_id UUID,
  p_provider_reference VARCHAR,
  p_client_secret TEXT DEFAULT NULL
)
RETURNS TABLE (
  operation_id UUID,
  status payment_operation_status,
  provider_reference VARCHAR,
  client_secret TEXT
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public, pg_temp
AS $$
DECLARE
  v_existing_reference VARCHAR;
  v_status payment_operation_status;
BEGIN
  IF p_provider_reference IS NULL OR length(btrim(p_provider_reference)) = 0 THEN
    RAISE EXCEPTION 'Gateway reference is required' USING ERRCODE = '22023';
  END IF;
  SELECT provider_reference, status INTO v_existing_reference, v_status
  FROM public.payment_operations WHERE id = p_operation_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Payment operation not found' USING ERRCODE = 'P0002'; END IF;
  IF v_status IN ('SUCCEEDED', 'FAILED', 'CANCELLED') THEN
    RETURN QUERY SELECT id, status, provider_reference, client_secret FROM public.payment_operations WHERE id = p_operation_id;
    RETURN;
  END IF;
  IF v_existing_reference IS NOT NULL AND v_existing_reference <> p_provider_reference THEN
    RAISE EXCEPTION 'Payment operation already has a different provider reference' USING ERRCODE = '23505';
  END IF;
  UPDATE public.payment_operations
  SET provider_reference = p_provider_reference,
      client_secret = COALESCE(p_client_secret, client_secret),
      status = 'PENDING',
      dispatch_lease_expires_at = NULL,
      next_dispatch_at = NOW(),
      last_dispatch_error = NULL
  WHERE id = p_operation_id;
  RETURN QUERY SELECT id, status, provider_reference, client_secret FROM public.payment_operations WHERE id = p_operation_id;
END;
$$;

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

CREATE OR REPLACE FUNCTION release_payment_operation_dispatch(
  p_operation_id UUID,
  p_error TEXT
)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public, pg_temp
AS $$
BEGIN
  UPDATE public.payment_operations
  SET dispatch_lease_expires_at = NULL,
      next_dispatch_at = NOW() + make_interval(secs => LEAST(300, 2 ^ LEAST(dispatch_attempts, 8))::INTEGER),
      last_dispatch_error = LEFT(NULLIF(btrim(p_error), ''), 2000)
  WHERE id = p_operation_id
    AND status = 'CREATED';
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Dispatchable payment operation not found' USING ERRCODE = 'P0002';
  END IF;
END;
$$;

CREATE OR REPLACE FUNCTION reconcile_payout_reversal_webhook(
  p_provider VARCHAR,
  p_provider_event_id VARCHAR,
  p_provider_reference VARCHAR,
  p_cumulative_reversed_amount_cents BIGINT,
  p_payload JSONB
)
RETURNS TABLE (
  operation_id UUID,
  operation_type payment_operation_type,
  status payment_operation_status,
  duplicate BOOLEAN,
  reversed_amount_cents BIGINT
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public, pg_temp
AS $$
#variable_conflict use_column
DECLARE
  v_event_id UUID;
  v_operation_id UUID;
  v_operation_type payment_operation_type;
  v_status payment_operation_status;
  v_ledger_transaction_id UUID;
  v_job_id UUID;
  v_worker_id UUID;
  v_amount_cents BIGINT;
  v_reversed_amount_cents BIGINT;
  v_delta_cents BIGINT;
  v_currency CHAR(3);
  v_reversal_transaction_id UUID;
BEGIN
  IF p_provider <> 'STRIPE'
    OR p_provider_event_id IS NULL OR length(btrim(p_provider_event_id)) = 0
    OR p_provider_reference IS NULL OR length(btrim(p_provider_reference)) = 0
    OR p_cumulative_reversed_amount_cents IS NULL OR p_cumulative_reversed_amount_cents < 0 THEN
    RAISE EXCEPTION 'Payout reversal webhook is invalid' USING ERRCODE = '22023';
  END IF;

  INSERT INTO public.payment_webhook_events (provider, provider_event_id, event_type, payload)
  VALUES (p_provider, p_provider_event_id, 'transfer.reversed', COALESCE(p_payload, '{}'::jsonb))
  ON CONFLICT (provider, provider_event_id) DO NOTHING
  RETURNING id INTO v_event_id;
  IF v_event_id IS NULL THEN
    SELECT operation.id, operation.operation_type, operation.status, operation.reversed_amount_cents
    INTO v_operation_id, v_operation_type, v_status, v_reversed_amount_cents
    FROM public.payment_webhook_events AS event
    JOIN public.payment_operations AS operation ON operation.id = event.payment_operation_id
    WHERE event.provider = p_provider AND event.provider_event_id = p_provider_event_id;
    RETURN QUERY SELECT v_operation_id, v_operation_type, v_status, TRUE, v_reversed_amount_cents;
    RETURN;
  END IF;

  SELECT operation.id, operation.operation_type, operation.status, operation.ledger_transaction_id,
    operation.job_id, operation.worker_user_id, operation.amount_cents, operation.reversed_amount_cents,
    operation.currency
  INTO v_operation_id, v_operation_type, v_status, v_ledger_transaction_id, v_job_id, v_worker_id,
    v_amount_cents, v_reversed_amount_cents, v_currency
  FROM public.payment_operations AS operation
  WHERE operation.provider = p_provider AND operation.provider_reference = p_provider_reference
  FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Payout reversal operation not found' USING ERRCODE = 'P0002';
  END IF;
  IF v_operation_type <> 'PAYOUT' OR v_status IN ('FAILED', 'CANCELLED') THEN
    RAISE EXCEPTION 'Payout reversal is not valid for this operation' USING ERRCODE = '55000';
  END IF;
  IF p_cumulative_reversed_amount_cents > v_amount_cents
    OR p_cumulative_reversed_amount_cents < v_reversed_amount_cents THEN
    RAISE EXCEPTION 'Payout reversal amount is invalid' USING ERRCODE = '22023';
  END IF;

  UPDATE public.payment_webhook_events
  SET payment_operation_id = v_operation_id, processed_at = NOW()
  WHERE id = v_event_id;

  -- A valid Stripe reversal proves that the transfer was created even if its
  -- transfer.created webhook has not reached us yet. Settle the original
  -- payout first, then post only the incremental reversal amount.
  IF v_status IN ('CREATED', 'PENDING') THEN
    UPDATE public.ledger_transactions
    SET transaction_status = 'COMPLETED', processed_at = NOW()
    WHERE id = v_ledger_transaction_id;
    UPDATE public.wallet_ledger
    SET transaction_status = 'COMPLETED', processed_at = NOW()
    WHERE ledger_transaction_id = v_ledger_transaction_id;
    UPDATE public.payment_operations
    SET status = 'SUCCEEDED', processed_at = NOW(), dispatch_lease_expires_at = NULL
    WHERE id = v_operation_id;
    v_status := 'SUCCEEDED';
  END IF;

  IF p_cumulative_reversed_amount_cents = v_reversed_amount_cents THEN
    RETURN QUERY SELECT v_operation_id, v_operation_type, v_status, FALSE, v_reversed_amount_cents;
    RETURN;
  END IF;

  v_delta_cents := p_cumulative_reversed_amount_cents - v_reversed_amount_cents;
  v_reversal_transaction_id := public.post_ledger_transaction(
    v_job_id,
    'COMPLETED',
    v_currency,
    'payout-reversal:' || md5(p_provider || ':' || p_provider_event_id),
    md5(p_provider || ':' || p_provider_event_id) || md5(p_provider_reference || ':' || p_cumulative_reversed_amount_cents::text),
    'Stripe payout reversal',
    jsonb_build_object(
      'provider', p_provider,
      'provider_event_id', p_provider_event_id,
      'provider_reference', p_provider_reference,
      'payment_operation_id', v_operation_id,
      'cumulative_reversed_amount_cents', p_cumulative_reversed_amount_cents
    ),
    jsonb_build_array(
      jsonb_build_object('account_kind', 'WORKER_PAYABLE', 'owner_user_id', v_worker_id, 'amount_cents', -v_delta_cents, 'transaction_type', 'PAYOUT_REVERSAL'),
      jsonb_build_object('account_kind', 'PLATFORM_GATEWAY_CLEARING', 'amount_cents', v_delta_cents, 'transaction_type', 'PAYOUT_REVERSAL')
    )
  );
  UPDATE public.payment_operations
  SET reversed_amount_cents = p_cumulative_reversed_amount_cents
  WHERE id = v_operation_id;
  RETURN QUERY SELECT v_operation_id, v_operation_type, v_status, FALSE, p_cumulative_reversed_amount_cents;
END;
$$;

REVOKE EXECUTE ON FUNCTION set_payment_operation_payout_destination() FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION mark_payment_operation_dispatched(UUID, VARCHAR, TEXT) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION claim_payment_operations_for_dispatch(INTEGER) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION release_payment_operation_dispatch(UUID, TEXT) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION reconcile_payout_reversal_webhook(VARCHAR, VARCHAR, VARCHAR, BIGINT, JSONB) FROM PUBLIC;
