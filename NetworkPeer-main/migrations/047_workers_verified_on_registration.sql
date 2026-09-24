-- Migration 047: workers are verified when they register.
--
-- worker_profiles.verification_status has defaulted to 'PENDING' since
-- migration 002, and nothing in the registration path overrides it. Moving a
-- worker to 'VERIFIED' needed an ADMIN calling
-- PATCH /admin/workers/:workerId/verification, and the only supported way to
-- obtain an ADMIN principal is the out-of-band grant added in migration 044.
--
-- No such account has been created, so in practice every worker who has ever
-- registered was stuck: GET /worker/sync rejects an unverified worker with
-- WORKER_NOT_VERIFIED, and the nearby-jobs query requires 'VERIFIED' before it
-- will resolve a location. A new worker saw an empty app and no explanation.
--
-- This removes that gate rather than staffing it.
--
-- WHAT THIS GIVES UP: verification was the only checkpoint between "can
-- receive email" and "can accept a job holding a client's escrowed money".
-- Nothing now vets a worker before they take paid work. Today that is
-- contained by SES being in sandbox, where mail only reaches addresses that
-- have been verified by hand -- but that containment disappears the moment
-- production access is granted. A real approval step should exist before this
-- platform handles money for people outside the team; it just should not be
-- the thing blocking development while there is no admin to operate it.

BEGIN;

-- New registrations.
ALTER TABLE public.worker_profiles
  ALTER COLUMN verification_status SET DEFAULT 'VERIFIED';

-- Workers already stuck behind the gate. Deliberately limited to PENDING:
-- a profile that was explicitly REJECTED or SUSPENDED stays that way, because
-- that decision was made on purpose and this migration is not reversing it.
UPDATE public.worker_profiles
SET verification_status = 'VERIFIED'
WHERE verification_status = 'PENDING';

COMMIT;
