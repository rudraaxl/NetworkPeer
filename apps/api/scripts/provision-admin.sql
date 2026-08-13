\set ON_ERROR_STOP on

-- Run manually as the migration owner, never through the public API:
--   psql "$DATABASE_URL" -f scripts/provision-admin.sql
-- An ADMIN account can authenticate by OTP only after it is provisioned here.
\prompt 'Admin E.164 phone number: ' admin_phone
\prompt 'Admin full name: ' admin_name

WITH provisioned AS (
  INSERT INTO users (phone_number, full_name, role, is_active, is_verified)
  VALUES (:'admin_phone', :'admin_name', 'ADMIN', TRUE, TRUE)
  ON CONFLICT (phone_number) DO UPDATE
    SET full_name = EXCLUDED.full_name,
        is_active = TRUE,
        is_verified = TRUE,
        updated_at = NOW()
    WHERE users.role = 'ADMIN'
  RETURNING id, phone_number
)
SELECT id, phone_number FROM provisioned;

\echo 'If no row was returned, the phone belongs to a non-admin account and was intentionally not elevated.'
