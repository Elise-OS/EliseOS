-- The product is now called Élise: rename the realtime notification functions and channel.
-- Triggers reference functions by OID, so renaming keeps every existing trigger attached.
ALTER FUNCTION michel_notify_update() RENAME TO elise_notify_update;
ALTER FUNCTION michel_notify_presence_tracking() RENAME TO elise_notify_presence_tracking;
ALTER FUNCTION michel_notify_liaison() RENAME TO elise_notify_liaison;

CREATE OR REPLACE FUNCTION elise_notify_update() RETURNS trigger AS $$
DECLARE
  domain text;
  home_id text;
  entity_id text;
  relation_id text;
BEGIN
  -- Every sensor reading refreshes lastSeenAt; only real changes should wake connected clients.
  IF TG_OP = 'UPDATE'
    AND TG_TABLE_NAME IN ('Sensor', 'Device')
    AND (to_jsonb(NEW) - 'lastSeenAt' - 'updatedAt') = (to_jsonb(OLD) - 'lastSeenAt' - 'updatedAt')
  THEN
    RETURN NULL;
  END IF;

  domain := CASE TG_TABLE_NAME
    WHEN 'ObservationEvent' THEN 'activity'
    WHEN 'Alert' THEN 'alerts'
    WHEN 'JournalEntry' THEN 'journal'
    WHEN 'Visit' THEN 'schedule'
    WHEN 'Appointment' THEN 'schedule'
    WHEN 'Medication' THEN 'medications'
    WHEN 'MedicationSchedule' THEN 'medications'
    WHEN 'MedicationDose' THEN 'medications'
    ELSE 'household'
  END;

  IF TG_TABLE_NAME = 'MedicationDose' THEN
    relation_id := CASE WHEN TG_OP = 'DELETE' THEN OLD."scheduleId" ELSE NEW."scheduleId" END;
    SELECT medication."homeId" INTO home_id
    FROM "MedicationSchedule" schedule
    JOIN "Medication" medication ON medication.id = schedule."medicationId"
    WHERE schedule.id = relation_id;
  ELSIF TG_TABLE_NAME = 'MedicationSchedule' THEN
    relation_id := CASE WHEN TG_OP = 'DELETE' THEN OLD."medicationId" ELSE NEW."medicationId" END;
    SELECT "homeId" INTO home_id FROM "Medication" WHERE id = relation_id;
  ELSIF TG_OP = 'DELETE' THEN
    home_id := OLD."homeId";
  ELSE
    home_id := NEW."homeId";
  END IF;

  entity_id := CASE WHEN TG_OP = 'DELETE' THEN OLD.id ELSE NEW.id END;
  PERFORM pg_notify(
    'elise_updates',
    json_build_object('homeId', home_id, 'type', domain, 'entityId', entity_id)::text
  );
  RETURN NULL;
END;
$$ LANGUAGE plpgsql;

CREATE OR REPLACE FUNCTION elise_notify_presence_tracking() RETURNS trigger AS $$
BEGIN
  PERFORM pg_notify('elise_updates', json_build_object(
    'homeId', NEW."homeId", 'type', 'presence', 'entityId', NEW.id
  )::text);
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE OR REPLACE FUNCTION elise_notify_liaison() RETURNS trigger AS $$
BEGIN
  PERFORM pg_notify('elise_updates', json_build_object('homeId', NEW."homeId", 'type', 'liaison', 'entityId', NEW.id)::text);
  RETURN NULL;
END;
$$ LANGUAGE plpgsql;

CREATE OR REPLACE FUNCTION notify_home_plan_realtime() RETURNS trigger AS $$
BEGIN
  PERFORM pg_notify('elise_updates', json_build_object(
    'homeId', COALESCE(NEW."homeId", OLD."homeId"),
    'type', 'household',
    'entityId', COALESCE(NEW."id", OLD."id")
  )::text);
  RETURN COALESCE(NEW, OLD);
END;
$$ LANGUAGE plpgsql;
