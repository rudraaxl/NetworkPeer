ALTER FUNCTION approve_client_job_with_settlement(UUID, UUID, VARCHAR, VARCHAR, CHAR(64))
  SET plpgsql.variable_conflict = 'use_column';
