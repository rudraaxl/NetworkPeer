-- Migration 046: Revocable refresh sessions (NP-11)
--
-- Refresh tokens were self-signed JWTs that the server never recorded. Nothing
-- could revoke one: /auth/logout only called Cognito, which this deployment
-- does not use, so it cleared a cookie and returned success while the token it
-- was handed stayed valid for its full seven days. A stolen refresh token was
-- therefore good until expiry with no way to stop it.
--
-- Each issued token now has a row. Logout revokes it, refresh rotates it, and
-- presenting a token that was already rotated -- the signature of a stolen and
-- replayed token -- revokes every session for that user.

CREATE TABLE IF NOT EXISTS public.refresh_sessions (
  jti          VARCHAR(64)  PRIMARY KEY,
  user_id      UUID         NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  issued_at    TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  expires_at   TIMESTAMPTZ  NOT NULL,
  rotated_to   VARCHAR(64),
  revoked_at   TIMESTAMPTZ,
  revoked_reason VARCHAR(64)
);

CREATE INDEX IF NOT EXISTS idx_refresh_sessions_user ON public.refresh_sessions(user_id);
CREATE INDEX IF NOT EXISTS idx_refresh_sessions_expiry ON public.refresh_sessions(expires_at);

/**
 * Atomically rotates a refresh session.
 *
 * Returns one of:
 *   'OK'       - the presented token was live and is now rotated to p_next_jti
 *   'REUSED'   - already rotated or revoked; every session for the user is
 *                revoked as a precaution and the caller must reject the request
 *   'UNKNOWN'  - no such session (expired and swept, or never issued)
 */
CREATE OR REPLACE FUNCTION public.rotate_refresh_session(
  p_jti        VARCHAR(64),
  p_next_jti   VARCHAR(64),
  p_expires_at TIMESTAMPTZ
) RETURNS TEXT
LANGUAGE plpgsql
AS $$
DECLARE
  v_row public.refresh_sessions%ROWTYPE;
BEGIN
  SELECT * INTO v_row FROM public.refresh_sessions WHERE jti = p_jti FOR UPDATE;

  IF NOT FOUND THEN
    RETURN 'UNKNOWN';
  END IF;

  IF v_row.revoked_at IS NOT NULL OR v_row.rotated_to IS NOT NULL THEN
    -- Replay of a spent token. Assume compromise and end every session.
    UPDATE public.refresh_sessions
    SET revoked_at = NOW(), revoked_reason = 'REUSE_DETECTED'
    WHERE user_id = v_row.user_id AND revoked_at IS NULL;
    RETURN 'REUSED';
  END IF;

  IF v_row.expires_at <= NOW() THEN
    RETURN 'UNKNOWN';
  END IF;

  INSERT INTO public.refresh_sessions (jti, user_id, expires_at)
  VALUES (p_next_jti, v_row.user_id, p_expires_at);

  UPDATE public.refresh_sessions
  SET rotated_to = p_next_jti, revoked_at = NOW(), revoked_reason = 'ROTATED'
  WHERE jti = p_jti;

  RETURN 'OK';
END;
$$;
