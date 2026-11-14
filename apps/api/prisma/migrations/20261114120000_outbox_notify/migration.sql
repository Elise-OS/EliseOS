-- Wake the worker as soon as a message is queued, instead of waiting for its next poll:
-- an SOS push leaves immediately. The worker still polls every second as a safety net.
CREATE OR REPLACE FUNCTION elise_notify_outbox() RETURNS trigger AS $$
BEGIN
  PERFORM pg_notify('elise_outbox', NEW.topic);
  RETURN NULL;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER elise_outbox_notify
AFTER INSERT ON "OutboxMessage"
FOR EACH ROW EXECUTE FUNCTION elise_notify_outbox();
