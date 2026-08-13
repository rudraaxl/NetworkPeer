-- OUT parameter names are PL/pgSQL variables. Prefer real table columns in the
-- Phase 8 command functions so output names cannot shadow selected columns.
ALTER FUNCTION begin_escrow_funding(UUID, UUID, VARCHAR, VARCHAR, CHAR(64))
  SET plpgsql.variable_conflict = 'use_column';
ALTER FUNCTION mark_payment_operation_dispatched(UUID, VARCHAR, TEXT)
  SET plpgsql.variable_conflict = 'use_column';
ALTER FUNCTION settle_payment_webhook(VARCHAR, VARCHAR, VARCHAR, VARCHAR, payment_operation_status, JSONB)
  SET plpgsql.variable_conflict = 'use_column';
