-- Phase 8: canonical double-entry journal, payment-operation inbox/outbox
-- state, escrow funding, approval settlement, and wallet projections. The
-- legacy wallet_ledger table becomes the immutable posting table; new economic
-- transactions are grouped by ledger_transactions.idempotency_key.

CREATE TYPE escrow_status AS ENUM (
  'UNFUNDED',
  'PENDING',
  'HELD',
  'RELEASED',
  'FROZEN',
  'REFUNDED'
);

CREATE TYPE ledger_account_kind AS ENUM (
  'CLIENT_ESCROW',
  'WORKER_PAYABLE',
  'PLATFORM_GATEWAY_CLEARING',
  'PLATFORM_REVENUE'
);

CREATE TYPE payment_operation_type AS ENUM ('FUNDING', 'PAYOUT');
CREATE TYPE payment_operation_status AS ENUM ('CREATED', 'PENDING', 'SUCCEEDED', 'FAILED', 'CANCELLED');

CREATE TABLE ledger_accounts (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  owner_user_id UUID REFERENCES users(id) ON DELETE RESTRICT,
  owner_scope UUID GENERATED ALWAYS AS (
    COALESCE(owner_user_id, '00000000-0000-0000-0000-000000000000'::uuid)
  ) STORED,
  account_kind ledger_account_kind NOT NULL,
  currency CHAR(3) NOT NULL CHECK (currency ~ '^[A-Z]{3}$'),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT ledger_accounts_owner_kind_check CHECK (
    (
      account_kind IN ('CLIENT_ESCROW', 'WORKER_PAYABLE')
      AND owner_user_id IS NOT NULL
    )
    OR (
      account_kind IN ('PLATFORM_GATEWAY_CLEARING', 'PLATFORM_REVENUE')
      AND owner_user_id IS NULL
    )
  ),
  CONSTRAINT ledger_accounts_owner_kind_currency_key UNIQUE (owner_scope, account_kind, currency)
);

CREATE TABLE ledger_transactions (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  job_id UUID REFERENCES jobs(id) ON DELETE RESTRICT,
  transaction_status transaction_status NOT NULL,
  currency CHAR(3) NOT NULL CHECK (currency ~ '^[A-Z]{3}$'),
  idempotency_key VARCHAR(200) NOT NULL UNIQUE CHECK (length(btrim(idempotency_key)) >= 8),
  idempotency_fingerprint CHAR(64) NOT NULL CHECK (idempotency_fingerprint ~ '^[0-9a-f]{64}$'),
  description TEXT NOT NULL CHECK (length(btrim(description)) > 0),
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  processed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE wallet_ledger
  ALTER COLUMN user_id DROP NOT NULL,
  ADD COLUMN ledger_transaction_id UUID REFERENCES ledger_transactions(id) ON DELETE RESTRICT,
  ADD COLUMN ledger_account_id UUID REFERENCES ledger_accounts(id) ON DELETE RESTRICT;

ALTER TABLE wallet_ledger DROP CONSTRAINT IF EXISTS wallet_ledger_job_id_fkey;
ALTER TABLE wallet_ledger
  ADD CONSTRAINT wallet_ledger_job_id_fkey
  FOREIGN KEY (job_id) REFERENCES jobs(id) ON DELETE RESTRICT;

CREATE INDEX idx_wallet_ledger_transaction ON wallet_ledger (ledger_transaction_id, created_at ASC)
  WHERE ledger_transaction_id IS NOT NULL;
CREATE INDEX idx_wallet_ledger_account_completed ON wallet_ledger (ledger_account_id, currency)
  WHERE transaction_status = 'COMPLETED' AND ledger_account_id IS NOT NULL;

CREATE TABLE payment_operations (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  job_id UUID NOT NULL REFERENCES jobs(id) ON DELETE RESTRICT,
  ledger_transaction_id UUID NOT NULL UNIQUE REFERENCES ledger_transactions(id) ON DELETE RESTRICT,
  operation_type payment_operation_type NOT NULL,
  status payment_operation_status NOT NULL DEFAULT 'CREATED',
  provider VARCHAR(32) NOT NULL CHECK (provider IN ('STUB', 'STRIPE')),
  provider_reference VARCHAR(255) UNIQUE,
  client_secret TEXT,
  client_user_id UUID REFERENCES users(id) ON DELETE RESTRICT,
  worker_user_id UUID REFERENCES users(id) ON DELETE RESTRICT,
  amount_cents BIGINT NOT NULL CHECK (amount_cents > 0),
  currency CHAR(3) NOT NULL CHECK (currency ~ '^[A-Z]{3}$'),
  idempotency_key VARCHAR(200) NOT NULL UNIQUE CHECK (length(btrim(idempotency_key)) >= 8),
  idempotency_fingerprint CHAR(64) NOT NULL CHECK (idempotency_fingerprint ~ '^[0-9a-f]{64}$'),
  dispatch_attempts INTEGER NOT NULL DEFAULT 0 CHECK (dispatch_attempts >= 0),
  last_dispatch_error TEXT,
  processed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT payment_operations_participants_check CHECK (
    (operation_type = 'FUNDING' AND client_user_id IS NOT NULL AND worker_user_id IS NULL)
    OR (operation_type = 'PAYOUT' AND client_user_id IS NULL AND worker_user_id IS NOT NULL)
  )
);

CREATE INDEX idx_payment_operations_dispatch ON payment_operations (status, created_at ASC)
  WHERE status IN ('CREATED', 'PENDING');
CREATE INDEX idx_payment_operations_job ON payment_operations (job_id, operation_type, created_at DESC);

CREATE TABLE payment_webhook_events (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  provider VARCHAR(32) NOT NULL CHECK (provider IN ('STUB', 'STRIPE')),
  provider_event_id VARCHAR(255) NOT NULL,
  payment_operation_id UUID REFERENCES payment_operations(id) ON DELETE RESTRICT,
  event_type VARCHAR(128) NOT NULL,
  payload JSONB NOT NULL,
  received_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  processed_at TIMESTAMPTZ,
  CONSTRAINT payment_webhook_events_provider_event_key UNIQUE (provider, provider_event_id)
);

CREATE TABLE payment_recipient_accounts (
  worker_id UUID PRIMARY KEY REFERENCES users(id) ON DELETE RESTRICT,
  provider VARCHAR(32) NOT NULL CHECK (provider = 'STRIPE'),
  external_account_id VARCHAR(255) NOT NULL UNIQUE CHECK (length(btrim(external_account_id)) > 0),
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE TRIGGER update_payment_recipient_accounts_updated_at
  BEFORE UPDATE ON payment_recipient_accounts
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

ALTER TABLE jobs
  ADD COLUMN escrow_status escrow_status NOT NULL DEFAULT 'UNFUNDED',
  ADD COLUMN funded_at TIMESTAMPTZ,
  ADD COLUMN escrow_ledger_transaction_id UUID REFERENCES ledger_transactions(id) ON DELETE RESTRICT,
  ADD COLUMN settlement_ledger_transaction_id UUID REFERENCES ledger_transactions(id) ON DELETE RESTRICT;
CREATE INDEX idx_jobs_discoverable_funded ON jobs (created_at DESC)
  WHERE status = 'POSTED' AND worker_id IS NULL AND escrow_status = 'HELD';

-- System accounts are ownerless; user-owned accounts are validated against the
-- role they represent before their immutable posting is inserted.
CREATE OR REPLACE FUNCTION get_or_create_ledger_account(
  p_owner_user_id UUID,
  p_account_kind ledger_account_kind,
  p_currency CHAR(3)
)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public, pg_temp
AS $$
DECLARE
  v_account_id UUID;
BEGIN
  IF p_currency !~ '^[A-Z]{3}$' THEN
    RAISE EXCEPTION 'Ledger currency is invalid' USING ERRCODE = '22023';
  END IF;
  IF p_account_kind = 'CLIENT_ESCROW' THEN
    PERFORM 1 FROM public.users WHERE id = p_owner_user_id AND role = 'CLIENT';
    IF NOT FOUND THEN RAISE EXCEPTION 'Client escrow account owner is invalid' USING ERRCODE = '23514'; END IF;
  ELSIF p_account_kind = 'WORKER_PAYABLE' THEN
    PERFORM 1 FROM public.users WHERE id = p_owner_user_id AND role = 'WORKER';
    IF NOT FOUND THEN RAISE EXCEPTION 'Worker payable account owner is invalid' USING ERRCODE = '23514'; END IF;
  ELSIF p_owner_user_id IS NOT NULL THEN
    RAISE EXCEPTION 'Platform accounts cannot have a user owner' USING ERRCODE = '23514';
  END IF;

  INSERT INTO public.ledger_accounts (owner_user_id, account_kind, currency)
  VALUES (p_owner_user_id, p_account_kind, p_currency)
  ON CONFLICT (owner_scope, account_kind, currency) DO UPDATE
    SET account_kind = EXCLUDED.account_kind
  RETURNING id INTO v_account_id;
  RETURN v_account_id;
END;
$$;

-- Every posting belongs to one immutable journal header. The header's unique
-- idempotency key, plus an advisory lock, makes retries return the exact same
-- economic event rather than a second charge or payout.
CREATE OR REPLACE FUNCTION post_ledger_transaction(
  p_job_id UUID,
  p_transaction_status transaction_status,
  p_currency CHAR(3),
  p_idempotency_key VARCHAR,
  p_idempotency_fingerprint CHAR(64),
  p_description TEXT,
  p_metadata JSONB,
  p_entries JSONB
)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public, pg_temp
AS $$
DECLARE
  v_transaction_id UUID;
  v_existing_fingerprint CHAR(64);
  v_entry JSONB;
  v_entry_index INTEGER := 0;
  v_owner_user_id UUID;
  v_account_kind ledger_account_kind;
  v_account_id UUID;
  v_amount_cents BIGINT;
  v_transaction_type transaction_type;
BEGIN
  IF p_transaction_status NOT IN ('PENDING', 'COMPLETED')
    OR p_currency !~ '^[A-Z]{3}$'
    OR p_idempotency_key IS NULL
    OR length(btrim(p_idempotency_key)) < 8
    OR length(p_idempotency_key) > 200
    OR p_idempotency_fingerprint !~ '^[0-9a-f]{64}$'
    OR length(btrim(COALESCE(p_description, ''))) = 0
    OR jsonb_typeof(p_entries) <> 'array'
    OR jsonb_array_length(p_entries) < 2 THEN
    RAISE EXCEPTION 'Invalid ledger transaction request' USING ERRCODE = '22023';
  END IF;

  PERFORM pg_advisory_xact_lock(hashtextextended(p_idempotency_key, 109));
  SELECT id, idempotency_fingerprint
  INTO v_transaction_id, v_existing_fingerprint
  FROM public.ledger_transactions
  WHERE idempotency_key = p_idempotency_key
  FOR UPDATE;
  IF FOUND THEN
    IF v_existing_fingerprint <> p_idempotency_fingerprint THEN
      RAISE EXCEPTION 'Ledger idempotency key was reused with different input' USING ERRCODE = '23505';
    END IF;
    RETURN v_transaction_id;
  END IF;

  INSERT INTO public.ledger_transactions (
    job_id, transaction_status, currency, idempotency_key,
    idempotency_fingerprint, description, metadata, processed_at
  ) VALUES (
    p_job_id, p_transaction_status, p_currency, p_idempotency_key,
    p_idempotency_fingerprint, btrim(p_description), COALESCE(p_metadata, '{}'::jsonb),
    CASE WHEN p_transaction_status = 'COMPLETED' THEN NOW() ELSE NULL END
  ) RETURNING id INTO v_transaction_id;

  FOR v_entry IN SELECT value FROM jsonb_array_elements(p_entries)
  LOOP
    v_entry_index := v_entry_index + 1;
    BEGIN
      v_owner_user_id := NULLIF(v_entry ->> 'owner_user_id', '')::uuid;
      v_account_kind := (v_entry ->> 'account_kind')::ledger_account_kind;
      v_amount_cents := (v_entry ->> 'amount_cents')::bigint;
      v_transaction_type := (v_entry ->> 'transaction_type')::transaction_type;
    EXCEPTION WHEN invalid_text_representation OR invalid_parameter_value THEN
      RAISE EXCEPTION 'Ledger entry is malformed' USING ERRCODE = '22023';
    END;
    IF v_amount_cents = 0 THEN
      RAISE EXCEPTION 'Ledger entries cannot be zero' USING ERRCODE = '22023';
    END IF;
    v_account_id := public.get_or_create_ledger_account(v_owner_user_id, v_account_kind, p_currency);

    INSERT INTO public.wallet_ledger (
      user_id, job_id, transaction_type, transaction_status, amount_cents,
      balance_after_cents, currency, reference_id, reference_type, description,
      metadata, idempotency_key, processed_at, ledger_transaction_id, ledger_account_id
    ) VALUES (
      v_owner_user_id, p_job_id, v_transaction_type, p_transaction_status, v_amount_cents,
      0, p_currency, v_transaction_id::text, 'LEDGER_TRANSACTION', btrim(p_description),
      COALESCE(v_entry -> 'metadata', '{}'::jsonb) || jsonb_build_object('ledger_transaction_id', v_transaction_id),
      p_idempotency_key || ':' || v_entry_index::text,
      CASE WHEN p_transaction_status = 'COMPLETED' THEN NOW() ELSE NULL END,
      v_transaction_id, v_account_id
    );
  END LOOP;
  RETURN v_transaction_id;
END;
$$;

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
  IF v_transaction_id IS NULL THEN
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

CREATE OR REPLACE FUNCTION enforce_ledger_transaction_postings_present()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public, pg_temp
AS $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM public.wallet_ledger WHERE ledger_transaction_id = NEW.id
  ) THEN
    RAISE EXCEPTION 'Ledger transaction % has no postings', NEW.id USING ERRCODE = '23514';
  END IF;
  RETURN NULL;
END;
$$;

CREATE CONSTRAINT TRIGGER enforce_ledger_transaction_balance_on_postings
  AFTER INSERT OR UPDATE OR DELETE ON wallet_ledger
  DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW EXECUTE FUNCTION enforce_ledger_transaction_balance();
CREATE CONSTRAINT TRIGGER enforce_ledger_transaction_postings_present
  AFTER INSERT ON ledger_transactions
  DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW EXECUTE FUNCTION enforce_ledger_transaction_postings_present();

CREATE OR REPLACE FUNCTION enforce_wallet_ledger_immutability()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public, pg_temp
AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    IF current_setting('networkpeer.maintenance_mode', TRUE) = 'on' THEN
      RETURN OLD;
    END IF;
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
  IF TG_OP = 'DELETE' THEN
    IF current_setting('networkpeer.maintenance_mode', TRUE) = 'on' THEN
      RETURN OLD;
    END IF;
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

CREATE TRIGGER enforce_wallet_ledger_immutability
  BEFORE UPDATE OR DELETE ON wallet_ledger
  FOR EACH ROW EXECUTE FUNCTION enforce_wallet_ledger_immutability();
CREATE TRIGGER enforce_ledger_transaction_immutability
  BEFORE UPDATE OR DELETE ON ledger_transactions
  FOR EACH ROW EXECUTE FUNCTION enforce_ledger_transaction_immutability();

-- Existing Phase 6 fanout assumed every ledger posting belongs to a user. System
-- counter-postings deliberately do not, while status changes must be visible to
-- the affected user wallet.
CREATE OR REPLACE FUNCTION emit_wallet_sync_event()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public, pg_temp
AS $$
BEGIN
  IF NEW.user_id IS NULL OR (TG_OP = 'UPDATE' AND NEW.transaction_status = OLD.transaction_status) THEN
    RETURN NEW;
  END IF;
  PERFORM public.emit_user_sync_event(
    NEW.user_id,
    'LEDGER_POSTED',
    'WALLET_LEDGER',
    NEW.id,
    jsonb_build_object('ledger_id', NEW.id, 'job_id', NEW.job_id, 'transaction_status', NEW.transaction_status),
    'Wallet activity',
    'A wallet ledger entry was recorded.',
    FALSE
  );
  RETURN NEW;
END;
$$;

DROP TRIGGER emit_wallet_sync_event ON wallet_ledger;
CREATE TRIGGER emit_wallet_sync_event
  AFTER INSERT OR UPDATE OF transaction_status ON wallet_ledger
  FOR EACH ROW EXECUTE FUNCTION emit_wallet_sync_event();

-- Job creation is a definer command so the request-path role cannot insert a
-- visible or funded job directly. Newly created jobs await payment in FUNDING.
CREATE OR REPLACE FUNCTION create_client_job(
  p_client_id UUID,
  p_title VARCHAR,
  p_description TEXT,
  p_category VARCHAR,
  p_budget_cents INTEGER,
  p_platform_fee_cents INTEGER,
  p_currency CHAR(3),
  p_longitude DOUBLE PRECISION,
  p_latitude DOUBLE PRECISION,
  p_address TEXT,
  p_scheduled_at TIMESTAMPTZ,
  p_metadata JSONB,
  p_public_title VARCHAR,
  p_public_description TEXT,
  p_subtasks JSONB,
  p_idempotency_key VARCHAR,
  p_idempotency_fingerprint CHAR(64)
)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public, pg_temp
AS $$
DECLARE
  v_job_id UUID;
  v_existing_fingerprint CHAR(64);
  v_subtask JSONB;
  v_sequence INTEGER := 0;
BEGIN
  IF p_budget_cents <= 0
    OR p_platform_fee_cents < 0
    OR p_platform_fee_cents > p_budget_cents
    OR p_currency !~ '^[A-Z]{3}$'
    OR p_longitude < -180 OR p_longitude > 180
    OR p_latitude < -90 OR p_latitude > 90
    OR length(btrim(COALESCE(p_title, ''))) < 3
    OR length(btrim(COALESCE(p_description, ''))) < 10
    OR length(btrim(COALESCE(p_category, ''))) < 2
    OR (p_idempotency_key IS NULL) <> (p_idempotency_fingerprint IS NULL) THEN
    RAISE EXCEPTION 'Invalid job creation request' USING ERRCODE = '22023';
  END IF;
  PERFORM 1 FROM public.users
  WHERE id = p_client_id AND role = 'CLIENT' AND is_active = TRUE
  FOR KEY SHARE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Client is not active' USING ERRCODE = '42501';
  END IF;

  IF p_idempotency_key IS NOT NULL THEN
    PERFORM pg_advisory_xact_lock(hashtextextended(p_client_id::text || ':' || p_idempotency_key, 113));
    SELECT id, idempotency_fingerprint INTO v_job_id, v_existing_fingerprint
    FROM public.jobs
    WHERE client_id = p_client_id AND idempotency_key = p_idempotency_key
    FOR UPDATE;
    IF FOUND THEN
      IF v_existing_fingerprint <> p_idempotency_fingerprint THEN
        RAISE EXCEPTION 'Job idempotency key was reused with different input' USING ERRCODE = '23505';
      END IF;
      RETURN v_job_id;
    END IF;
  END IF;

  INSERT INTO public.jobs (
    client_id, title, description, category, status, budget_cents, platform_fee_cents,
    currency, location, address, scheduled_at, metadata, public_title,
    public_description, idempotency_key, idempotency_fingerprint, escrow_status
  ) VALUES (
    p_client_id, btrim(p_title), btrim(p_description), btrim(p_category), 'FUNDING', p_budget_cents,
    p_platform_fee_cents, p_currency, ST_SetSRID(ST_MakePoint(p_longitude, p_latitude), 4326),
    p_address, p_scheduled_at, COALESCE(p_metadata, '{}'::jsonb),
    COALESCE(NULLIF(btrim(p_public_title), ''), 'Field work opportunity'),
    COALESCE(p_public_description, ''), p_idempotency_key, p_idempotency_fingerprint, 'UNFUNDED'
  ) RETURNING id INTO v_job_id;

  IF jsonb_typeof(COALESCE(p_subtasks, '[]'::jsonb)) <> 'array'
    OR jsonb_array_length(COALESCE(p_subtasks, '[]'::jsonb)) > 50 THEN
    RAISE EXCEPTION 'Job subtasks are invalid' USING ERRCODE = '22023';
  END IF;
  FOR v_subtask IN SELECT value FROM jsonb_array_elements(COALESCE(p_subtasks, '[]'::jsonb))
  LOOP
    IF length(btrim(COALESCE(v_subtask ->> 'title', ''))) = 0
      OR length(v_subtask ->> 'title') > 255
      OR length(COALESCE(v_subtask ->> 'description', '')) > 2000
      OR COALESCE(v_subtask ->> 'is_required', 'true') NOT IN ('true', 'false') THEN
      RAISE EXCEPTION 'Job subtask is invalid' USING ERRCODE = '22023';
    END IF;
    INSERT INTO public.job_subtasks (job_id, title, description, sequence_order, is_required, metadata)
    VALUES (
      v_job_id,
      btrim(v_subtask ->> 'title'),
      NULLIF(btrim(COALESCE(v_subtask ->> 'description', '')), ''),
      v_sequence,
      COALESCE(v_subtask ->> 'is_required', 'true')::boolean,
      COALESCE(v_subtask -> 'metadata', '{}'::jsonb)
    );
    v_sequence := v_sequence + 1;
  END LOOP;
  RETURN v_job_id;
END;
$$;

CREATE OR REPLACE FUNCTION enforce_job_lifecycle_transition()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = pg_catalog, public, pg_temp
AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    IF NEW.status NOT IN ('FUNDING', 'POSTED') THEN
      RAISE EXCEPTION 'Jobs must be created in FUNDING or funded POSTED status' USING ERRCODE = '23514';
    END IF;
    RETURN NEW;
  END IF;
  IF NEW.status = OLD.status THEN
    RETURN NEW;
  END IF;
  IF NOT (
    (OLD.status = 'FUNDING' AND NEW.status IN ('POSTED', 'CANCELLED')) OR
    (OLD.status = 'POSTED' AND NEW.status IN ('ASSIGNED', 'CANCELLED')) OR
    (OLD.status = 'ASSIGNED' AND NEW.status IN ('EN_ROUTE', 'CANCELLED', 'DISPUTED')) OR
    (OLD.status = 'EN_ROUTE' AND NEW.status IN ('AT_LOCATION', 'CANCELLED', 'DISPUTED')) OR
    (OLD.status = 'AT_LOCATION' AND NEW.status IN ('IN_PROGRESS', 'CANCELLED', 'DISPUTED')) OR
    (OLD.status = 'IN_PROGRESS' AND NEW.status IN ('SUBMITTED', 'CANCELLED', 'DISPUTED')) OR
    (OLD.status = 'SUBMITTED' AND NEW.status IN ('APPROVED', 'DISPUTED')) OR
    (OLD.status = 'APPROVED' AND NEW.status IN ('COMPLETED', 'DISPUTED')) OR
    (OLD.status = 'DISPUTED' AND NEW.status = 'APPROVED') OR
    public.job_override_is_authorized(NEW.id, OLD.status, NEW.status, OLD.worker_id, NEW.worker_id)
  ) THEN
    RAISE EXCEPTION 'Invalid job state transition: % -> %', OLD.status, NEW.status USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION enforce_job_financial_state()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = pg_catalog, public, pg_temp
AS $$
BEGIN
  IF NEW.status = 'FUNDING' AND NEW.escrow_status NOT IN ('UNFUNDED', 'PENDING') THEN
    RAISE EXCEPTION 'Funding jobs must not expose settled escrow' USING ERRCODE = '23514';
  END IF;
  IF NEW.status IN ('POSTED', 'ASSIGNED', 'EN_ROUTE', 'AT_LOCATION', 'IN_PROGRESS', 'SUBMITTED')
    AND NEW.escrow_status <> 'HELD' THEN
    RAISE EXCEPTION 'Active jobs require a completed escrow hold' USING ERRCODE = '23514';
  END IF;
  IF NEW.status IN ('APPROVED', 'COMPLETED') AND NEW.escrow_status <> 'RELEASED' THEN
    RAISE EXCEPTION 'Approved/completed jobs require an escrow settlement' USING ERRCODE = '23514';
  END IF;
  IF NEW.status = 'CANCELLED' AND NEW.escrow_status NOT IN ('UNFUNDED', 'REFUNDED') THEN
    RAISE EXCEPTION 'Funded jobs require an explicit refund before cancellation' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER enforce_job_financial_state
  BEFORE INSERT OR UPDATE OF status, escrow_status ON jobs
  FOR EACH ROW EXECUTE FUNCTION enforce_job_financial_state();

-- A claim is authoritative only after webhook-settled escrow has made the job
-- visible. The client -> worker profile -> job lock order also serializes a
-- client suspension with acceptance.
CREATE OR REPLACE FUNCTION accept_job(p_job_id UUID, p_worker_id UUID)
RETURNS TABLE (job_id UUID, worker_id UUID, status job_status)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public, pg_temp
AS $$
DECLARE
  v_initial_client_id UUID;
  v_worker_available BOOLEAN;
  v_worker_verification_status TEXT;
  v_worker_location geometry;
  v_worker_location_updated_at TIMESTAMPTZ;
  v_worker_radius_km INTEGER;
  v_current_status job_status;
  v_assigned_worker UUID;
  v_client_id UUID;
  v_job_location geometry;
  v_escrow_status escrow_status;
BEGIN
  SELECT j.client_id INTO v_initial_client_id FROM public.jobs AS j WHERE j.id = p_job_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'Job % does not exist', p_job_id USING ERRCODE = '22000'; END IF;
  PERFORM 1 FROM public.users AS u
  WHERE u.id = v_initial_client_id AND u.role = 'CLIENT' AND u.is_active = TRUE
  FOR KEY SHARE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Job client is not active' USING ERRCODE = '55000'; END IF;
  PERFORM 1 FROM public.users WHERE id = p_worker_id AND is_active = TRUE AND role = 'WORKER';
  IF NOT FOUND THEN RAISE EXCEPTION 'Worker is not active' USING ERRCODE = '22000'; END IF;

  SELECT wp.is_available, wp.verification_status, wp.current_location, wp.last_location_update, wp.preferred_radius_km
  INTO v_worker_available, v_worker_verification_status, v_worker_location, v_worker_location_updated_at, v_worker_radius_km
  FROM public.worker_profiles AS wp WHERE wp.user_id = p_worker_id FOR UPDATE;
  IF NOT FOUND OR v_worker_verification_status <> 'VERIFIED' THEN
    RAISE EXCEPTION 'Worker is not verified' USING ERRCODE = '22000';
  END IF;

  SELECT j.status, j.worker_id, j.client_id, j.location, j.escrow_status
  INTO v_current_status, v_assigned_worker, v_client_id, v_job_location, v_escrow_status
  FROM public.jobs AS j WHERE j.id = p_job_id FOR UPDATE;
  IF v_client_id IS DISTINCT FROM v_initial_client_id THEN
    RAISE EXCEPTION 'Job owner changed; retry acceptance' USING ERRCODE = '40001';
  END IF;
  IF v_current_status = 'ASSIGNED' AND v_assigned_worker = p_worker_id THEN
    RETURN QUERY SELECT j.id, j.worker_id, j.status FROM public.jobs AS j WHERE j.id = p_job_id;
    RETURN;
  END IF;
  IF v_worker_available IS NOT TRUE OR v_current_status <> 'POSTED' OR v_escrow_status <> 'HELD' THEN
    RAISE EXCEPTION 'Job is not claimable' USING ERRCODE = '55000';
  END IF;
  IF v_worker_location IS NULL OR v_worker_location_updated_at IS NULL
    OR v_worker_location_updated_at <= NOW() - INTERVAL '15 minutes' THEN
    RAISE EXCEPTION 'Worker location is missing or stale' USING ERRCODE = '22000';
  END IF;
  IF NOT ST_DWithin(v_job_location::geography, v_worker_location::geography, v_worker_radius_km * 1000) THEN
    RAISE EXCEPTION 'Job is outside the worker preferred radius' USING ERRCODE = '22000';
  END IF;

  UPDATE public.jobs SET status = 'ASSIGNED', worker_id = p_worker_id, updated_at = NOW() WHERE id = p_job_id;
  UPDATE public.worker_profiles SET is_available = FALSE, updated_at = NOW() WHERE user_id = p_worker_id;
  RETURN QUERY SELECT j.id, j.worker_id, j.status FROM public.jobs AS j WHERE j.id = p_job_id;
END;
$$;

CREATE OR REPLACE FUNCTION cancel_client_job(
  p_job_id UUID,
  p_client_id UUID,
  p_reason TEXT
)
RETURNS TABLE (job_id UUID, status job_status)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public, pg_temp
AS $$
DECLARE
  v_status job_status;
  v_owner UUID;
  v_escrow_status escrow_status;
BEGIN
  PERFORM 1 FROM public.users WHERE id = p_client_id AND role = 'CLIENT' AND is_active = TRUE FOR KEY SHARE;
  IF NOT FOUND THEN RETURN; END IF;
  SELECT j.status, j.client_id, j.escrow_status INTO v_status, v_owner, v_escrow_status
  FROM public.jobs AS j WHERE j.id = p_job_id FOR UPDATE;
  IF NOT FOUND OR v_owner IS DISTINCT FROM p_client_id OR v_status <> 'FUNDING' OR v_escrow_status <> 'UNFUNDED' THEN
    RETURN;
  END IF;
  UPDATE public.jobs SET status = 'CANCELLED', cancelled_at = NOW(), cancellation_reason = NULLIF(btrim(p_reason), ''), updated_at = NOW()
  WHERE id = p_job_id;
  RETURN QUERY SELECT j.id, j.status FROM public.jobs AS j WHERE j.id = p_job_id;
END;
$$;

CREATE OR REPLACE FUNCTION resolve_client_job(
  p_job_id UUID,
  p_client_id UUID,
  p_action VARCHAR
)
RETURNS TABLE (job_id UUID, status job_status)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public, pg_temp
AS $$
DECLARE
  v_status job_status;
  v_owner UUID;
  v_worker_id UUID;
  v_action VARCHAR := upper(btrim(p_action));
BEGIN
  PERFORM 1 FROM public.users WHERE id = p_client_id AND role = 'CLIENT' AND is_active = TRUE FOR KEY SHARE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Client is not active' USING ERRCODE = 'P0002'; END IF;
  SELECT j.worker_id INTO v_worker_id FROM public.jobs AS j WHERE j.id = p_job_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'Job not found' USING ERRCODE = 'P0002'; END IF;
  IF v_worker_id IS NOT NULL THEN PERFORM 1 FROM public.worker_profiles WHERE user_id = v_worker_id FOR UPDATE; END IF;
  SELECT j.status, j.client_id, j.worker_id INTO v_status, v_owner, v_worker_id
  FROM public.jobs AS j WHERE j.id = p_job_id FOR UPDATE;
  IF v_owner IS DISTINCT FROM p_client_id THEN RAISE EXCEPTION 'Job not found' USING ERRCODE = 'P0002'; END IF;
  IF v_action = 'APPROVE' THEN
    RAISE EXCEPTION 'Approval requires financial settlement' USING ERRCODE = '55000';
  ELSIF v_action = 'COMPLETE' THEN
    IF v_status <> 'APPROVED' THEN RAISE EXCEPTION 'Job cannot be completed in its current state' USING ERRCODE = '55000'; END IF;
    UPDATE public.jobs SET status = 'COMPLETED', completed_at = NOW(), updated_at = NOW() WHERE id = p_job_id;
    UPDATE public.worker_profiles AS wp
    SET is_available = TRUE, updated_at = NOW()
    WHERE wp.user_id = v_worker_id
      AND wp.verification_status = 'VERIFIED'
      AND EXISTS (SELECT 1 FROM public.users AS u WHERE u.id = v_worker_id AND u.is_active = TRUE)
      AND NOT EXISTS (
        SELECT 1 FROM public.jobs AS active_job
        WHERE active_job.worker_id = v_worker_id
          AND active_job.status IN ('ASSIGNED', 'EN_ROUTE', 'AT_LOCATION', 'IN_PROGRESS', 'SUBMITTED', 'APPROVED', 'DISPUTED')
      );
  ELSIF v_action = 'DISPUTE' THEN
    IF v_status NOT IN ('ASSIGNED', 'EN_ROUTE', 'AT_LOCATION', 'IN_PROGRESS', 'SUBMITTED', 'APPROVED') THEN
      RAISE EXCEPTION 'Job cannot be disputed in its current state' USING ERRCODE = '55000';
    END IF;
    UPDATE public.jobs
    SET status = 'DISPUTED',
        escrow_status = CASE WHEN escrow_status = 'HELD' THEN 'FROZEN' ELSE escrow_status END,
        updated_at = NOW()
    WHERE id = p_job_id;
  ELSE
    RAISE EXCEPTION 'Unsupported client resolution action' USING ERRCODE = '22023';
  END IF;
  RETURN QUERY SELECT j.id, j.status FROM public.jobs AS j WHERE j.id = p_job_id;
END;
$$;

CREATE OR REPLACE FUNCTION begin_escrow_funding(
  p_client_id UUID,
  p_job_id UUID,
  p_provider VARCHAR,
  p_idempotency_key VARCHAR,
  p_idempotency_fingerprint CHAR(64)
)
RETURNS TABLE (
  operation_id UUID,
  ledger_transaction_id UUID,
  amount_cents BIGINT,
  currency CHAR(3),
  status payment_operation_status,
  dispatch_required BOOLEAN,
  provider_reference VARCHAR,
  client_secret TEXT
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public, pg_temp
AS $$
DECLARE
  v_job_client_id UUID;
  v_job_status job_status;
  v_escrow_status escrow_status;
  v_budget_cents BIGINT;
  v_currency CHAR(3);
  v_existing_fingerprint CHAR(64);
  v_operation_id UUID;
  v_transaction_id UUID;
  v_operation_status payment_operation_status;
  v_provider_reference VARCHAR;
  v_client_secret TEXT;
BEGIN
  IF p_provider NOT IN ('STUB', 'STRIPE') OR p_idempotency_key IS NULL OR length(p_idempotency_key) < 8
    OR length(p_idempotency_key) > 180 OR p_idempotency_fingerprint !~ '^[0-9a-f]{64}$' THEN
    RAISE EXCEPTION 'Invalid escrow funding request' USING ERRCODE = '22023';
  END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended(p_client_id::text || ':' || p_idempotency_key, 127));
  SELECT idempotency_fingerprint, id, ledger_transaction_id, status, amount_cents, currency, provider_reference, client_secret
  INTO v_existing_fingerprint, v_operation_id, v_transaction_id, v_operation_status, v_budget_cents, v_currency, v_provider_reference, v_client_secret
  FROM public.payment_operations
  WHERE idempotency_key = p_idempotency_key
  FOR UPDATE;
  IF FOUND THEN
    IF v_existing_fingerprint <> p_idempotency_fingerprint THEN
      RAISE EXCEPTION 'Payment idempotency key was reused with different input' USING ERRCODE = '23505';
    END IF;
    RETURN QUERY SELECT v_operation_id, v_transaction_id, v_budget_cents, v_currency, v_operation_status,
      v_operation_status = 'CREATED', v_provider_reference, v_client_secret;
    RETURN;
  END IF;

  SELECT j.client_id, j.status, j.escrow_status, j.budget_cents, j.currency
  INTO v_job_client_id, v_job_status, v_escrow_status, v_budget_cents, v_currency
  FROM public.jobs AS j WHERE j.id = p_job_id FOR UPDATE;
  IF NOT FOUND OR v_job_client_id IS DISTINCT FROM p_client_id THEN
    RAISE EXCEPTION 'Job not found' USING ERRCODE = 'P0002';
  END IF;
  PERFORM 1 FROM public.users WHERE id = p_client_id AND role = 'CLIENT' AND is_active = TRUE FOR KEY SHARE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Client is not active' USING ERRCODE = '42501'; END IF;
  IF v_job_status <> 'FUNDING' OR v_escrow_status NOT IN ('UNFUNDED', 'PENDING') THEN
    RAISE EXCEPTION 'Job is not awaiting escrow funding' USING ERRCODE = '55000';
  END IF;

  v_transaction_id := public.post_ledger_transaction(
    p_job_id, 'PENDING', v_currency, p_idempotency_key || ':hold', p_idempotency_fingerprint,
    'Escrow funding authorization', jsonb_build_object('provider', p_provider),
    jsonb_build_array(
      jsonb_build_object('account_kind', 'PLATFORM_GATEWAY_CLEARING', 'amount_cents', v_budget_cents, 'transaction_type', 'ESCROW_HOLD'),
      jsonb_build_object('account_kind', 'CLIENT_ESCROW', 'owner_user_id', p_client_id, 'amount_cents', -v_budget_cents, 'transaction_type', 'ESCROW_HOLD')
    )
  );
  INSERT INTO public.payment_operations (
    job_id, ledger_transaction_id, operation_type, provider, client_user_id,
    amount_cents, currency, idempotency_key, idempotency_fingerprint
  ) VALUES (
    p_job_id, v_transaction_id, 'FUNDING', p_provider, p_client_id,
    v_budget_cents, v_currency, p_idempotency_key, p_idempotency_fingerprint
  ) RETURNING id, status INTO v_operation_id, v_operation_status;
  UPDATE public.jobs SET escrow_status = 'PENDING', updated_at = NOW() WHERE id = p_job_id;
  RETURN QUERY SELECT v_operation_id, v_transaction_id, v_budget_cents, v_currency, v_operation_status, TRUE, NULL::varchar, NULL::text;
END;
$$;

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
      dispatch_attempts = dispatch_attempts + 1,
      last_dispatch_error = NULL
  WHERE id = p_operation_id;
  RETURN QUERY SELECT id, status, provider_reference, client_secret FROM public.payment_operations WHERE id = p_operation_id;
END;
$$;

CREATE OR REPLACE FUNCTION approve_client_job_with_settlement(
  p_client_id UUID,
  p_job_id UUID,
  p_provider VARCHAR,
  p_idempotency_key VARCHAR,
  p_idempotency_fingerprint CHAR(64)
)
RETURNS TABLE (
  job_id UUID,
  status job_status,
  settlement_ledger_transaction_id UUID,
  payout_operation_id UUID,
  payout_amount_cents BIGINT,
  currency CHAR(3),
  worker_id UUID,
  external_account_id VARCHAR,
  payout_dispatch_required BOOLEAN
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public, pg_temp
AS $$
DECLARE
  v_initial_client_id UUID;
  v_worker_id UUID;
  v_status job_status;
  v_client_id UUID;
  v_escrow_status escrow_status;
  v_budget_cents BIGINT;
  v_fee_cents BIGINT;
  v_payout_cents BIGINT;
  v_currency CHAR(3);
  v_settlement_transaction_id UUID;
  v_payout_transaction_id UUID;
  v_operation_id UUID;
  v_external_account_id VARCHAR;
BEGIN
  IF p_provider NOT IN ('STUB', 'STRIPE') OR p_idempotency_key IS NULL OR length(p_idempotency_key) < 8
    OR length(p_idempotency_key) > 180 OR p_idempotency_fingerprint !~ '^[0-9a-f]{64}$' THEN
    RAISE EXCEPTION 'Invalid approval settlement request' USING ERRCODE = '22023';
  END IF;
  SELECT j.client_id, j.worker_id INTO v_initial_client_id, v_worker_id FROM public.jobs AS j WHERE j.id = p_job_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'Job not found' USING ERRCODE = 'P0002'; END IF;
  PERFORM 1 FROM public.users WHERE id = v_initial_client_id AND role = 'CLIENT' AND is_active = TRUE FOR KEY SHARE;
  IF NOT FOUND OR v_initial_client_id IS DISTINCT FROM p_client_id THEN RAISE EXCEPTION 'Job not found' USING ERRCODE = 'P0002'; END IF;
  IF v_worker_id IS NOT NULL THEN PERFORM 1 FROM public.worker_profiles WHERE user_id = v_worker_id FOR UPDATE; END IF;

  SELECT j.status, j.client_id, j.worker_id, j.escrow_status, j.budget_cents, j.platform_fee_cents, j.currency
  INTO v_status, v_client_id, v_worker_id, v_escrow_status, v_budget_cents, v_fee_cents, v_currency
  FROM public.jobs AS j WHERE j.id = p_job_id FOR UPDATE;
  IF v_client_id IS DISTINCT FROM p_client_id OR v_worker_id IS NULL THEN RAISE EXCEPTION 'Job not found' USING ERRCODE = 'P0002'; END IF;

  SELECT po.id, lt.id INTO v_operation_id, v_settlement_transaction_id
  FROM public.payment_operations AS po
  JOIN public.ledger_transactions AS lt ON lt.id = po.ledger_transaction_id
  WHERE po.idempotency_key = p_idempotency_key || ':payout'
  FOR UPDATE OF po;
  IF FOUND THEN
    IF NOT EXISTS (
      SELECT 1 FROM public.ledger_transactions WHERE id = v_settlement_transaction_id AND idempotency_fingerprint = p_idempotency_fingerprint
    ) THEN RAISE EXCEPTION 'Payment idempotency key was reused with different input' USING ERRCODE = '23505'; END IF;
    SELECT external_account_id INTO v_external_account_id
    FROM public.payment_recipient_accounts WHERE worker_id = v_worker_id AND provider = 'STRIPE' AND is_active = TRUE;
    RETURN QUERY SELECT p_job_id, v_status, v_settlement_transaction_id, v_operation_id,
      v_budget_cents - v_fee_cents, v_currency, v_worker_id, v_external_account_id, FALSE;
    RETURN;
  END IF;

  IF v_status <> 'SUBMITTED' OR v_escrow_status <> 'HELD' THEN
    RAISE EXCEPTION 'Job is not ready for financial approval' USING ERRCODE = '55000';
  END IF;
  v_payout_cents := v_budget_cents - v_fee_cents;
  IF v_payout_cents <= 0 THEN RAISE EXCEPTION 'Job payout must be positive after fees' USING ERRCODE = '23514'; END IF;

  v_settlement_transaction_id := public.post_ledger_transaction(
    p_job_id, 'COMPLETED', v_currency, p_idempotency_key || ':settlement', p_idempotency_fingerprint,
    'Escrow released after client approval', jsonb_build_object('provider', p_provider),
    jsonb_build_array(
      jsonb_build_object('account_kind', 'CLIENT_ESCROW', 'owner_user_id', p_client_id, 'amount_cents', v_budget_cents, 'transaction_type', 'ESCROW_RELEASE'),
      jsonb_build_object('account_kind', 'WORKER_PAYABLE', 'owner_user_id', v_worker_id, 'amount_cents', -v_payout_cents, 'transaction_type', 'WORKER_PAYOUT'),
      jsonb_build_object('account_kind', 'PLATFORM_REVENUE', 'amount_cents', -v_fee_cents, 'transaction_type', 'PLATFORM_FEE')
    )
  );
  v_payout_transaction_id := public.post_ledger_transaction(
    p_job_id, 'PENDING', v_currency, p_idempotency_key || ':payout-ledger', p_idempotency_fingerprint,
    'Worker payout dispatch', jsonb_build_object('provider', p_provider),
    jsonb_build_array(
      jsonb_build_object('account_kind', 'WORKER_PAYABLE', 'owner_user_id', v_worker_id, 'amount_cents', v_payout_cents, 'transaction_type', 'WITHDRAWAL'),
      jsonb_build_object('account_kind', 'PLATFORM_GATEWAY_CLEARING', 'amount_cents', -v_payout_cents, 'transaction_type', 'WITHDRAWAL')
    )
  );
  INSERT INTO public.payment_operations (
    job_id, ledger_transaction_id, operation_type, provider, worker_user_id,
    amount_cents, currency, idempotency_key, idempotency_fingerprint
  ) VALUES (
    p_job_id, v_payout_transaction_id, 'PAYOUT', p_provider, v_worker_id,
    v_payout_cents, v_currency, p_idempotency_key || ':payout', p_idempotency_fingerprint
  ) RETURNING id INTO v_operation_id;
  SELECT external_account_id INTO v_external_account_id
  FROM public.payment_recipient_accounts WHERE worker_id = v_worker_id AND provider = 'STRIPE' AND is_active = TRUE;

  UPDATE public.jobs
  SET status = 'APPROVED',
      escrow_status = 'RELEASED',
      settlement_ledger_transaction_id = v_settlement_transaction_id,
      updated_at = NOW()
  WHERE id = p_job_id;
  RETURN QUERY SELECT p_job_id, 'APPROVED'::job_status, v_settlement_transaction_id, v_operation_id,
    v_payout_cents, v_currency, v_worker_id, v_external_account_id, TRUE;
END;
$$;

CREATE OR REPLACE FUNCTION settle_payment_webhook(
  p_provider VARCHAR,
  p_provider_event_id VARCHAR,
  p_provider_reference VARCHAR,
  p_event_type VARCHAR,
  p_outcome payment_operation_status,
  p_payload JSONB
)
RETURNS TABLE (
  operation_id UUID,
  operation_type payment_operation_type,
  status payment_operation_status,
  duplicate BOOLEAN
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public, pg_temp
AS $$
DECLARE
  v_event_id UUID;
  v_operation_id UUID;
  v_operation_type payment_operation_type;
  v_status payment_operation_status;
  v_ledger_transaction_id UUID;
  v_job_id UUID;
BEGIN
  IF p_provider NOT IN ('STUB', 'STRIPE')
    OR p_provider_event_id IS NULL OR length(btrim(p_provider_event_id)) = 0
    OR p_provider_reference IS NULL OR length(btrim(p_provider_reference)) = 0
    OR p_outcome NOT IN ('SUCCEEDED', 'FAILED') THEN
    RAISE EXCEPTION 'Payment webhook is invalid' USING ERRCODE = '22023';
  END IF;

  INSERT INTO public.payment_webhook_events (provider, provider_event_id, event_type, payload)
  VALUES (p_provider, p_provider_event_id, p_event_type, COALESCE(p_payload, '{}'::jsonb))
  ON CONFLICT (provider, provider_event_id) DO NOTHING
  RETURNING id INTO v_event_id;
  IF v_event_id IS NULL THEN
    SELECT po.id, po.operation_type, po.status
    INTO v_operation_id, v_operation_type, v_status
    FROM public.payment_webhook_events AS event
    JOIN public.payment_operations AS po ON po.id = event.payment_operation_id
    WHERE event.provider = p_provider AND event.provider_event_id = p_provider_event_id;
    RETURN QUERY SELECT v_operation_id, v_operation_type, v_status, TRUE;
    RETURN;
  END IF;

  SELECT id, operation_type, status, ledger_transaction_id, job_id
  INTO v_operation_id, v_operation_type, v_status, v_ledger_transaction_id, v_job_id
  FROM public.payment_operations
  WHERE provider = p_provider AND provider_reference = p_provider_reference
  FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Payment operation not found' USING ERRCODE = 'P0002';
  END IF;
  UPDATE public.payment_webhook_events SET payment_operation_id = v_operation_id, processed_at = NOW() WHERE id = v_event_id;

  IF v_status IN ('SUCCEEDED', 'FAILED', 'CANCELLED') THEN
    RETURN QUERY SELECT v_operation_id, v_operation_type, v_status, FALSE;
    RETURN;
  END IF;
  UPDATE public.ledger_transactions SET transaction_status = p_outcome::transaction_status, processed_at = NOW()
  WHERE id = v_ledger_transaction_id;
  UPDATE public.wallet_ledger SET transaction_status = p_outcome::transaction_status, processed_at = NOW()
  WHERE ledger_transaction_id = v_ledger_transaction_id;
  UPDATE public.payment_operations SET status = p_outcome, processed_at = NOW() WHERE id = v_operation_id;

  IF v_operation_type = 'FUNDING' AND p_outcome = 'SUCCEEDED' THEN
    UPDATE public.jobs
    SET status = 'POSTED', escrow_status = 'HELD', funded_at = NOW(),
        escrow_ledger_transaction_id = v_ledger_transaction_id, updated_at = NOW()
    WHERE id = v_job_id AND status = 'FUNDING';
  ELSIF v_operation_type = 'FUNDING' AND p_outcome = 'FAILED' THEN
    UPDATE public.jobs SET escrow_status = 'UNFUNDED', updated_at = NOW()
    WHERE id = v_job_id AND status = 'FUNDING';
  END IF;
  RETURN QUERY SELECT v_operation_id, v_operation_type, p_outcome, FALSE;
END;
$$;

CREATE OR REPLACE FUNCTION get_wallet_summary(p_user_id UUID)
RETURNS TABLE (
  currency CHAR(3),
  available_balance_cents BIGINT,
  pending_escrow_cents BIGINT,
  lifetime_earnings_cents BIGINT,
  lifetime_spend_cents BIGINT
)
LANGUAGE sql
SECURITY DEFINER
SET search_path = pg_catalog, public, pg_temp
AS $$
  WITH user_postings AS (
    SELECT posting.*, account.account_kind
    FROM public.wallet_ledger AS posting
    JOIN public.ledger_accounts AS account ON account.id = posting.ledger_account_id
    WHERE posting.user_id = p_user_id
      AND posting.transaction_status = 'COMPLETED'
  )
  SELECT
    currency,
    GREATEST(-COALESCE(SUM(amount_cents) FILTER (WHERE account_kind = 'WORKER_PAYABLE'), 0), 0)::bigint AS available_balance_cents,
    GREATEST(-COALESCE(SUM(amount_cents) FILTER (WHERE account_kind = 'CLIENT_ESCROW'), 0), 0)::bigint AS pending_escrow_cents,
    GREATEST(-COALESCE(SUM(amount_cents) FILTER (WHERE transaction_type = 'WORKER_PAYOUT'), 0), 0)::bigint AS lifetime_earnings_cents,
    GREATEST(-COALESCE(SUM(amount_cents) FILTER (WHERE transaction_type = 'ESCROW_HOLD'), 0), 0)::bigint AS lifetime_spend_cents
  FROM user_postings
  GROUP BY currency
  ORDER BY currency ASC;
$$;

REVOKE EXECUTE ON FUNCTION get_or_create_ledger_account(UUID, ledger_account_kind, CHAR(3)) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION post_ledger_transaction(UUID, transaction_status, CHAR(3), VARCHAR, CHAR(64), TEXT, JSONB, JSONB) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION begin_escrow_funding(UUID, UUID, VARCHAR, VARCHAR, CHAR(64)) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION mark_payment_operation_dispatched(UUID, VARCHAR, TEXT) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION approve_client_job_with_settlement(UUID, UUID, VARCHAR, VARCHAR, CHAR(64)) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION settle_payment_webhook(VARCHAR, VARCHAR, VARCHAR, VARCHAR, payment_operation_status, JSONB) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION get_wallet_summary(UUID) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION create_client_job(UUID, VARCHAR, TEXT, VARCHAR, INTEGER, INTEGER, CHAR(3), DOUBLE PRECISION, DOUBLE PRECISION, TEXT, TIMESTAMPTZ, JSONB, VARCHAR, TEXT, JSONB, VARCHAR, CHAR(64)) FROM PUBLIC;
