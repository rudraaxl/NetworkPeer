-- PostgreSQL does not permit a newly added value of an existing enum to be
-- referenced safely until the transaction commits. Keep this migration isolated
-- so the Phase 8 schema can use FUNDING in the following migration.
ALTER TYPE job_status ADD VALUE IF NOT EXISTS 'FUNDING' BEFORE 'POSTED';
