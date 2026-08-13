-- Migration: 002_create_core_tables.sql
-- Core tables for users, worker profiles, jobs, subtasks, media, and wallet ledger

-- Users table
CREATE TABLE users (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  phone_number VARCHAR(20) NOT NULL UNIQUE,
  email VARCHAR(255) UNIQUE,
  full_name VARCHAR(255) NOT NULL,
  role user_role NOT NULL DEFAULT 'CLIENT',
  avatar_url TEXT,
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  is_verified BOOLEAN NOT NULL DEFAULT FALSE,
  last_login_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_users_phone ON users(phone_number);
CREATE INDEX idx_users_email ON users(email);
CREATE INDEX idx_users_role ON users(role);

-- Worker profiles (extended info for workers)
CREATE TABLE worker_profiles (
  user_id UUID PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  skills TEXT[] DEFAULT '{}',
  hourly_rate_cents INTEGER CHECK (hourly_rate_cents IS NULL OR hourly_rate_cents >= 0),
  rating DECIMAL(3,2) NOT NULL DEFAULT 0.00 CHECK (rating >= 0 AND rating <= 5),
  total_jobs_completed INTEGER NOT NULL DEFAULT 0 CHECK (total_jobs_completed >= 0),
  verification_status VARCHAR(50) NOT NULL DEFAULT 'PENDING',
  verification_documents JSONB DEFAULT '{}',
  preferred_radius_km INTEGER NOT NULL DEFAULT 50 CHECK (preferred_radius_km > 0),
  is_available BOOLEAN NOT NULL DEFAULT TRUE,
  current_location GEOMETRY(Point, 4326),
  last_location_update TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_worker_profiles_location ON worker_profiles USING GIST (current_location);
CREATE INDEX idx_worker_profiles_available ON worker_profiles(is_available) WHERE is_available = TRUE;

-- Jobs table with PostGIS spatial column
CREATE TABLE jobs (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  client_id UUID NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  worker_id UUID REFERENCES users(id) ON DELETE SET NULL,
  title VARCHAR(255) NOT NULL,
  description TEXT NOT NULL,
  category VARCHAR(100) NOT NULL,
  status job_status NOT NULL DEFAULT 'POSTED',
  priority INTEGER NOT NULL DEFAULT 0 CHECK (priority >= 0),
  budget_cents INTEGER NOT NULL CHECK (budget_cents > 0),
  platform_fee_cents INTEGER NOT NULL DEFAULT 0 CHECK (platform_fee_cents >= 0),
  currency CHAR(3) NOT NULL DEFAULT 'USD' CHECK (currency ~ '^[A-Z]{3}$'),
  location GEOMETRY(Point, 4326) NOT NULL,
  address TEXT,
  scheduled_at TIMESTAMPTZ,
  started_at TIMESTAMPTZ,
  completed_at TIMESTAMPTZ,
  cancelled_at TIMESTAMPTZ,
  cancellation_reason TEXT,
  metadata JSONB DEFAULT '{}',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CHECK (platform_fee_cents <= budget_cents),
  CHECK (worker_id IS NULL OR worker_id <> client_id)
);

CREATE INDEX idx_jobs_client ON jobs(client_id);
CREATE INDEX idx_jobs_worker ON jobs(worker_id);
CREATE INDEX idx_jobs_status ON jobs(status);
CREATE INDEX idx_jobs_location ON jobs USING GIST (location);
CREATE INDEX idx_jobs_scheduled ON jobs(scheduled_at);
CREATE INDEX idx_jobs_category ON jobs(category);
CREATE INDEX idx_jobs_status_created ON jobs(status, created_at DESC);

-- Job subtasks (checklist items)
CREATE TABLE job_subtasks (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  job_id UUID NOT NULL REFERENCES jobs(id) ON DELETE CASCADE,
  title VARCHAR(255) NOT NULL,
  description TEXT,
  sequence_order INTEGER NOT NULL DEFAULT 0,
  is_required BOOLEAN NOT NULL DEFAULT TRUE,
  status subtask_status NOT NULL DEFAULT 'PENDING',
  completed_at TIMESTAMPTZ,
  metadata JSONB DEFAULT '{}',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_job_subtasks_job ON job_subtasks(job_id);
CREATE INDEX idx_job_subtasks_status ON job_subtasks(status);

-- Job subtask media (evidence)
CREATE TABLE job_subtask_media (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  subtask_id UUID NOT NULL REFERENCES job_subtasks(id) ON DELETE CASCADE,
  job_id UUID NOT NULL REFERENCES jobs(id) ON DELETE CASCADE,
  worker_id UUID NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  s3_key TEXT NOT NULL,
  s3_bucket TEXT NOT NULL,
  media_type VARCHAR(50) NOT NULL CHECK (media_type IN ('IMAGE', 'VIDEO', 'AUDIO', 'DOCUMENT')),
  mime_type VARCHAR(100),
  file_size_bytes BIGINT CHECK (file_size_bytes IS NULL OR file_size_bytes > 0),
  width INTEGER CHECK (width IS NULL OR width > 0),
  height INTEGER CHECK (height IS NULL OR height > 0),
  duration_seconds INTEGER CHECK (duration_seconds IS NULL OR duration_seconds > 0),
  location GEOMETRY(Point, 4326),
  captured_at TIMESTAMPTZ NOT NULL,
  uploaded_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  status media_status NOT NULL DEFAULT 'PENDING',
  verification_notes TEXT,
  metadata JSONB DEFAULT '{}',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_job_subtask_media_subtask ON job_subtask_media(subtask_id);
CREATE INDEX idx_job_subtask_media_job ON job_subtask_media(job_id);
CREATE INDEX idx_job_subtask_media_worker ON job_subtask_media(worker_id);
CREATE INDEX idx_job_subtask_media_status ON job_subtask_media(status);
CREATE INDEX idx_job_subtask_media_location ON job_subtask_media USING GIST (location);

-- Wallet ledger (double-entry bookkeeping)
CREATE TABLE wallet_ledger (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  job_id UUID REFERENCES jobs(id) ON DELETE SET NULL,
  transaction_type transaction_type NOT NULL,
  transaction_status transaction_status NOT NULL DEFAULT 'PENDING',
  amount_cents BIGINT NOT NULL, -- Positive for credit, negative for debit
  balance_after_cents BIGINT NOT NULL,
  currency CHAR(3) NOT NULL DEFAULT 'USD' CHECK (currency ~ '^[A-Z]{3}$'),
  reference_id VARCHAR(255), -- External payment reference (Stripe payment_intent_id, etc.)
  reference_type VARCHAR(50), -- 'PAYMENT_INTENT', 'TRANSFER', 'PAYOUT', etc.
  description TEXT NOT NULL,
  metadata JSONB DEFAULT '{}',
  idempotency_key VARCHAR(255) UNIQUE CHECK (idempotency_key IS NULL OR length(trim(idempotency_key)) > 0),
  processed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_wallet_ledger_user ON wallet_ledger(user_id);
CREATE INDEX idx_wallet_ledger_job ON wallet_ledger(job_id);
CREATE INDEX idx_wallet_ledger_type ON wallet_ledger(transaction_type);
CREATE INDEX idx_wallet_ledger_status ON wallet_ledger(transaction_status);
CREATE INDEX idx_wallet_ledger_idempotency ON wallet_ledger(idempotency_key) WHERE idempotency_key IS NOT NULL;
CREATE INDEX idx_wallet_ledger_created ON wallet_ledger(created_at DESC);

-- Updated_at trigger function
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ language 'plpgsql';

-- Apply updated_at triggers
CREATE TRIGGER update_users_updated_at BEFORE UPDATE ON users FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
CREATE TRIGGER update_worker_profiles_updated_at BEFORE UPDATE ON worker_profiles FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
CREATE TRIGGER update_jobs_updated_at BEFORE UPDATE ON jobs FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
CREATE TRIGGER update_job_subtasks_updated_at BEFORE UPDATE ON job_subtasks FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- Role invariant helpers. Foreign keys prove users exist; these triggers prove
-- those users have the roles required by the marketplace domain model.
CREATE OR REPLACE FUNCTION require_user_role(p_user_id UUID, p_expected_role user_role, p_field_name TEXT)
RETURNS VOID AS $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM users
    WHERE id = p_user_id
      AND role = p_expected_role
      AND is_active = TRUE
  ) THEN
    RAISE EXCEPTION '% must reference an active % user', p_field_name, p_expected_role
      USING ERRCODE = '23514';
  END IF;
END;
$$ language 'plpgsql';

CREATE OR REPLACE FUNCTION enforce_worker_profile_role()
RETURNS TRIGGER AS $$
BEGIN
  PERFORM require_user_role(NEW.user_id, 'WORKER', 'worker_profiles.user_id');
  RETURN NEW;
END;
$$ language 'plpgsql';

CREATE OR REPLACE FUNCTION enforce_job_roles()
RETURNS TRIGGER AS $$
BEGIN
  PERFORM require_user_role(NEW.client_id, 'CLIENT', 'jobs.client_id');

  IF NEW.worker_id IS NOT NULL THEN
    PERFORM require_user_role(NEW.worker_id, 'WORKER', 'jobs.worker_id');
  END IF;

  RETURN NEW;
END;
$$ language 'plpgsql';

CREATE TRIGGER enforce_worker_profile_role
  BEFORE INSERT OR UPDATE OF user_id ON worker_profiles
  FOR EACH ROW EXECUTE FUNCTION enforce_worker_profile_role();

CREATE TRIGGER enforce_job_roles
  BEFORE INSERT OR UPDATE OF client_id, worker_id ON jobs
  FOR EACH ROW EXECUTE FUNCTION enforce_job_roles();
