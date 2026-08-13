CREATE OR REPLACE FUNCTION settle_payment_webhook(
  p_provider VARCHAR,
  p_provider_event_id VARCHAR,
  p_provider_reference VARCHAR,
  p_event_type VARCHAR,
  p_outcome payment_operation_status,
  p_payload JSONB
)
RETURNS TABLE (
  operation_id UUID,
  operation_type payment_operation_type,
  status payment_operation_status,
  duplicate BOOLEAN
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
  v_ledger_status transaction_status;
BEGIN
  IF p_provider NOT IN ('STUB', 'STRIPE')
    OR p_provider_event_id IS NULL OR length(btrim(p_provider_event_id)) = 0
    OR p_provider_reference IS NULL OR length(btrim(p_provider_reference)) = 0
    OR p_outcome NOT IN ('SUCCEEDED', 'FAILED') THEN
    RAISE EXCEPTION 'Payment webhook is invalid' USING ERRCODE = '22023';
  END IF;
  v_ledger_status := CASE WHEN p_outcome = 'SUCCEEDED' THEN 'COMPLETED'::transaction_status ELSE 'FAILED'::transaction_status END;

  INSERT INTO public.payment_webhook_events (provider, provider_event_id, event_type, payload)
  VALUES (p_provider, p_provider_event_id, p_event_type, COALESCE(p_payload, '{}'::jsonb))
  ON CONFLICT (provider, provider_event_id) DO NOTHING
  RETURNING id INTO v_event_id;
  IF v_event_id IS NULL THEN
    SELECT po.id, po.operation_type, po.status
    INTO v_operation_id, v_operation_type, v_status
    FROM public.payment_webhook_events AS event
    JOIN public.payment_operations AS po ON po.id = event.payment_operation_id
    WHERE event.provider = p_provider AND event.provider_event_id = p_provider_event_id;
    RETURN QUERY SELECT v_operation_id, v_operation_type, v_status, TRUE;
    RETURN;
  END IF;

  SELECT po.id, po.operation_type, po.status, po.ledger_transaction_id, po.job_id
  INTO v_operation_id, v_operation_type, v_status, v_ledger_transaction_id, v_job_id
  FROM public.payment_operations AS po
  WHERE po.provider = p_provider AND po.provider_reference = p_provider_reference
  FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Payment operation not found' USING ERRCODE = 'P0002'; END IF;
  UPDATE public.payment_webhook_events
  SET payment_operation_id = v_operation_id, processed_at = NOW()
  WHERE id = v_event_id;
  IF v_status IN ('SUCCEEDED', 'FAILED', 'CANCELLED') THEN
    RETURN QUERY SELECT v_operation_id, v_operation_type, v_status, FALSE;
    RETURN;
  END IF;

  UPDATE public.ledger_transactions
  SET transaction_status = v_ledger_status, processed_at = NOW()
  WHERE id = v_ledger_transaction_id;
  UPDATE public.wallet_ledger
  SET transaction_status = v_ledger_status, processed_at = NOW()
  WHERE ledger_transaction_id = v_ledger_transaction_id;
  UPDATE public.payment_operations
  SET status = p_outcome, processed_at = NOW()
  WHERE id = v_operation_id;

  IF v_operation_type = 'FUNDING' AND p_outcome = 'SUCCEEDED' THEN
    UPDATE public.jobs
    SET status = 'POSTED', escrow_status = 'HELD', funded_at = NOW(),
        escrow_ledger_transaction_id = v_ledger_transaction_id, updated_at = NOW()
    WHERE id = v_job_id AND status = 'FUNDING';
  ELSIF v_operation_type = 'FUNDING' AND p_outcome = 'FAILED' THEN
    UPDATE public.jobs
    SET escrow_status = 'UNFUNDED', updated_at = NOW()
    WHERE id = v_job_id AND status = 'FUNDING';
  END IF;
  RETURN QUERY SELECT v_operation_id, v_operation_type, p_outcome, FALSE;
END;
$$;
