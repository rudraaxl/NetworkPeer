ALTER TABLE worker_profiles
  VALIDATE CONSTRAINT worker_profiles_verification_status_check;

ALTER TABLE worker_profiles
  VALIDATE CONSTRAINT worker_profiles_only_verified_available;

ALTER TABLE jobs
  VALIDATE CONSTRAINT jobs_location_wgs84_bounds;

ALTER TABLE worker_profiles
  VALIDATE CONSTRAINT worker_profiles_location_wgs84_bounds;

ALTER TABLE jobs
  VALIDATE CONSTRAINT jobs_public_title_not_blank;

ALTER TABLE jobs
  VALIDATE CONSTRAINT jobs_public_description_length;

ALTER TABLE jobs
  VALIDATE CONSTRAINT jobs_location_not_empty;

ALTER TABLE worker_profiles
  VALIDATE CONSTRAINT worker_profiles_location_not_empty;
