CREATE OR REPLACE FUNCTION begin_escrow_funding(
  p_client_id UUID,
  p_job_id UUID,
  p_provider VARCHAR,
  p_idempotency_key VARCHAR,
  p_idempotency_fingerprint CHAR(64)
)
RETURNS TABLE (
  operation_id UUID,
  ledger_transaction_id UUID,
  amount_cents BIGINT,
  currency CHAR(3),
  status payment_operation_status,
  dispatch_required BOOLEAN,
  provider_reference VARCHAR,
  client_secret TEXT
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public, pg_temp
AS $$
#variable_conflict use_column
DECLARE
  v_job_client_id UUID;
  v_job_status job_status;
  v_escrow_status escrow_status;
  v_budget_cents BIGINT;
  v_currency CHAR(3);
  v_existing_fingerprint CHAR(64);
  v_operation_id UUID;
  v_transaction_id UUID;
  v_operation_status payment_operation_status;
  v_provider_reference VARCHAR;
  v_client_secret TEXT;
BEGIN
  IF p_provider NOT IN ('STUB', 'STRIPE') OR p_idempotency_key IS NULL OR length(p_idempotency_key) < 8
    OR length(p_idempotency_key) > 180 OR p_idempotency_fingerprint !~ '^[0-9a-f]{64}$' THEN
    RAISE EXCEPTION 'Invalid escrow funding request' USING ERRCODE = '22023';
  END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended(p_client_id::text || ':' || p_idempotency_key, 127));
  SELECT po.idempotency_fingerprint, po.id, po.ledger_transaction_id, po.status, po.amount_cents,
         po.currency, po.provider_reference, po.client_secret
  INTO v_existing_fingerprint, v_operation_id, v_transaction_id, v_operation_status, v_budget_cents,
       v_currency, v_provider_reference, v_client_secret
  FROM public.payment_operations AS po
  WHERE po.idempotency_key = p_idempotency_key
  FOR UPDATE;
  IF FOUND THEN
    IF v_existing_fingerprint <> p_idempotency_fingerprint THEN
      RAISE EXCEPTION 'Payment idempotency key was reused with different input' USING ERRCODE = '23505';
    END IF;
    RETURN QUERY SELECT v_operation_id, v_transaction_id, v_budget_cents, v_currency, v_operation_status,
      v_operation_status = 'CREATED', v_provider_reference, v_client_secret;
    RETURN;
  END IF;

  SELECT j.client_id, j.status, j.escrow_status, j.budget_cents, j.currency
  INTO v_job_client_id, v_job_status, v_escrow_status, v_budget_cents, v_currency
  FROM public.jobs AS j WHERE j.id = p_job_id FOR UPDATE;
  IF NOT FOUND OR v_job_client_id IS DISTINCT FROM p_client_id THEN
    RAISE EXCEPTION 'Job not found' USING ERRCODE = 'P0002';
  END IF;
  PERFORM 1 FROM public.users WHERE id = p_client_id AND role = 'CLIENT' AND is_active = TRUE FOR KEY SHARE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Client is not active' USING ERRCODE = '42501'; END IF;
  IF v_job_status <> 'FUNDING' OR v_escrow_status <> 'UNFUNDED' THEN
    RAISE EXCEPTION 'Job is not awaiting escrow funding' USING ERRCODE = '55000';
  END IF;
  IF EXISTS (
    SELECT 1
    FROM public.payment_operations AS po
    WHERE po.job_id = p_job_id
      AND po.operation_type = 'FUNDING'
      AND po.status IN ('CREATED', 'PENDING')
  ) THEN
    RAISE EXCEPTION 'A funding operation is already pending for this job' USING ERRCODE = '55000';
  END IF;

  v_transaction_id := public.post_ledger_transaction(
    p_job_id, 'PENDING', v_currency, p_idempotency_key || ':hold', p_idempotency_fingerprint,
    'Escrow funding authorization', jsonb_build_object('provider', p_provider),
    jsonb_build_array(
      jsonb_build_object('account_kind', 'PLATFORM_GATEWAY_CLEARING', 'amount_cents', v_budget_cents, 'transaction_type', 'ESCROW_HOLD'),
      jsonb_build_object('account_kind', 'CLIENT_ESCROW', 'owner_user_id', p_client_id, 'amount_cents', -v_budget_cents, 'transaction_type', 'ESCROW_HOLD')
    )
  );
  INSERT INTO public.payment_operations (
    job_id, ledger_transaction_id, operation_type, provider, client_user_id,
    amount_cents, currency, idempotency_key, idempotency_fingerprint
  ) VALUES (
    p_job_id, v_transaction_id, 'FUNDING', p_provider, p_client_id,
    v_budget_cents, v_currency, p_idempotency_key, p_idempotency_fingerprint
  ) RETURNING id, status INTO v_operation_id, v_operation_status;
  UPDATE public.jobs SET escrow_status = 'PENDING', updated_at = NOW() WHERE id = p_job_id;
  RETURN QUERY SELECT v_operation_id, v_transaction_id, v_budget_cents, v_currency, v_operation_status, TRUE, NULL::varchar, NULL::text;
END;
$$;
