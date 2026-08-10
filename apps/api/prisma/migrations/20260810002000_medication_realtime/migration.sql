CREATE OR REPLACE FUNCTION michel_notify_update() RETURNS trigger AS $$
DECLARE
  domain text;
  home_id text;
  entity_id text;
  relation_id text;
BEGIN
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
    'michel_updates',
    json_build_object('homeId', home_id, 'type', domain, 'entityId', entity_id)::text
  );
  RETURN NULL;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER medication_realtime AFTER INSERT OR UPDATE OR DELETE ON "Medication"
FOR EACH ROW EXECUTE FUNCTION michel_notify_update();
CREATE TRIGGER medication_schedule_realtime AFTER INSERT OR UPDATE OR DELETE ON "MedicationSchedule"
FOR EACH ROW EXECUTE FUNCTION michel_notify_update();
CREATE TRIGGER medication_dose_realtime AFTER INSERT OR UPDATE OR DELETE ON "MedicationDose"
FOR EACH ROW EXECUTE FUNCTION michel_notify_update();
