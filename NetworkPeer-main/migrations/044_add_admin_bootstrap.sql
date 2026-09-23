-- Migration 044: Supported path for creating an administrator (NP-12)
--
-- Until now the only way to obtain an ADMIN principal was the "demo-" bearer
-- token backdoor removed in this same change: the email OTP flow only accepts
-- CLIENT and WORKER, and no endpoint can change a role. This migration adds the
-- one supported, auditable path -- an explicit out-of-band grant against a
-- named, already-verified account.

CREATE TABLE IF NOT EXISTS public.admin_bootstrap_grants (
  id BIGSERIAL PRIMARY KEY,
  user_id UUID NOT NULL REFERENCES public.users(id) ON DELETE RESTRICT,
  email VARCHAR(255) NOT NULL,
  previous_role user_role NOT NULL,
  granted_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  granted_by VARCHAR(255) NOT NULL CHECK (length(btrim(granted_by)) > 0)
);

CREATE INDEX IF NOT EXISTS idx_admin_bootstrap_grants_user
  ON public.admin_bootstrap_grants(user_id);

-- Promotes an existing, active, verified user to ADMIN and records the grant.
--
-- Idempotent: calling it for an account that is already ADMIN succeeds without
-- writing a second grant row. It deliberately will NOT create a user -- the
-- account must first exist through the normal login flow, so the address is
-- known to be controlled by whoever is being promoted.
CREATE OR REPLACE FUNCTION public.grant_admin_by_email(
  p_email   VARCHAR(255),
  p_granted_by VARCHAR(255)
) RETURNS UUID
LANGUAGE plpgsql
AS $$
DECLARE
  v_user   public.users%ROWTYPE;
BEGIN
  IF p_email IS NULL OR length(btrim(p_email)) = 0 THEN
    RAISE EXCEPTION 'grant_admin_by_email requires an email address';
  END IF;
  IF p_granted_by IS NULL OR length(btrim(p_granted_by)) = 0 THEN
    RAISE EXCEPTION 'grant_admin_by_email requires a granted_by attribution';
  END IF;

  SELECT * INTO v_user
  FROM public.users
  WHERE lower(email) = lower(btrim(p_email))
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'No user exists with email %. Sign in once through the normal flow first.', p_email
      USING ERRCODE = 'no_data_found';
  END IF;

  IF NOT v_user.is_active THEN
    RAISE EXCEPTION 'User % is deactivated and cannot be promoted', p_email;
  END IF;

  IF NOT v_user.is_verified THEN
    RAISE EXCEPTION 'User % is not verified and cannot be promoted', p_email;
  END IF;

  IF v_user.role = 'ADMIN' THEN
    RETURN v_user.id;
  END IF;

  INSERT INTO public.admin_bootstrap_grants (user_id, email, previous_role, granted_by)
  VALUES (v_user.id, v_user.email, v_user.role, btrim(p_granted_by));

  UPDATE public.users
  SET role = 'ADMIN', updated_at = NOW()
  WHERE id = v_user.id;

  RETURN v_user.id;
END;
$$;
