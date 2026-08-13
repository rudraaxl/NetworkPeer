-- Close financial lifecycle gaps discovered after exercising the Phase 8 flow.
-- These are forward-only replacements for SECURITY DEFINER commands.

DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM public.payment_operations
    WHERE operation_type = 'FUNDING'
      AND status IN ('CREATED', 'PENDING')
    GROUP BY job_id
    HAVING COUNT(*) > 1
  ) THEN
    RAISE EXCEPTION 'Cannot add active funding invariant: reconcile duplicate pending funding operations first';
  END IF;
END;
$$;

CREATE UNIQUE INDEX payment_operations_one_active_funding_per_job
  ON public.payment_operations (job_id)
  WHERE operation_type = 'FUNDING'
    AND status IN ('CREATED', 'PENDING');

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
    OR p_platform_fee_cents >= p_budget_cents
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
  SELECT po.idempotency_fingerprint, po.id, po.ledger_transaction_id, po.status, po.amount_cents,
         po.currency, po.provider_reference, po.client_secret
  INTO v_existing_fingerprint, v_operation_id, v_transaction_id, v_operation_status, v_budget_cents,
       v_currency, v_provider_reference, v_client_secret
  FROM public.payment_operations AS po
  WHERE po.idempotency_key = p_idempotency_key
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
  IF v_job_status <> 'FUNDING' OR v_escrow_status <> 'UNFUNDED' THEN
    RAISE EXCEPTION 'Job is not awaiting escrow funding' USING ERRCODE = '55000';
  END IF;
  IF EXISTS (
    SELECT 1
    FROM public.payment_operations AS po
    WHERE po.job_id = p_job_id
      AND po.operation_type = 'FUNDING'
      AND po.status IN ('CREATED', 'PENDING')
  ) THEN
    RAISE EXCEPTION 'A funding operation is already pending for this job' USING ERRCODE = '55000';
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
#variable_conflict use_column
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
  v_operation_status payment_operation_status;
  v_existing_fingerprint CHAR(64);
  v_external_account_id VARCHAR;
  v_settlement_entries JSONB;
BEGIN
  IF p_provider NOT IN ('STUB', 'STRIPE') OR p_idempotency_key IS NULL OR length(p_idempotency_key) < 8
    OR length(p_idempotency_key) > 180 OR p_idempotency_fingerprint !~ '^[0-9a-f]{64}$' THEN
    RAISE EXCEPTION 'Invalid approval settlement request' USING ERRCODE = '22023';
  END IF;
  SELECT j.client_id, j.worker_id INTO v_initial_client_id, v_worker_id
  FROM public.jobs AS j WHERE j.id = p_job_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'Job not found' USING ERRCODE = 'P0002'; END IF;
  PERFORM 1 FROM public.users
  WHERE id = v_initial_client_id AND role = 'CLIENT' AND is_active = TRUE
  FOR KEY SHARE;
  IF NOT FOUND OR v_initial_client_id IS DISTINCT FROM p_client_id THEN
    RAISE EXCEPTION 'Job not found' USING ERRCODE = 'P0002';
  END IF;
  IF v_worker_id IS NOT NULL THEN
    PERFORM 1 FROM public.users
    WHERE id = v_worker_id AND role = 'WORKER' AND is_active = TRUE
    FOR KEY SHARE;
    IF NOT FOUND THEN RAISE EXCEPTION 'Assigned worker is not active' USING ERRCODE = '55000'; END IF;
    PERFORM 1 FROM public.worker_profiles WHERE user_id = v_worker_id FOR UPDATE;
  END IF;

  SELECT j.status, j.client_id, j.worker_id, j.escrow_status, j.budget_cents, j.platform_fee_cents, j.currency
  INTO v_status, v_client_id, v_worker_id, v_escrow_status, v_budget_cents, v_fee_cents, v_currency
  FROM public.jobs AS j WHERE j.id = p_job_id FOR UPDATE;
  IF v_client_id IS DISTINCT FROM p_client_id OR v_worker_id IS NULL THEN
    RAISE EXCEPTION 'Job not found' USING ERRCODE = 'P0002';
  END IF;

  SELECT po.id, po.status, po.amount_cents, po.idempotency_fingerprint
  INTO v_operation_id, v_operation_status, v_payout_cents, v_existing_fingerprint
  FROM public.payment_operations AS po
  WHERE po.job_id = p_job_id AND po.idempotency_key = p_idempotency_key || ':payout'
  FOR UPDATE;
  IF FOUND THEN
    IF v_existing_fingerprint <> p_idempotency_fingerprint THEN
      RAISE EXCEPTION 'Payment idempotency key was reused with different input' USING ERRCODE = '23505';
    END IF;
    SELECT j.settlement_ledger_transaction_id INTO v_settlement_transaction_id
    FROM public.jobs AS j WHERE j.id = p_job_id;
    IF v_settlement_transaction_id IS NULL THEN
      RAISE EXCEPTION 'Approval settlement is incomplete' USING ERRCODE = '23514';
    END IF;
    IF p_provider = 'STRIPE' THEN
      SELECT account.external_account_id INTO v_external_account_id
      FROM public.payment_recipient_accounts AS account
      WHERE account.worker_id = v_worker_id AND account.provider = 'STRIPE' AND account.is_active = TRUE
      FOR KEY SHARE;
      IF NOT FOUND THEN
        RAISE EXCEPTION 'Worker payout account is not active' USING ERRCODE = '55000';
      END IF;
    END IF;
    RETURN QUERY SELECT p_job_id, v_status, v_settlement_transaction_id, v_operation_id,
      v_payout_cents, v_currency, v_worker_id, v_external_account_id, v_operation_status = 'CREATED';
    RETURN;
  END IF;

  IF v_status <> 'SUBMITTED' OR v_escrow_status <> 'HELD' THEN
    RAISE EXCEPTION 'Job is not ready for financial approval' USING ERRCODE = '55000';
  END IF;
  v_payout_cents := v_budget_cents - v_fee_cents;
  IF v_fee_cents < 0 OR v_fee_cents >= v_budget_cents OR v_payout_cents <= 0 THEN
    RAISE EXCEPTION 'Job payout must be positive after fees' USING ERRCODE = '23514';
  END IF;
  IF p_provider = 'STRIPE' THEN
    SELECT account.external_account_id INTO v_external_account_id
    FROM public.payment_recipient_accounts AS account
    WHERE account.worker_id = v_worker_id AND account.provider = 'STRIPE' AND account.is_active = TRUE
    FOR KEY SHARE;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'Worker payout account is not active' USING ERRCODE = '55000';
    END IF;
  END IF;

  v_settlement_entries := jsonb_build_array(
    jsonb_build_object('account_kind', 'CLIENT_ESCROW', 'owner_user_id', p_client_id, 'amount_cents', v_budget_cents, 'transaction_type', 'ESCROW_RELEASE'),
    jsonb_build_object('account_kind', 'WORKER_PAYABLE', 'owner_user_id', v_worker_id, 'amount_cents', -v_payout_cents, 'transaction_type', 'WORKER_PAYOUT')
  );
  IF v_fee_cents > 0 THEN
    v_settlement_entries := v_settlement_entries || jsonb_build_array(
      jsonb_build_object('account_kind', 'PLATFORM_REVENUE', 'amount_cents', -v_fee_cents, 'transaction_type', 'PLATFORM_FEE')
    );
  END IF;
  v_settlement_transaction_id := public.post_ledger_transaction(
    p_job_id, 'COMPLETED', v_currency, p_idempotency_key || ':settlement', p_idempotency_fingerprint,
    'Escrow released after client approval', jsonb_build_object('provider', p_provider), v_settlement_entries
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
  ) RETURNING id, status INTO v_operation_id, v_operation_status;
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

CREATE OR REPLACE FUNCTION get_payment_operation_state(p_operation_id UUID)
RETURNS TABLE (
  status payment_operation_status,
  provider_reference VARCHAR
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public, pg_temp
AS $$
BEGIN
  RETURN QUERY
  SELECT po.status, po.provider_reference
  FROM public.payment_operations AS po
  WHERE po.id = p_operation_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Payment operation not found' USING ERRCODE = 'P0002';
  END IF;
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
#variable_conflict use_column
DECLARE
  v_event_id UUID;
  v_operation_id UUID;
  v_operation_type payment_operation_type;
  v_status payment_operation_status;
  v_ledger_transaction_id UUID;
  v_job_id UUID;
  v_ledger_status transaction_status;
  v_payload_operation_id UUID;
  v_job_status job_status;
  v_escrow_status escrow_status;
  v_client_id UUID;
  v_client_active BOOLEAN := FALSE;
BEGIN
  IF p_provider NOT IN ('STUB', 'STRIPE')
    OR p_provider_event_id IS NULL OR length(btrim(p_provider_event_id)) = 0
    OR p_provider_reference IS NULL OR length(btrim(p_provider_reference)) = 0
    OR p_outcome NOT IN ('SUCCEEDED', 'FAILED') THEN
    RAISE EXCEPTION 'Payment webhook is invalid' USING ERRCODE = '22023';
  END IF;
  v_ledger_status := CASE WHEN p_outcome = 'SUCCEEDED' THEN 'COMPLETED'::transaction_status ELSE 'FAILED'::transaction_status END;

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

  SELECT po.id, po.operation_type, po.status, po.ledger_transaction_id, po.job_id
  INTO v_operation_id, v_operation_type, v_status, v_ledger_transaction_id, v_job_id
  FROM public.payment_operations AS po
  WHERE po.provider = p_provider AND po.provider_reference = p_provider_reference
  FOR UPDATE;
  IF NOT FOUND THEN
    BEGIN
      v_payload_operation_id := NULLIF(p_payload #>> '{data,object,metadata,networkpeer_operation_id}', '')::uuid;
    EXCEPTION WHEN invalid_text_representation THEN
      RAISE EXCEPTION 'Payment webhook operation metadata is invalid' USING ERRCODE = '22023';
    END;
    IF v_payload_operation_id IS NULL THEN
      RAISE EXCEPTION 'Payment operation not found' USING ERRCODE = 'P0002';
    END IF;
    SELECT po.id, po.operation_type, po.status, po.ledger_transaction_id, po.job_id
    INTO v_operation_id, v_operation_type, v_status, v_ledger_transaction_id, v_job_id
    FROM public.payment_operations AS po
    WHERE po.id = v_payload_operation_id
      AND po.provider = p_provider
      AND po.provider_reference IS NULL
      AND po.status IN ('CREATED', 'PENDING')
    FOR UPDATE;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'Payment operation not found' USING ERRCODE = 'P0002';
    END IF;
    UPDATE public.payment_operations AS po
    SET provider_reference = p_provider_reference,
        status = CASE WHEN po.status = 'CREATED' THEN 'PENDING' ELSE po.status END,
        dispatch_attempts = CASE WHEN po.status = 'CREATED' THEN po.dispatch_attempts + 1 ELSE po.dispatch_attempts END,
        last_dispatch_error = NULL
    WHERE po.id = v_operation_id;
    IF v_status = 'CREATED' THEN v_status := 'PENDING'; END IF;
  END IF;
  UPDATE public.payment_webhook_events
  SET payment_operation_id = v_operation_id, processed_at = NOW()
  WHERE id = v_event_id;
  IF v_status IN ('SUCCEEDED', 'FAILED', 'CANCELLED') THEN
    RETURN QUERY SELECT v_operation_id, v_operation_type, v_status, FALSE;
    RETURN;
  END IF;

  IF v_operation_type = 'FUNDING' THEN
    SELECT j.client_id, j.status, j.escrow_status
    INTO v_client_id, v_job_status, v_escrow_status
    FROM public.jobs AS j
    WHERE j.id = v_job_id
    FOR UPDATE;
    IF NOT FOUND THEN RAISE EXCEPTION 'Funding job not found' USING ERRCODE = 'P0002'; END IF;
    SELECT u.is_active INTO v_client_active
    FROM public.users AS u
    WHERE u.id = v_client_id AND u.role = 'CLIENT'
    FOR KEY SHARE;
    v_client_active := COALESCE(v_client_active, FALSE);
  END IF;

  UPDATE public.ledger_transactions
  SET transaction_status = v_ledger_status, processed_at = NOW()
  WHERE id = v_ledger_transaction_id;
  UPDATE public.wallet_ledger
  SET transaction_status = v_ledger_status, processed_at = NOW()
  WHERE ledger_transaction_id = v_ledger_transaction_id;
  UPDATE public.payment_operations
  SET status = p_outcome, processed_at = NOW()
  WHERE id = v_operation_id;

  IF v_operation_type = 'FUNDING' AND p_outcome = 'SUCCEEDED' THEN
    IF v_job_status = 'FUNDING' AND v_escrow_status = 'PENDING' AND v_client_active THEN
      UPDATE public.jobs
      SET status = 'POSTED', escrow_status = 'HELD', funded_at = NOW(),
          escrow_ledger_transaction_id = v_ledger_transaction_id, updated_at = NOW()
      WHERE id = v_job_id;
    ELSIF v_job_status = 'FUNDING' THEN
      UPDATE public.jobs
      SET escrow_status = 'FROZEN', funded_at = NOW(),
          escrow_ledger_transaction_id = v_ledger_transaction_id, updated_at = NOW()
      WHERE id = v_job_id;
    END IF;
  ELSIF v_operation_type = 'FUNDING' AND p_outcome = 'FAILED' THEN
    UPDATE public.jobs
    SET escrow_status = 'UNFUNDED', updated_at = NOW()
    WHERE id = v_job_id AND status = 'FUNDING' AND escrow_status = 'PENDING';
  END IF;
  RETURN QUERY SELECT v_operation_id, v_operation_type, p_outcome, FALSE;
END;
$$;

CREATE OR REPLACE FUNCTION enforce_ledger_account_immutability()
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
    RAISE EXCEPTION 'Ledger accounts are immutable' USING ERRCODE = '55000';
  END IF;
  IF NEW.id IS DISTINCT FROM OLD.id
    OR NEW.owner_user_id IS DISTINCT FROM OLD.owner_user_id
    OR NEW.account_kind IS DISTINCT FROM OLD.account_kind
    OR NEW.currency IS DISTINCT FROM OLD.currency
    OR NEW.created_at IS DISTINCT FROM OLD.created_at THEN
    RAISE EXCEPTION 'Ledger account fields are immutable' USING ERRCODE = '55000';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS enforce_ledger_account_immutability ON public.ledger_accounts;
CREATE TRIGGER enforce_ledger_account_immutability
  BEFORE UPDATE OR DELETE ON public.ledger_accounts
  FOR EACH ROW EXECUTE FUNCTION enforce_ledger_account_immutability();

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
  SELECT COUNT(*), COUNT(DISTINCT posting.ledger_account_id), COALESCE(SUM(posting.amount_cents), 0), COUNT(DISTINCT posting.currency)
  INTO v_entry_count, v_account_count, v_sum, v_currency_count
  FROM public.wallet_ledger AS posting
  WHERE posting.ledger_transaction_id = v_transaction_id;
  IF v_entry_count < 2 OR v_account_count < 2 OR v_sum <> 0 OR v_currency_count <> 1 THEN
    RAISE EXCEPTION 'Ledger transaction % is not balanced', v_transaction_id USING ERRCODE = '23514';
  END IF;
  IF EXISTS (
    SELECT 1
    FROM public.wallet_ledger AS posting
    JOIN public.ledger_transactions AS txn ON txn.id = posting.ledger_transaction_id
    LEFT JOIN public.ledger_accounts AS account ON account.id = posting.ledger_account_id
    WHERE posting.ledger_transaction_id = v_transaction_id
      AND (
        posting.currency <> txn.currency
        OR posting.transaction_status <> txn.transaction_status
        OR account.id IS NULL
        OR account.currency <> posting.currency
        OR account.owner_user_id IS DISTINCT FROM posting.user_id
      )
  ) THEN
    RAISE EXCEPTION 'Ledger transaction posting metadata is inconsistent' USING ERRCODE = '23514';
  END IF;
  RETURN NULL;
END;
$$;

REVOKE EXECUTE ON FUNCTION get_payment_operation_state(UUID) FROM PUBLIC;
