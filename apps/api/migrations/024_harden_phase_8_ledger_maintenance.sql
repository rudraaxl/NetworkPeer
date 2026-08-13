-- Ledger rows are immutable to all application roles. Migration-owner test and
-- data-repair transactions may opt into a transaction-local maintenance flag;
-- the role grants still deny ordinary application credentials all DML.

CREATE OR REPLACE FUNCTION enforce_wallet_ledger_immutability()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public, pg_temp
AS $$
BEGIN
  IF current_setting('networkpeer.maintenance_mode', TRUE) = 'on' THEN
    RETURN CASE WHEN TG_OP = 'DELETE' THEN OLD ELSE NEW END;
  END IF;
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'Ledger postings are immutable; use a compensating transaction' USING ERRCODE = '55000';
  END IF;
  IF NEW.id IS DISTINCT FROM OLD.id
    OR NEW.user_id IS DISTINCT FROM OLD.user_id
    OR NEW.job_id IS DISTINCT FROM OLD.job_id
    OR NEW.transaction_type IS DISTINCT FROM OLD.transaction_type
    OR NEW.amount_cents IS DISTINCT FROM OLD.amount_cents
    OR NEW.balance_after_cents IS DISTINCT FROM OLD.balance_after_cents
    OR NEW.currency IS DISTINCT FROM OLD.currency
    OR NEW.reference_id IS DISTINCT FROM OLD.reference_id
    OR NEW.reference_type IS DISTINCT FROM OLD.reference_type
    OR NEW.description IS DISTINCT FROM OLD.description
    OR NEW.metadata IS DISTINCT FROM OLD.metadata
    OR NEW.idempotency_key IS DISTINCT FROM OLD.idempotency_key
    OR NEW.ledger_transaction_id IS DISTINCT FROM OLD.ledger_transaction_id
    OR NEW.ledger_account_id IS DISTINCT FROM OLD.ledger_account_id THEN
    RAISE EXCEPTION 'Ledger posting fields are immutable' USING ERRCODE = '55000';
  END IF;
  IF OLD.transaction_status <> 'PENDING'
    OR NEW.transaction_status NOT IN ('COMPLETED', 'FAILED')
    OR NEW.processed_at IS NULL THEN
    RAISE EXCEPTION 'Ledger posting status may only settle a pending posting once' USING ERRCODE = '55000';
  END IF;
  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION enforce_ledger_transaction_immutability()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public, pg_temp
AS $$
BEGIN
  IF current_setting('networkpeer.maintenance_mode', TRUE) = 'on' THEN
    RETURN CASE WHEN TG_OP = 'DELETE' THEN OLD ELSE NEW END;
  END IF;
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'Ledger transactions are immutable' USING ERRCODE = '55000';
  END IF;
  IF NEW.id IS DISTINCT FROM OLD.id
    OR NEW.job_id IS DISTINCT FROM OLD.job_id
    OR NEW.currency IS DISTINCT FROM OLD.currency
    OR NEW.idempotency_key IS DISTINCT FROM OLD.idempotency_key
    OR NEW.idempotency_fingerprint IS DISTINCT FROM OLD.idempotency_fingerprint
    OR NEW.description IS DISTINCT FROM OLD.description
    OR NEW.metadata IS DISTINCT FROM OLD.metadata THEN
    RAISE EXCEPTION 'Ledger transaction fields are immutable' USING ERRCODE = '55000';
  END IF;
  IF OLD.transaction_status <> 'PENDING'
    OR NEW.transaction_status NOT IN ('COMPLETED', 'FAILED')
    OR NEW.processed_at IS NULL THEN
    RAISE EXCEPTION 'Ledger transaction status may only settle once' USING ERRCODE = '55000';
  END IF;
  RETURN NEW;
END;
$$;
