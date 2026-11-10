ALTER TABLE "Room" ADD COLUMN "geometry" JSONB;

CREATE TABLE "HomePlan" (
  "id" TEXT NOT NULL,
  "homeId" TEXT NOT NULL,
  "revision" INTEGER NOT NULL DEFAULT 0,
  "schemaVersion" INTEGER NOT NULL DEFAULT 1,
  "data" JSONB NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "HomePlan_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "HomePlan_homeId_key" ON "HomePlan"("homeId");

ALTER TABLE "HomePlan"
  ADD CONSTRAINT "HomePlan_homeId_fkey"
  FOREIGN KEY ("homeId") REFERENCES "Home"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE OR REPLACE FUNCTION notify_home_plan_realtime() RETURNS trigger AS $$
BEGIN
  PERFORM pg_notify('michel_updates', json_build_object(
    'homeId', COALESCE(NEW."homeId", OLD."homeId"),
    'type', 'household',
    'entityId', COALESCE(NEW."id", OLD."id")
  )::text);
  RETURN COALESCE(NEW, OLD);
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER home_plan_realtime
AFTER INSERT OR UPDATE OR DELETE ON "HomePlan"
FOR EACH ROW EXECUTE FUNCTION notify_home_plan_realtime();
