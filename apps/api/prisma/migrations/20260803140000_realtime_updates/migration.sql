CREATE OR REPLACE FUNCTION michel_notify_update() RETURNS trigger AS $$
DECLARE
  domain text;
  home_id text;
  entity_id text;
BEGIN
  domain := CASE TG_TABLE_NAME
    WHEN 'ObservationEvent' THEN 'activity'
    WHEN 'Alert' THEN 'alerts'
    WHEN 'JournalEntry' THEN 'journal'
    WHEN 'Visit' THEN 'schedule'
    WHEN 'Appointment' THEN 'schedule'
    ELSE 'household'
  END;
  IF TG_OP = 'DELETE' THEN
    home_id := OLD."homeId";
    entity_id := OLD.id;
  ELSE
    home_id := NEW."homeId";
    entity_id := NEW.id;
  END IF;
  PERFORM pg_notify(
    'michel_updates',
    json_build_object('homeId', home_id, 'type', domain, 'entityId', entity_id)::text
  );
  RETURN NULL;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER observation_event_realtime AFTER INSERT ON "ObservationEvent"
FOR EACH ROW EXECUTE FUNCTION michel_notify_update();
CREATE TRIGGER alert_realtime AFTER INSERT OR UPDATE ON "Alert"
FOR EACH ROW EXECUTE FUNCTION michel_notify_update();
CREATE TRIGGER sensor_realtime AFTER INSERT OR UPDATE OR DELETE ON "Sensor"
FOR EACH ROW EXECUTE FUNCTION michel_notify_update();
CREATE TRIGGER room_realtime AFTER INSERT OR UPDATE OR DELETE ON "Room"
FOR EACH ROW EXECUTE FUNCTION michel_notify_update();
CREATE TRIGGER resident_realtime AFTER INSERT OR UPDATE OR DELETE ON "Resident"
FOR EACH ROW EXECUTE FUNCTION michel_notify_update();
CREATE TRIGGER journal_realtime AFTER INSERT OR UPDATE OR DELETE ON "JournalEntry"
FOR EACH ROW EXECUTE FUNCTION michel_notify_update();
CREATE TRIGGER visit_realtime AFTER INSERT OR UPDATE OR DELETE ON "Visit"
FOR EACH ROW EXECUTE FUNCTION michel_notify_update();
CREATE TRIGGER appointment_realtime AFTER INSERT OR UPDATE OR DELETE ON "Appointment"
FOR EACH ROW EXECUTE FUNCTION michel_notify_update();
