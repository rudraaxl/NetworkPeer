-- Migration 052: every job gets somewhere to put evidence, whether or not the
-- client wrote a checklist.
--
-- THE PROBLEM. job_subtask_media.subtask_id is NOT NULL REFERENCES
-- job_subtasks(id), and reserve_media_upload joins through it:
--
--   JOIN job_subtasks s ON s.id = $2 AND s.job_id = j.id
--
-- so a photograph cannot exist without a subtask to hang it on. Subtasks can
-- only be created when the job is created -- the client-jobs route is the only
-- caller that supplies them and there is no endpoint to add one later -- and the
-- field is optional, defaulting to an empty array in JobService.create. A client
-- who does not spell out a checklist therefore produces a job with zero rows in
-- job_subtasks, and the worker's task screen renders `items(task.subtasks)`,
-- which is nothing at all: no capture button, no way to upload, no way to be
-- paid. Since 051 made evidence a precondition of submission, such a job is now
-- a dead end rather than a silent empty payout.
--
-- THE FIX. create_client_job substitutes one catch-all subtask when it is handed
-- an empty list. Doing it here rather than in JobService means it holds for every
-- caller, it is atomic with the job insert, and the idempotency fingerprint the
-- service computes over its own normalised input is unaffected -- the fingerprint
-- covers what the client asked for, which has not changed.
--
-- The substitute is REQUIRED, which is what makes "no job submits with no
-- evidence" a rule the worker can actually satisfy rather than one that strands
-- them: 051 refuses a submission with no evidence, and this gives them the place
-- to put it. It is marked in metadata so it can be told apart from a checklist
-- item the client actually wrote.
--
-- ON N PHOTOS. There is no per-subtask limit anywhere -- not in this function,
-- not in reserve_media_upload, not in the schema -- so one subtask accepts as
-- many photographs as the worker takes. The 50-element cap below applies to the
-- number of CHECKLIST ITEMS a client may define, not to evidence.
--
-- ON THE BACKFILL. Existing jobs with no subtasks are given the same row, but
-- only where a worker could still act on them: FUNDING through IN_PROGRESS.
-- Jobs already SUBMITTED or beyond are left alone -- adding a required subtask
-- to work that has already been handed in would retroactively make it
-- incomplete, and 051's payout guard already refuses to release escrow for a job
-- with no evidence, so nothing is left unprotected by that choice.

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
  v_subtasks JSONB;
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

  -- Validate what the client sent BEFORE substituting, so an actually malformed
  -- checklist still fails rather than being quietly replaced by the default.
  IF jsonb_typeof(COALESCE(p_subtasks, '[]'::jsonb)) <> 'array'
    OR jsonb_array_length(COALESCE(p_subtasks, '[]'::jsonb)) > 50 THEN
    RAISE EXCEPTION 'Job subtasks are invalid' USING ERRCODE = '22023';
  END IF;

  v_subtasks := COALESCE(p_subtasks, '[]'::jsonb);
  IF jsonb_array_length(v_subtasks) = 0 THEN
    v_subtasks := jsonb_build_array(
      jsonb_build_object(
        'title', 'Work evidence',
        'description', 'Photograph the work you completed. Add as many photos as the job needs -- there is no limit.',
        'is_required', 'true',
        'metadata', jsonb_build_object('auto_created', TRUE, 'reason', 'client_specified_no_subtasks')
      )
    );
  END IF;

  FOR v_subtask IN SELECT value FROM jsonb_array_elements(v_subtasks)
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

-- Backfill: give the same catch-all to existing jobs that have no subtask, where
-- a worker could still act on them. Idempotent -- a second run finds no such job.
DO $$
DECLARE
  v_count INTEGER;
BEGIN
  WITH inserted AS (
    INSERT INTO public.job_subtasks (job_id, title, description, sequence_order, is_required, metadata)
    SELECT
      j.id,
      'Work evidence',
      'Photograph the work you completed. Add as many photos as the job needs -- there is no limit.',
      0,
      TRUE,
      jsonb_build_object('auto_created', TRUE, 'reason', 'backfilled_job_had_no_subtasks')
    FROM public.jobs AS j
    WHERE j.status IN ('FUNDING', 'POSTED', 'ASSIGNED', 'EN_ROUTE', 'AT_LOCATION', 'IN_PROGRESS')
      AND NOT EXISTS (SELECT 1 FROM public.job_subtasks AS s WHERE s.job_id = j.id)
    RETURNING 1
  )
  SELECT count(*) INTO v_count FROM inserted;
  RAISE NOTICE '052: added a catch-all evidence subtask to % job(s)', v_count;
END;
$$;
