-- Remove the admin-approval gate for workers. Workers are auto-verified on
-- registration and existing PENDING workers are promoted. REJECTED and
-- SUSPENDED remain enforced admin sanctions.

ALTER TABLE public.worker_profiles
  ALTER COLUMN verification_status SET DEFAULT 'VERIFIED';

CREATE OR REPLACE FUNCTION register_otp_user(
  p_phone_number VARCHAR,
  p_role user_role,
  p_full_name VARCHAR DEFAULT 'Unnamed user'
)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public, pg_temp
AS $$
DECLARE
  v_user_id UUID;
  v_existing_role user_role;
BEGIN
  IF p_role NOT IN ('CLIENT', 'WORKER')
    OR p_phone_number IS NULL
    OR p_phone_number !~ '^\+[1-9][0-9]{1,14}$'
    OR length(btrim(COALESCE(p_full_name, ''))) = 0 THEN
    RAISE EXCEPTION 'Invalid public registration request' USING ERRCODE = '22023';
  END IF;

  -- A concurrent OTP verification can race a first registration. Lock an
  -- existing account, otherwise retry after a unique-key collision.
  LOOP
    SELECT u.id, u.role
    INTO v_user_id, v_existing_role
    FROM public.users AS u
    WHERE u.phone_number = p_phone_number
    FOR UPDATE;

    IF FOUND THEN
      IF v_existing_role <> p_role THEN
        RAISE EXCEPTION 'The requested role does not match this account' USING ERRCODE = '42501';
      END IF;
      RETURN v_user_id;
    END IF;

    BEGIN
      INSERT INTO public.users (phone_number, full_name, role, is_verified)
      VALUES (p_phone_number, btrim(p_full_name), p_role, TRUE)
      RETURNING id INTO v_user_id;

      IF p_role = 'WORKER' THEN
        INSERT INTO public.worker_profiles (user_id, is_available, verification_status)
        VALUES (v_user_id, TRUE, 'VERIFIED');
      END IF;
      RETURN v_user_id;
    EXCEPTION WHEN unique_violation THEN
      -- Another transaction created the phone number; inspect it on the next
      -- iteration rather than trusting the role supplied by this request.
    END;
  END LOOP;
END;
$$;

-- Promote existing PENDING workers to VERIFIED and available so they can work
-- immediately. REJECTED and SUSPENDED are admin sanctions and stay untouched.
UPDATE public.worker_profiles
SET verification_status = 'VERIFIED',
    is_available = TRUE,
    updated_at = NOW()
WHERE verification_status = 'PENDING';
