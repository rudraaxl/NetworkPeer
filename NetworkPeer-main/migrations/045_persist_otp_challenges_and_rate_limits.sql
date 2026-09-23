-- Migration 045: Durable OTP challenges and rate limits (NP-08, NP-09, NP-10)
--
-- The email OTP flow kept challenges and rate-limit counters in two in-process
-- Maps. With more than one API task, a code issued by one task was unknown to
-- the other, so login failed roughly (1 - 1/N) of the time; a restart dropped
-- every in-flight login; and the rate limiter reset on every deploy, so the
-- lockout protecting the OTP endpoint could be cleared by anyone able to cause
-- a restart. Migration 041 already created email_otp_challenges -- the code
-- simply never used it. These columns complete it.

ALTER TABLE public.email_otp_challenges
  ADD COLUMN IF NOT EXISTS challenge_ref VARCHAR(40),
  ADD COLUMN IF NOT EXISTS role user_role NOT NULL DEFAULT 'CLIENT',
  ADD COLUMN IF NOT EXISTS requested_ip VARCHAR(64);

-- The public identifier handed to clients ("chn_<32 hex>"). Kept distinct from
-- the primary key so the surrogate key never leaks.
UPDATE public.email_otp_challenges
SET challenge_ref = 'chn_' || replace(id::text, '-', '')
WHERE challenge_ref IS NULL;

ALTER TABLE public.email_otp_challenges
  ALTER COLUMN challenge_ref SET NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS idx_email_otp_challenges_ref
  ON public.email_otp_challenges(challenge_ref);

-- Durable, atomic rate limiting. One row per (scope, subject) window.
CREATE TABLE IF NOT EXISTS public.auth_rate_limits (
  scope       VARCHAR(32)  NOT NULL,
  subject     VARCHAR(255) NOT NULL,
  count       INTEGER      NOT NULL DEFAULT 0,
  window_ends TIMESTAMPTZ  NOT NULL,
  PRIMARY KEY (scope, subject)
);

CREATE INDEX IF NOT EXISTS idx_auth_rate_limits_window
  ON public.auth_rate_limits(window_ends);

/**
 * Consumes one unit of rate-limit budget. Returns TRUE when the caller is
 * within budget. The upsert is atomic, so concurrent API tasks cannot both
 * observe the last remaining slot.
 */
CREATE OR REPLACE FUNCTION public.consume_auth_rate_limit(
  p_scope      VARCHAR(32),
  p_subject    VARCHAR(255),
  p_max_count  INTEGER,
  p_window_seconds INTEGER
) RETURNS BOOLEAN
LANGUAGE plpgsql
AS $$
DECLARE
  v_count INTEGER;
BEGIN
  INSERT INTO public.auth_rate_limits (scope, subject, count, window_ends)
  VALUES (p_scope, p_subject, 1, NOW() + make_interval(secs => p_window_seconds))
  ON CONFLICT (scope, subject) DO UPDATE
    SET count = CASE
          WHEN public.auth_rate_limits.window_ends <= NOW() THEN 1
          ELSE public.auth_rate_limits.count + 1
        END,
        window_ends = CASE
          WHEN public.auth_rate_limits.window_ends <= NOW()
            THEN NOW() + make_interval(secs => p_window_seconds)
          ELSE public.auth_rate_limits.window_ends
        END
  RETURNING count INTO v_count;

  RETURN v_count <= p_max_count;
END;
$$;

/**
 * Records a verification attempt against a challenge and reports the outcome in
 * one atomic step, so parallel guesses cannot race past the attempt ceiling.
 * Verification itself stays in the application layer -- the hash never needs to
 * travel to the database for comparison.
 */
CREATE OR REPLACE FUNCTION public.register_otp_attempt(
  p_challenge_ref VARCHAR(40),
  p_max_attempts  INTEGER
) RETURNS TABLE (outcome TEXT, code_hash VARCHAR(255), email VARCHAR(255), user_role user_role)
LANGUAGE plpgsql
AS $$
DECLARE
  v_row public.email_otp_challenges%ROWTYPE;
BEGIN
  SELECT * INTO v_row
  FROM public.email_otp_challenges
  WHERE challenge_ref = p_challenge_ref
  FOR UPDATE;

  IF NOT FOUND THEN
    RETURN QUERY SELECT 'NOT_FOUND'::TEXT, NULL::VARCHAR(255), NULL::VARCHAR(255), NULL::user_role;
    RETURN;
  END IF;

  IF v_row.consumed_at IS NOT NULL THEN
    RETURN QUERY SELECT 'ALREADY_USED'::TEXT, NULL::VARCHAR(255), v_row.email, v_row.role;
    RETURN;
  END IF;

  IF v_row.expires_at <= NOW() THEN
    RETURN QUERY SELECT 'EXPIRED'::TEXT, NULL::VARCHAR(255), v_row.email, v_row.role;
    RETURN;
  END IF;

  IF v_row.attempts >= p_max_attempts THEN
    RETURN QUERY SELECT 'LOCKED'::TEXT, NULL::VARCHAR(255), v_row.email, v_row.role;
    RETURN;
  END IF;

  UPDATE public.email_otp_challenges
  SET attempts = attempts + 1
  WHERE id = v_row.id;

  RETURN QUERY SELECT 'OK'::TEXT, v_row.code_hash, v_row.email, v_row.role;
END;
$$;

-- Marks a challenge consumed. Returns FALSE if another request consumed it
-- first, which makes single-use enforcement a database guarantee.
CREATE OR REPLACE FUNCTION public.consume_otp_challenge(
  p_challenge_ref VARCHAR(40)
) RETURNS BOOLEAN
LANGUAGE plpgsql
AS $$
DECLARE
  v_updated INTEGER;
BEGIN
  UPDATE public.email_otp_challenges
  SET consumed_at = NOW()
  WHERE challenge_ref = p_challenge_ref
    AND consumed_at IS NULL
    AND expires_at > NOW();
  GET DIAGNOSTICS v_updated = ROW_COUNT;
  RETURN v_updated = 1;
END;
$$;
