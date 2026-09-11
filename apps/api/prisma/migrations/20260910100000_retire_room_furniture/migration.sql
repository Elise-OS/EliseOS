BEGIN;

CREATE TABLE IF NOT EXISTS "HomePlanFurnitureBackup" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "homeId" TEXT NOT NULL,
  "planId" TEXT NOT NULL UNIQUE,
  "planData" JSONB NOT NULL,
  "revision" INTEGER NOT NULL,
  "deviceNotes" JSONB NOT NULL,
  "capturedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- Take the original JSON and device notes before changing anything. Row locks
-- and a single transaction make the backup + conversion atomic and replayable.
DO $$
DECLARE
  rec RECORD;
  plan JSONB;
  levels JSONB;
  placements JSONB;
  level JSONB;
  placement JSONB;
  item JSONB;
  equipment_id TEXT;
  item_label TEXT;
  old_note TEXT;
  converted_note TEXT;
  labels JSONB := '{"BED":"Lit double","SINGLE_BED":"Lit simple","SOFA":"Canapé","ARMCHAIR":"Fauteuil","COFFEE_TABLE":"Table basse","TABLE":"Table","CHAIR":"Chaise","TV_STAND":"Meuble TV","SINK":"Évier","WASHING_MACHINE":"Lave-linge","DISHWASHER":"Lave-vaisselle","SHOWER":"Douche","BATHTUB":"Baignoire","TOILET":"Toilettes","FRIDGE":"Réfrigérateur","CABINET":"Placard","WARDROBE":"Armoire","DRESSER":"Commode","POWER_OUTLET":"Prise","LAMP":"Lampe","COFFEE_MACHINE":"Cafetière","KETTLE":"Bouilloire","MICROWAVE":"Micro-ondes","MEDICAL_DEVICE":"Appareil médical","OVEN":"Four","DESK":"Bureau"}'::JSONB;
BEGIN
  FOR rec IN SELECT * FROM "HomePlan" FOR UPDATE LOOP
    plan := rec."data"::JSONB;
    IF NOT EXISTS (SELECT 1 FROM jsonb_array_elements(COALESCE(plan->'levels', '[]')) l
      WHERE jsonb_array_length(COALESCE(l->'items', '[]')) > 0)
      AND NOT EXISTS (SELECT 1 FROM jsonb_array_elements(COALESCE(plan->'placements', '[]')) p WHERE p->>'targetType' = 'ITEM')
    THEN CONTINUE; END IF;

    INSERT INTO "HomePlanFurnitureBackup" ("id", "homeId", "planId", "planData", "revision", "deviceNotes")
    VALUES ('furniture-v1-' || rec."id", rec."homeId", rec."id", plan, rec."revision",
      COALESCE((SELECT jsonb_object_agg(d."id", jsonb_build_object('placementNote', d."placementNote", 'roomId', d."roomId", 'installationStatus', d."installationStatus"))
        FROM "Device" d WHERE d."homeId" = rec."homeId"), '{}'::JSONB))
    ON CONFLICT ("planId") DO NOTHING;

    placements := '[]'::JSONB;
    FOR placement IN SELECT value FROM jsonb_array_elements(COALESCE(plan->'placements', '[]')) LOOP
      IF placement->>'targetType' = 'ITEM' THEN
        SELECT i INTO item FROM jsonb_array_elements(COALESCE(plan->'levels', '[]')) l,
          jsonb_array_elements(COALESCE(l->'items', '[]')) i WHERE i->>'id' = placement->>'targetId' LIMIT 1;
        item_label := COALESCE(labels->>(item->>'kind'), item->>'kind', 'mobilier');
        old_note := COALESCE(placement->>'placementNote', '');
        converted_note := LEFT(concat_ws(' · ', NULLIF(old_note, ''), 'Ancien emplacement : ' || item_label), 500);
        placement := placement || jsonb_build_object('targetType', 'ROOM', 'targetId', placement->>'roomId', 'openingId', NULL, 'placementNote', converted_note);

        equipment_id := NULL;
        IF placement->>'kind' = 'SENSOR' THEN
          IF placement->>'equipmentRefKind' = 'DEVICE' THEN equipment_id := placement->>'equipmentId';
          ELSE SELECT "deviceId" INTO equipment_id FROM "Sensor" WHERE "id" = placement->>'equipmentId' AND "homeId" = rec."homeId";
          END IF;
          IF equipment_id IS NOT NULL THEN
            UPDATE "Device" SET "placementNote" = LEFT(concat_ws(' · ', NULLIF("placementNote", ''), 'Ancien emplacement : ' || item_label), 500)
              WHERE "id" = equipment_id AND "homeId" = rec."homeId";
          END IF;
        END IF;
      END IF;
      placements := placements || jsonb_build_array(placement);
    END LOOP;
    levels := '[]'::JSONB;
    FOR level IN SELECT value FROM jsonb_array_elements(COALESCE(plan->'levels', '[]')) LOOP
      levels := levels || jsonb_build_array(level || '{"items":[]}'::JSONB);
    END LOOP;
    plan := plan || jsonb_build_object('levels', levels, 'placements', placements, 'revision', rec."revision" + 1);
    UPDATE "HomePlan" SET "data" = plan, "revision" = rec."revision" + 1, "updatedAt" = CURRENT_TIMESTAMP WHERE "id" = rec."id";
  END LOOP;
END $$;

COMMIT;
