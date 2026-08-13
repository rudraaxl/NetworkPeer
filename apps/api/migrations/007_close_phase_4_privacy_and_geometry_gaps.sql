-- Public worker discovery must never inherit client-provided private fields.
ALTER TABLE jobs
  ADD COLUMN public_title VARCHAR(255) NOT NULL DEFAULT 'Field work opportunity',
  ADD COLUMN public_description TEXT NOT NULL DEFAULT '';

ALTER TABLE jobs
  ADD CONSTRAINT jobs_public_title_not_blank CHECK (length(trim(public_title)) > 0) NOT VALID,
  ADD CONSTRAINT jobs_public_description_length CHECK (length(public_description) <= 2000) NOT VALID,
  ADD CONSTRAINT jobs_location_not_empty CHECK (NOT ST_IsEmpty(location)) NOT VALID;

ALTER TABLE worker_profiles
  ADD CONSTRAINT worker_profiles_location_not_empty
  CHECK (current_location IS NULL OR NOT ST_IsEmpty(current_location)) NOT VALID;
