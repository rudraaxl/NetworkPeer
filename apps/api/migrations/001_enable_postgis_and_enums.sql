-- Migration: 001_enable_postgis_and_enums.sql
-- Enable PostGIS extension and define custom enums

CREATE EXTENSION IF NOT EXISTS postgis;
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- User roles
CREATE TYPE user_role AS ENUM ('CLIENT', 'WORKER', 'ADMIN');

-- Job status lifecycle
CREATE TYPE job_status AS ENUM (
  'POSTED',
  'ASSIGNED',
  'EN_ROUTE',
  'AT_LOCATION',
  'IN_PROGRESS',
  'SUBMITTED',
  'APPROVED',
  'COMPLETED',
  'CANCELLED',
  'DISPUTED'
);

-- Media status for subtask evidence
CREATE TYPE media_status AS ENUM ('PENDING', 'UPLOADED', 'VERIFIED', 'REJECTED');

-- Transaction types for double-entry ledger
CREATE TYPE transaction_type AS ENUM (
  'ESCROW_HOLD',
  'ESCROW_RELEASE',
  'WORKER_PAYOUT',
  'PLATFORM_FEE',
  'REFUND',
  'TOP_UP',
  'WITHDRAWAL'
);

-- Transaction status
CREATE TYPE transaction_status AS ENUM ('PENDING', 'COMPLETED', 'FAILED', 'REVERSED');

-- Subtask status
CREATE TYPE subtask_status AS ENUM ('PENDING', 'IN_PROGRESS', 'COMPLETED', 'SKIPPED');