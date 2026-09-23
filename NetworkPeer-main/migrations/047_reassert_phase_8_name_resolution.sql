-- Migration 047: Re-assert the Phase 8 name-resolution settings.
--
-- Migrations 026 and 029 were edited after they had already been applied to the
-- staging database, so their recorded checksums no longer match their source
-- and `npm run migrate` fails closed -- correctly, because nothing can tell
-- from a hash alone whether the edit was cosmetic or changed what ran.
--
-- Both files contain only ALTER FUNCTION ... SET, which is idempotent, so
-- re-asserting every statement from both here makes the database definitively
-- match what the repository describes. The two checksum rows are then
-- baselined, which is safe precisely because this migration has just made the
-- database state true regardless of which version was originally applied.

ALTER FUNCTION begin_escrow_funding(UUID, UUID, VARCHAR, VARCHAR, CHAR(64))
  SET plpgsql.variable_conflict = 'use_column';
ALTER FUNCTION mark_payment_operation_dispatched(UUID, VARCHAR, TEXT)
  SET plpgsql.variable_conflict = 'use_column';
ALTER FUNCTION settle_payment_webhook(VARCHAR, VARCHAR, VARCHAR, VARCHAR, payment_operation_status, JSONB)
  SET plpgsql.variable_conflict = 'use_column';
ALTER FUNCTION approve_client_job_with_settlement(UUID, UUID, VARCHAR, VARCHAR, CHAR(64))
  SET plpgsql.variable_conflict = 'use_column';
