-- A funded job that is frozen before assignment has no worker, but must still
-- be representable as DISPUTED until an audited refund/dispute resolution.
ALTER TABLE public.jobs
  DROP CONSTRAINT jobs_active_lifecycle_requires_worker;

ALTER TABLE public.jobs
  ADD CONSTRAINT jobs_active_lifecycle_requires_worker
  CHECK (
    status NOT IN ('ASSIGNED', 'EN_ROUTE', 'AT_LOCATION', 'IN_PROGRESS', 'SUBMITTED', 'APPROVED', 'COMPLETED')
    OR worker_id IS NOT NULL
  );
