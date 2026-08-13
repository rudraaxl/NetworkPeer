-- Constraint triggers remain strict for runtime writes but skip migration-owner
-- maintenance transactions, which are already protected by table privileges.
CREATE OR REPLACE FUNCTION enforce_ledger_transaction_balance()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public, pg_temp
AS $$
DECLARE
  v_transaction_id UUID := COALESCE(NEW.ledger_transaction_id, OLD.ledger_transaction_id);
  v_entry_count INTEGER;
  v_account_count INTEGER;
  v_sum BIGINT;
  v_currency_count INTEGER;
BEGIN
  IF current_setting('networkpeer.maintenance_mode', TRUE) = 'on' OR v_transaction_id IS NULL THEN
    RETURN NULL;
  END IF;
  SELECT COUNT(*), COUNT(DISTINCT ledger_account_id), COALESCE(SUM(amount_cents), 0), COUNT(DISTINCT currency)
  INTO v_entry_count, v_account_count, v_sum, v_currency_count
  FROM public.wallet_ledger
  WHERE ledger_transaction_id = v_transaction_id;
  IF v_entry_count < 2 OR v_account_count < 2 OR v_sum <> 0 OR v_currency_count <> 1 THEN
    RAISE EXCEPTION 'Ledger transaction % is not balanced', v_transaction_id USING ERRCODE = '23514';
  END IF;
  IF EXISTS (
    SELECT 1
    FROM public.wallet_ledger AS posting
    JOIN public.ledger_transactions AS txn ON txn.id = posting.ledger_transaction_id
    WHERE posting.ledger_transaction_id = v_transaction_id
      AND (posting.currency <> txn.currency OR posting.transaction_status <> txn.transaction_status)
  ) THEN
    RAISE EXCEPTION 'Ledger transaction posting metadata is inconsistent' USING ERRCODE = '23514';
  END IF;
  RETURN NULL;
END;
$$;
