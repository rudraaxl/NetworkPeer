-- Phase 6 stores every user-visible change in a durable per-user outbox. REST
-- sync recovers missed realtime events; PostgreSQL NOTIFY only accelerates live
-- delivery after the transaction commits.
CREATE TABLE sync_events (
  id BIGSERIAL PRIMARY KEY,
  event_id UUID NOT NULL DEFAULT uuid_generate_v4() UNIQUE,
  recipient_user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  topic VARCHAR(64) NOT NULL CHECK (
    topic IN (
      'JOB_CREATED',
      'JOB_ASSIGNED',
      'JOB_STATUS_CHANGED',
      'JOB_CANCELLED',
      'EVIDENCE_UPLOADED',
      'SYSTEM'
    )
  ),
  entity_type VARCHAR(64) NOT NULL CHECK (length(btrim(entity_type)) > 0),
  entity_id UUID,
  payload JSONB NOT NULL DEFAULT '{}'::jsonb,
  push_state VARCHAR(16) NOT NULL DEFAULT 'PENDING' CHECK (push_state IN ('PENDING', 'PROCESSING', 'SENT', 'SKIPPED')),
  push_attempts INTEGER NOT NULL DEFAULT 0 CHECK (push_attempts >= 0),
  push_claimed_at TIMESTAMPTZ,
  push_sent_at TIMESTAMPTZ,
  push_last_error TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_sync_events_recipient_cursor
  ON sync_events (recipient_user_id, id ASC);
CREATE INDEX idx_sync_events_push_pending
  ON sync_events (created_at ASC)
  WHERE push_state = 'PENDING';

CREATE TABLE notifications (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  sync_event_id BIGINT NOT NULL UNIQUE REFERENCES sync_events(id) ON DELETE CASCADE,
  topic VARCHAR(64) NOT NULL,
  title VARCHAR(255) NOT NULL CHECK (length(btrim(title)) > 0),
  body TEXT NOT NULL CHECK (length(btrim(body)) > 0),
  data JSONB NOT NULL DEFAULT '{}'::jsonb,
  read_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_notifications_user_created
  ON notifications (user_id, created_at DESC);
CREATE INDEX idx_notifications_user_unread
  ON notifications (user_id, created_at DESC)
  WHERE read_at IS NULL;

CREATE TABLE device_push_tokens (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  token TEXT NOT NULL UNIQUE CHECK (length(btrim(token)) BETWEEN 16 AND 4096),
  platform VARCHAR(16) NOT NULL CHECK (platform IN ('WEB', 'IOS', 'ANDROID')),
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  last_seen_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_device_push_tokens_user_active
  ON device_push_tokens (user_id)
  WHERE is_active = TRUE;

CREATE TRIGGER update_device_push_tokens_updated_at
  BEFORE UPDATE ON device_push_tokens
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE OR REPLACE FUNCTION emit_user_sync_event(
  p_recipient_user_id UUID,
  p_topic VARCHAR,
  p_entity_type VARCHAR,
  p_entity_id UUID,
  p_payload JSONB,
  p_title VARCHAR,
  p_body TEXT,
  p_send_push BOOLEAN DEFAULT TRUE
)
RETURNS BIGINT
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public, pg_temp
AS $$
DECLARE
  v_sync_event_id BIGINT;
BEGIN
  INSERT INTO public.sync_events (
    recipient_user_id,
    topic,
    entity_type,
    entity_id,
    payload,
    push_state
  )
  VALUES (
    p_recipient_user_id,
    p_topic,
    p_entity_type,
    p_entity_id,
    COALESCE(p_payload, '{}'::jsonb),
    CASE WHEN p_send_push THEN 'PENDING' ELSE 'SKIPPED' END
  )
  RETURNING id INTO v_sync_event_id;

  INSERT INTO public.notifications (user_id, sync_event_id, topic, title, body, data)
  VALUES (
    p_recipient_user_id,
    v_sync_event_id,
    p_topic,
    p_title,
    p_body,
    COALESCE(p_payload, '{}'::jsonb)
  );

  PERFORM pg_notify('networkpeer_sync', v_sync_event_id::text);
  RETURN v_sync_event_id;
END;
$$;

CREATE OR REPLACE FUNCTION emit_job_sync_events()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public, pg_temp
AS $$
DECLARE
  v_topic VARCHAR(64);
  v_client_title VARCHAR(255);
  v_client_body TEXT;
  v_worker_title VARCHAR(255);
  v_worker_body TEXT;
  v_payload JSONB;
BEGIN
  IF TG_OP = 'INSERT' THEN
    PERFORM public.emit_user_sync_event(
      NEW.client_id,
      'JOB_CREATED',
      'JOB',
      NEW.id,
      jsonb_build_object('job_id', NEW.id, 'status', NEW.status),
      'Job posted',
      'Your job is now visible to verified workers.',
      FALSE
    );
    RETURN NEW;
  END IF;

  IF NEW.status IS NOT DISTINCT FROM OLD.status THEN
    RETURN NEW;
  END IF;

  v_topic := CASE
    WHEN NEW.status = 'ASSIGNED' THEN 'JOB_ASSIGNED'
    WHEN NEW.status = 'CANCELLED' THEN 'JOB_CANCELLED'
    ELSE 'JOB_STATUS_CHANGED'
  END;
  v_payload := jsonb_build_object('job_id', NEW.id, 'status', NEW.status);
  v_client_title := CASE
    WHEN NEW.status = 'ASSIGNED' THEN 'Worker assigned'
    WHEN NEW.status = 'SUBMITTED' THEN 'Evidence submitted'
    WHEN NEW.status = 'CANCELLED' THEN 'Job cancelled'
    ELSE 'Job status updated'
  END;
  v_client_body := CASE
    WHEN NEW.status = 'ASSIGNED' THEN 'A verified worker has accepted your job.'
    WHEN NEW.status = 'SUBMITTED' THEN 'The worker submitted evidence for your review.'
    WHEN NEW.status = 'CANCELLED' THEN 'This job is no longer active.'
    ELSE 'A job you posted has moved to a new stage.'
  END;

  PERFORM public.emit_user_sync_event(
    NEW.client_id,
    v_topic,
    'JOB',
    NEW.id,
    v_payload,
    v_client_title,
    v_client_body,
    NEW.status <> 'POSTED'
  );

  IF NEW.worker_id IS NOT NULL THEN
    v_worker_title := CASE
      WHEN NEW.status = 'ASSIGNED' THEN 'Job accepted'
      WHEN NEW.status = 'CANCELLED' THEN 'Job cancelled'
      ELSE 'Work status updated'
    END;
    v_worker_body := CASE
      WHEN NEW.status = 'ASSIGNED' THEN 'You are assigned to this job. Work details are now available.'
      WHEN NEW.status = 'CANCELLED' THEN 'This assigned job has been cancelled.'
      ELSE 'Your assigned work has moved to a new stage.'
    END;
    PERFORM public.emit_user_sync_event(
      NEW.worker_id,
      v_topic,
      'JOB',
      NEW.id,
      v_payload,
      v_worker_title,
      v_worker_body,
      NEW.status <> 'POSTED'
    );
  END IF;

  RETURN NEW;
END;
$$;

CREATE TRIGGER emit_job_sync_events
  AFTER INSERT OR UPDATE OF status ON jobs
  FOR EACH ROW EXECUTE FUNCTION emit_job_sync_events();

CREATE OR REPLACE FUNCTION emit_media_sync_events()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public, pg_temp
AS $$
DECLARE
  v_client_id UUID;
BEGIN
  IF NEW.status = OLD.status OR NEW.status <> 'UPLOADED' THEN
    RETURN NEW;
  END IF;

  SELECT client_id
  INTO v_client_id
  FROM public.jobs
  WHERE id = NEW.job_id;

  IF v_client_id IS NOT NULL THEN
    PERFORM public.emit_user_sync_event(
      v_client_id,
      'EVIDENCE_UPLOADED',
      'JOB_SUBTASK_MEDIA',
      NEW.id,
      jsonb_build_object('job_id', NEW.job_id, 'subtask_id', NEW.subtask_id, 'media_id', NEW.id),
      'Evidence uploaded',
      'New evidence is ready for your review.',
      TRUE
    );
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER emit_media_sync_events
  AFTER UPDATE OF status ON job_subtask_media
  FOR EACH ROW EXECUTE FUNCTION emit_media_sync_events();

REVOKE EXECUTE ON FUNCTION emit_user_sync_event(UUID, VARCHAR, VARCHAR, UUID, JSONB, VARCHAR, TEXT, BOOLEAN) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION emit_job_sync_events() FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION emit_media_sync_events() FROM PUBLIC;

COMMENT ON TABLE sync_events IS
  'Durable per-user outbox used by cursor sync, Socket.IO fanout, and optional FCM delivery.';
