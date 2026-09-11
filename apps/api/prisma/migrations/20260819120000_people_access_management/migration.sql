ALTER TABLE "TrustedContact"
ADD COLUMN "isEmergency" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN "archivedAt" TIMESTAMP(3);

UPDATE "TrustedContact"
SET "isEmergency" = true
WHERE "role" = 'EMERGENCY';

ALTER TABLE "Membership"
ADD COLUMN "disabledAt" TIMESTAMP(3);

ALTER TABLE "Membership" DROP CONSTRAINT IF EXISTS "Membership_roleId_fkey";
ALTER TABLE "Membership" DROP COLUMN IF EXISTS "roleId";
DROP TABLE IF EXISTS "Role";

ALTER TABLE "TrustedContact" DROP COLUMN "role";
DROP TYPE IF EXISTS "TrustedContactRole";
