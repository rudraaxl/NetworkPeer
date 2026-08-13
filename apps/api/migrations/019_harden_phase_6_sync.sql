-- Phase 6 hardening: per-recipient event allocation is serialized so the
-- existing BIGSERIAL cursor is commit ordered for every recipient. Add explicit
-- domain deltas for ledger and notification read state without fabricating inbox
-- notifications for those background changes.

ALTER TABLE sync_events DROP CONSTRAINT sync_events_topic_check;
ALTER TABLE sync_events
  ADD CONSTRAINT sync_events_topic_check
  CHECK (
    topic IN (
      'JOB_CREATED',
      'JOB_ASSIGNED',
      'JOB_STATUS_CHANGED',
      'JOB_CANCELLED',
      'JOB_REASSIGNED',
      'EVIDENCE_UPLOADED',
      'LEDGER_POSTED',
      'NOTIFICATION_READ',
      'SYSTEM'
    )
  );

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
  -- Sequence values are normally assigned before commit. Serializing all event
  -- inserts for this recipient makes se.id a safe per-user replay cursor.
  PERFORM pg_advisory_xact_lock(hashtextextended(p_recipient_user_id::text, 73));

  INSERT INTO public.sync_events (
    recipient_user_id, topic, entity_type, entity_id, payload, push_state
  ) VALUES (
    p_recipient_user_id,
    p_topic,
    p_entity_type,
    p_entity_id,
    COALESCE(p_payload, '{}'::jsonb),
    CASE WHEN p_send_push THEN 'PENDING' ELSE 'SKIPPED' END
  ) RETURNING id INTO v_sync_event_id;

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

CREATE OR REPLACE FUNCTION emit_user_sync_delta(
  p_recipient_user_id UUID,
  p_topic VARCHAR,
  p_entity_type VARCHAR,
  p_entity_id UUID,
  p_payload JSONB
)
RETURNS BIGINT
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public, pg_temp
AS $$
DECLARE
  v_sync_event_id BIGINT;
BEGIN
  PERFORM pg_advisory_xact_lock(hashtextextended(p_recipient_user_id::text, 73));
  INSERT INTO public.sync_events (
    recipient_user_id, topic, entity_type, entity_id, payload, push_state
  ) VALUES (
    p_recipient_user_id,
    p_topic,
    p_entity_type,
    p_entity_id,
    COALESCE(p_payload, '{}'::jsonb),
    'SKIPPED'
  ) RETURNING id INTO v_sync_event_id;
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
  v_client_topic VARCHAR(64);
  v_worker_topic VARCHAR(64);
  v_client_title VARCHAR(255);
  v_client_body TEXT;
  v_worker_title VARCHAR(255);
  v_worker_body TEXT;
  v_payload JSONB;
  v_reassigned BOOLEAN;
  v_status_changed BOOLEAN;
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

  v_status_changed := NEW.status IS DISTINCT FROM OLD.status;
  v_reassigned := NEW.worker_id IS DISTINCT FROM OLD.worker_id;
  IF NOT v_status_changed AND NOT v_reassigned THEN
    RETURN NEW;
  END IF;

  v_client_topic := CASE
    WHEN NEW.status = 'CANCELLED' THEN 'JOB_CANCELLED'
    WHEN NEW.status = 'ASSIGNED' AND OLD.worker_id IS NULL THEN 'JOB_ASSIGNED'
    WHEN v_reassigned THEN 'JOB_REASSIGNED'
    ELSE 'JOB_STATUS_CHANGED'
  END;
  v_payload := jsonb_build_object(
    'job_id', NEW.id,
    'status', NEW.status,
    'reassigned', v_reassigned
  );
  v_client_title := CASE
    WHEN NEW.status = 'ASSIGNED' AND OLD.worker_id IS NULL THEN 'Worker assigned'
    WHEN NEW.status = 'SUBMITTED' THEN 'Evidence submitted'
    WHEN NEW.status = 'CANCELLED' THEN 'Job cancelled'
    WHEN v_reassigned THEN 'Job reassigned'
    ELSE 'Job status updated'
  END;
  v_client_body := CASE
    WHEN NEW.status = 'ASSIGNED' AND OLD.worker_id IS NULL THEN 'A verified worker has accepted your job.'
    WHEN NEW.status = 'SUBMITTED' THEN 'The worker submitted evidence for your review.'
    WHEN NEW.status = 'CANCELLED' THEN 'This job is no longer active.'
    WHEN v_reassigned THEN 'NetworkPeer reassigned a worker for this job.'
    ELSE 'A job you posted has moved to a new stage.'
  END;
  PERFORM public.emit_user_sync_event(
    NEW.client_id,
    v_client_topic,
    'JOB',
    NEW.id,
    v_payload,
    v_client_title,
    v_client_body,
    NEW.status <> 'POSTED'
  );

  IF v_reassigned AND OLD.worker_id IS NOT NULL THEN
    v_worker_topic := CASE WHEN NEW.status = 'CANCELLED' THEN 'JOB_CANCELLED' ELSE 'JOB_REASSIGNED' END;
    v_worker_title := CASE WHEN NEW.status = 'CANCELLED' THEN 'Job cancelled' ELSE 'Job reassigned' END;
    v_worker_body := CASE
      WHEN NEW.status = 'CANCELLED' THEN 'This assigned job has been cancelled.'
      ELSE 'This job is no longer assigned to you.'
    END;
    PERFORM public.emit_user_sync_event(
      OLD.worker_id,
      v_worker_topic,
      'JOB',
      NEW.id,
      v_payload || jsonb_build_object('removed', TRUE),
      v_worker_title,
      v_worker_body,
      TRUE
    );
  END IF;

  IF NEW.worker_id IS NOT NULL THEN
    v_worker_topic := CASE
      WHEN NEW.status = 'ASSIGNED' AND OLD.worker_id IS NULL THEN 'JOB_ASSIGNED'
      WHEN v_reassigned THEN 'JOB_REASSIGNED'
      WHEN NEW.status = 'CANCELLED' THEN 'JOB_CANCELLED'
      ELSE 'JOB_STATUS_CHANGED'
    END;
    v_worker_title := CASE
      WHEN NEW.status = 'ASSIGNED' AND OLD.worker_id IS NULL THEN 'Job accepted'
      WHEN v_reassigned THEN 'Job assigned to you'
      WHEN NEW.status = 'CANCELLED' THEN 'Job cancelled'
      ELSE 'Work status updated'
    END;
    v_worker_body := CASE
      WHEN NEW.status = 'ASSIGNED' AND OLD.worker_id IS NULL THEN 'You are assigned to this job. Work details are now available.'
      WHEN v_reassigned THEN 'NetworkPeer assigned this job to you. Work details are available.'
      WHEN NEW.status = 'CANCELLED' THEN 'This assigned job has been cancelled.'
      ELSE 'Your assigned work has moved to a new stage.'
    END;
    PERFORM public.emit_user_sync_event(
      NEW.worker_id,
      v_worker_topic,
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

DROP TRIGGER emit_job_sync_events ON jobs;
CREATE TRIGGER emit_job_sync_events
  AFTER INSERT OR UPDATE OF status, worker_id ON jobs
  FOR EACH ROW EXECUTE FUNCTION emit_job_sync_events();

CREATE OR REPLACE FUNCTION emit_wallet_sync_event()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public, pg_temp
AS $$
BEGIN
  PERFORM public.emit_user_sync_event(
    NEW.user_id,
    'LEDGER_POSTED',
    'WALLET_LEDGER',
    NEW.id,
    jsonb_build_object('ledger_id', NEW.id, 'job_id', NEW.job_id),
    'Wallet activity',
    'A wallet ledger entry was recorded.',
    FALSE
  );
  RETURN NEW;
END;
$$;

CREATE TRIGGER emit_wallet_sync_event
  AFTER INSERT ON wallet_ledger
  FOR EACH ROW EXECUTE FUNCTION emit_wallet_sync_event();

CREATE OR REPLACE FUNCTION emit_notification_read_sync_event()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public, pg_temp
AS $$
BEGIN
  IF NEW.read_at IS NOT DISTINCT FROM OLD.read_at THEN
    RETURN NEW;
  END IF;
  PERFORM public.emit_user_sync_delta(
    NEW.user_id,
    'NOTIFICATION_READ',
    'NOTIFICATION',
    NEW.id,
    jsonb_build_object('notification_id', NEW.id, 'read_at', NEW.read_at)
  );
  RETURN NEW;
END;
$$;

CREATE TRIGGER emit_notification_read_sync_event
  AFTER UPDATE OF read_at ON notifications
  FOR EACH ROW EXECUTE FUNCTION emit_notification_read_sync_event();

REVOKE EXECUTE ON FUNCTION emit_user_sync_event(UUID, VARCHAR, VARCHAR, UUID, JSONB, VARCHAR, TEXT, BOOLEAN) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION emit_user_sync_delta(UUID, VARCHAR, VARCHAR, UUID, JSONB) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION emit_job_sync_events() FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION emit_wallet_sync_event() FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION emit_notification_read_sync_event() FROM PUBLIC;
