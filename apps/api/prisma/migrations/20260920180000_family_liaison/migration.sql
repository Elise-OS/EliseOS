CREATE TABLE "LiaisonEntry" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "homeId" TEXT NOT NULL REFERENCES "Home"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  "kind" TEXT NOT NULL CHECK ("kind" IN ('NOTE', 'TASK')),
  "body" TEXT NOT NULL,
  "authorId" TEXT REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE,
  "assigneeId" TEXT REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE,
  "dueOn" TEXT,
  "completedAt" TIMESTAMP(3),
  "completedById" TEXT REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "LiaisonEntry_note_fields" CHECK ("kind" = 'TASK' OR ("assigneeId" IS NULL AND "dueOn" IS NULL AND "completedAt" IS NULL AND "completedById" IS NULL))
);
CREATE INDEX "LiaisonEntry_homeId_createdAt_id_idx" ON "LiaisonEntry"("homeId", "createdAt", "id");
CREATE INDEX "LiaisonEntry_homeId_kind_completedAt_idx" ON "LiaisonEntry"("homeId", "kind", "completedAt");
ALTER TABLE "Visit" ADD COLUMN "completedAt" TIMESTAMP(3), ADD COLUMN "completedById" TEXT;
ALTER TABLE "Visit" ADD CONSTRAINT "Visit_completedById_fkey" FOREIGN KEY ("completedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
CREATE FUNCTION michel_notify_liaison() RETURNS trigger AS $$
BEGIN
  PERFORM pg_notify('michel_updates', json_build_object('homeId', NEW."homeId", 'type', 'liaison', 'entityId', NEW.id)::text);
  RETURN NULL;
END;
$$ LANGUAGE plpgsql;
CREATE TRIGGER liaison_realtime AFTER INSERT OR UPDATE ON "LiaisonEntry"
FOR EACH ROW EXECUTE FUNCTION michel_notify_liaison();
