-- Resolve output-column/record-column ambiguity in the Phase 8 dispatcher.
-- This is intentionally forward-only because migration 036 is already applied.

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
#variable_conflict use_column
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

REVOKE EXECUTE ON FUNCTION mark_payment_operation_dispatched(UUID, VARCHAR, TEXT) FROM PUBLIC;
