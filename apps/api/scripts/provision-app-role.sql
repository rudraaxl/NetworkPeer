\set ON_ERROR_STOP on

-- Run manually as the migration owner after migrations complete:
--   psql "$DATABASE_URL" -f scripts/provision-app-role.sql
-- Set the password interactively when prompted. Do not place it in this file.

DO $$
DECLARE
  v_role TEXT;
BEGIN
  FOREACH v_role IN ARRAY ARRAY[
    'networkpeer_app',
    'networkpeer_admin_api',
    'networkpeer_media_verifier',
    'networkpeer_financial_api'
  ] LOOP
    IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = v_role) THEN
      EXECUTE format('CREATE ROLE %I LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT', v_role);
    END IF;
  END LOOP;
END;
$$;

ALTER ROLE networkpeer_app LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT NOBYPASSRLS NOREPLICATION;
ALTER ROLE networkpeer_admin_api LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT NOBYPASSRLS NOREPLICATION;
ALTER ROLE networkpeer_media_verifier LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT NOBYPASSRLS NOREPLICATION;
ALTER ROLE networkpeer_financial_api LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT NOBYPASSRLS NOREPLICATION;

-- Docker and managed platforms inject these from their secret store. `\getenv`
-- keeps them out of psql command arguments and shell history. Interactive
-- prompts remain available for manual provisioning.
\getenv NETWORKPEER_APP_DB_PASSWORD NETWORKPEER_APP_DB_PASSWORD
\getenv NETWORKPEER_ADMIN_DB_PASSWORD NETWORKPEER_ADMIN_DB_PASSWORD
\getenv NETWORKPEER_MEDIA_DB_PASSWORD NETWORKPEER_MEDIA_DB_PASSWORD
\getenv NETWORKPEER_FINANCIAL_DB_PASSWORD NETWORKPEER_FINANCIAL_DB_PASSWORD
\if :{?NETWORKPEER_APP_DB_PASSWORD}
ALTER ROLE networkpeer_app PASSWORD :'NETWORKPEER_APP_DB_PASSWORD';
ALTER ROLE networkpeer_admin_api PASSWORD :'NETWORKPEER_ADMIN_DB_PASSWORD';
ALTER ROLE networkpeer_media_verifier PASSWORD :'NETWORKPEER_MEDIA_DB_PASSWORD';
ALTER ROLE networkpeer_financial_api PASSWORD :'NETWORKPEER_FINANCIAL_DB_PASSWORD';
\else
  -- Supply -v NETWORKPEER_SKIP_PASSWORD_PROMPTS=1 only for non-production
  -- validation after setting passwords through the platform secret manager.
  \if :{?NETWORKPEER_SKIP_PASSWORD_PROMPTS}
  \else
  \password networkpeer_app
  \password networkpeer_admin_api
  \password networkpeer_media_verifier
  \password networkpeer_financial_api
  \endif
\endif

SELECT format('REVOKE ALL ON DATABASE %I FROM PUBLIC', current_database()) \gexec
REVOKE ALL ON SCHEMA public FROM PUBLIC;
REVOKE ALL ON ALL TABLES IN SCHEMA public FROM PUBLIC;
REVOKE ALL ON ALL SEQUENCES IN SCHEMA public FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION accept_job(UUID, UUID) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION set_worker_verification(UUID, VARCHAR, BOOLEAN) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION confirm_job_subtask_media_upload(UUID, UUID, BIGINT, VARCHAR, VARCHAR, TEXT, TEXT) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION submit_job_with_evidence(UUID, UUID) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION enforce_job_submission_evidence() FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION advance_worker_job_status(UUID, UUID, job_status) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION emit_user_sync_event(UUID, VARCHAR, VARCHAR, UUID, JSONB, VARCHAR, TEXT, BOOLEAN) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION emit_job_sync_events() FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION emit_media_sync_events() FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION emit_user_sync_delta(UUID, VARCHAR, VARCHAR, UUID, JSONB) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION emit_wallet_sync_event() FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION emit_notification_read_sync_event() FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION update_worker_location(UUID, DOUBLE PRECISION, DOUBLE PRECISION) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION cancel_client_job(UUID, UUID, TEXT) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION resolve_client_job(UUID, UUID, VARCHAR) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION assert_active_admin(UUID) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION job_override_is_authorized(UUID, job_status, job_status, UUID, UUID) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION admin_override_job(UUID, UUID, VARCHAR, job_status, UUID, TEXT, TEXT) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION admin_set_worker_verification(UUID, UUID, VARCHAR, BOOLEAN, TEXT) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION admin_suspend_user(UUID, UUID, TEXT) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION register_otp_user(VARCHAR, user_role, VARCHAR) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION create_client_job(UUID, VARCHAR, TEXT, VARCHAR, INTEGER, INTEGER, CHAR(3), DOUBLE PRECISION, DOUBLE PRECISION, TEXT, TIMESTAMPTZ, JSONB, VARCHAR, TEXT, JSONB, VARCHAR, CHAR(64)) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION begin_escrow_funding(UUID, UUID, VARCHAR, VARCHAR, CHAR(64)) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION mark_payment_operation_dispatched(UUID, VARCHAR, TEXT) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION approve_client_job_with_settlement(UUID, UUID, VARCHAR, VARCHAR, CHAR(64)) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION settle_payment_webhook(VARCHAR, VARCHAR, VARCHAR, VARCHAR, payment_operation_status, JSONB) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION reconcile_payout_reversal_webhook(VARCHAR, VARCHAR, VARCHAR, BIGINT, JSONB) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION claim_payment_operations_for_dispatch(INTEGER) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION claim_payment_operation_for_dispatch(UUID) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION release_payment_operation_dispatch(UUID, TEXT) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION get_wallet_summary(UUID) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION get_payment_operation_state(UUID) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION enforce_ledger_account_immutability() FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION enqueue_uploaded_media_processing() FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION list_media_processing_candidates(INTEGER) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION claim_media_processing(UUID) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION complete_media_processing(UUID) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION release_media_processing(UUID, TEXT) FROM PUBLIC;

SELECT format('GRANT CONNECT ON DATABASE %I TO networkpeer_app', current_database()) \gexec
GRANT USAGE ON SCHEMA public TO networkpeer_app;
REVOKE ALL ON ALL TABLES IN SCHEMA public FROM networkpeer_app;
REVOKE ALL ON ALL SEQUENCES IN SCHEMA public FROM networkpeer_app;
REVOKE EXECUTE ON FUNCTION set_worker_verification(UUID, VARCHAR, BOOLEAN) FROM networkpeer_app;
REVOKE EXECUTE ON FUNCTION confirm_job_subtask_media_upload(UUID, UUID, BIGINT, VARCHAR, VARCHAR, TEXT, TEXT) FROM networkpeer_app;
REVOKE EXECUTE ON FUNCTION admin_override_job(UUID, UUID, VARCHAR, job_status, UUID, TEXT, TEXT) FROM networkpeer_app;
REVOKE EXECUTE ON FUNCTION admin_set_worker_verification(UUID, UUID, VARCHAR, BOOLEAN, TEXT) FROM networkpeer_app;
REVOKE EXECUTE ON FUNCTION admin_suspend_user(UUID, UUID, TEXT) FROM networkpeer_app;

GRANT SELECT, UPDATE (is_verified, last_login_at, updated_at) ON users TO networkpeer_app;
GRANT SELECT ON worker_profiles TO networkpeer_app;
GRANT SELECT ON jobs TO networkpeer_app;
GRANT SELECT ON job_subtasks TO networkpeer_app;
GRANT SELECT ON wallet_ledger TO networkpeer_app;
GRANT SELECT, INSERT, UPDATE (upload_expires_at) ON job_subtask_media TO networkpeer_app;
GRANT SELECT, UPDATE (read_at) ON notifications TO networkpeer_app;
GRANT SELECT, UPDATE (push_state, push_attempts, push_claimed_at, push_sent_at, push_last_error) ON sync_events TO networkpeer_app;
GRANT SELECT, INSERT, UPDATE (user_id, platform, is_active, last_seen_at, updated_at) ON device_push_tokens TO networkpeer_app;
GRANT SELECT ON admin_audit_log TO networkpeer_app;
GRANT EXECUTE ON FUNCTION accept_job(UUID, UUID) TO networkpeer_app;
GRANT EXECUTE ON FUNCTION submit_job_with_evidence(UUID, UUID) TO networkpeer_app;
GRANT EXECUTE ON FUNCTION advance_worker_job_status(UUID, UUID, job_status) TO networkpeer_app;
GRANT EXECUTE ON FUNCTION update_worker_location(UUID, DOUBLE PRECISION, DOUBLE PRECISION) TO networkpeer_app;
GRANT EXECUTE ON FUNCTION cancel_client_job(UUID, UUID, TEXT) TO networkpeer_app;
GRANT EXECUTE ON FUNCTION resolve_client_job(UUID, UUID, VARCHAR) TO networkpeer_app;
GRANT EXECUTE ON FUNCTION register_otp_user(VARCHAR, user_role, VARCHAR) TO networkpeer_app;
GRANT EXECUTE ON FUNCTION create_client_job(UUID, VARCHAR, TEXT, VARCHAR, INTEGER, INTEGER, CHAR(3), DOUBLE PRECISION, DOUBLE PRECISION, TEXT, TIMESTAMPTZ, JSONB, VARCHAR, TEXT, JSONB, VARCHAR, CHAR(64)) TO networkpeer_app;
GRANT EXECUTE ON FUNCTION list_media_processing_candidates(INTEGER) TO networkpeer_app;
GRANT EXECUTE ON FUNCTION claim_media_processing(UUID) TO networkpeer_app;
GRANT EXECUTE ON FUNCTION complete_media_processing(UUID) TO networkpeer_app;
GRANT EXECUTE ON FUNCTION release_media_processing(UUID, TEXT) TO networkpeer_app;

REVOKE ALL ON ALL TABLES IN SCHEMA public FROM networkpeer_admin_api;
REVOKE ALL ON ALL SEQUENCES IN SCHEMA public FROM networkpeer_admin_api;
SELECT format('GRANT CONNECT ON DATABASE %I TO networkpeer_admin_api', current_database()) \gexec
GRANT USAGE ON SCHEMA public TO networkpeer_admin_api;
GRANT SELECT ON users, worker_profiles, jobs, wallet_ledger, admin_audit_log TO networkpeer_admin_api;
GRANT EXECUTE ON FUNCTION admin_override_job(UUID, UUID, VARCHAR, job_status, UUID, TEXT, TEXT) TO networkpeer_admin_api;
GRANT EXECUTE ON FUNCTION admin_set_worker_verification(UUID, UUID, VARCHAR, BOOLEAN, TEXT) TO networkpeer_admin_api;
GRANT EXECUTE ON FUNCTION admin_suspend_user(UUID, UUID, TEXT) TO networkpeer_admin_api;

REVOKE ALL ON ALL TABLES IN SCHEMA public FROM networkpeer_media_verifier;
REVOKE ALL ON ALL SEQUENCES IN SCHEMA public FROM networkpeer_media_verifier;
SELECT format('GRANT CONNECT ON DATABASE %I TO networkpeer_media_verifier', current_database()) \gexec
GRANT USAGE ON SCHEMA public TO networkpeer_media_verifier;
GRANT EXECUTE ON FUNCTION confirm_job_subtask_media_upload(UUID, UUID, BIGINT, VARCHAR, VARCHAR, TEXT, TEXT) TO networkpeer_media_verifier;

REVOKE ALL ON ALL TABLES IN SCHEMA public FROM networkpeer_financial_api;
REVOKE ALL ON ALL SEQUENCES IN SCHEMA public FROM networkpeer_financial_api;
SELECT format('GRANT CONNECT ON DATABASE %I TO networkpeer_financial_api', current_database()) \gexec
GRANT USAGE ON SCHEMA public TO networkpeer_financial_api;
GRANT EXECUTE ON FUNCTION begin_escrow_funding(UUID, UUID, VARCHAR, VARCHAR, CHAR(64)) TO networkpeer_financial_api;
GRANT EXECUTE ON FUNCTION mark_payment_operation_dispatched(UUID, VARCHAR, TEXT) TO networkpeer_financial_api;
GRANT EXECUTE ON FUNCTION claim_payment_operations_for_dispatch(INTEGER) TO networkpeer_financial_api;
GRANT EXECUTE ON FUNCTION claim_payment_operation_for_dispatch(UUID) TO networkpeer_financial_api;
GRANT EXECUTE ON FUNCTION release_payment_operation_dispatch(UUID, TEXT) TO networkpeer_financial_api;
GRANT EXECUTE ON FUNCTION reconcile_payout_reversal_webhook(VARCHAR, VARCHAR, VARCHAR, BIGINT, JSONB) TO networkpeer_financial_api;
GRANT EXECUTE ON FUNCTION approve_client_job_with_settlement(UUID, UUID, VARCHAR, VARCHAR, CHAR(64)) TO networkpeer_financial_api;
GRANT EXECUTE ON FUNCTION settle_payment_webhook(VARCHAR, VARCHAR, VARCHAR, VARCHAR, payment_operation_status, JSONB) TO networkpeer_financial_api;
GRANT EXECUTE ON FUNCTION get_wallet_summary(UUID) TO networkpeer_financial_api;
GRANT EXECUTE ON FUNCTION get_payment_operation_state(UUID) TO networkpeer_financial_api;

-- Apply the same baseline to future tables created by the migration owner.
ALTER DEFAULT PRIVILEGES IN SCHEMA public REVOKE ALL ON TABLES FROM PUBLIC;
ALTER DEFAULT PRIVILEGES IN SCHEMA public REVOKE ALL ON SEQUENCES FROM PUBLIC;
ALTER DEFAULT PRIVILEGES IN SCHEMA public REVOKE EXECUTE ON FUNCTIONS FROM PUBLIC;
