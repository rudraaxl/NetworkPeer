-- @nontransactional
-- A concurrent build avoids blocking job writes while the partial GiST index is
-- created on an occupied production table.
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_jobs_posted_geography
  ON jobs USING GIST ((location::geography))
  WHERE status = 'POSTED' AND worker_id IS NULL;
