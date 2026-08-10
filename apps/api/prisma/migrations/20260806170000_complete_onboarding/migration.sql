CREATE TYPE "InstallationStatus" AS ENUM ('DRAFT', 'LEARNING', 'ACTIVE');
CREATE TYPE "MobilityLevel" AS ENUM ('INDEPENDENT', 'CANE', 'WALKER', 'WHEELCHAIR');
CREATE TYPE "SupportNeedKind" AS ENUM ('MEMORY', 'PARKINSON', 'FALL_RISK', 'VISION', 'HEARING', 'OTHER');
CREATE TYPE "TrustedContactRole" AS ENUM ('ADMINISTRATOR', 'RELATIVE', 'EMERGENCY');
CREATE TYPE "HabitSource" AS ENUM ('ONBOARDING', 'LEARNED', 'USER');
CREATE TYPE "HabitStatus" AS ENUM ('UNKNOWN', 'PROVIDED', 'LEARNING', 'CONFIRMED');

ALTER TABLE "Home"
  ADD COLUMN "type" TEXT NOT NULL DEFAULT 'Maison',
  ADD COLUMN "address" TEXT,
  ADD COLUMN "floorCount" INTEGER NOT NULL DEFAULT 1,
  ADD COLUMN "installationStatus" "InstallationStatus" NOT NULL DEFAULT 'DRAFT';

ALTER TABLE "Resident"
  ADD COLUMN "firstName" TEXT,
  ADD COLUMN "lastName" TEXT,
  ADD COLUMN "preferredName" TEXT,
  ADD COLUMN "birthDate" TIMESTAMP(3),
  ADD COLUMN "spokenLanguage" TEXT NOT NULL DEFAULT 'Français',
  ADD COLUMN "formOfAddress" TEXT,
  ADD COLUMN "photoPath" TEXT,
  ADD COLUMN "photoMimeType" TEXT;

UPDATE "Resident" SET "firstName" = "displayName", "preferredName" = "displayName" WHERE "firstName" IS NULL;

ALTER TABLE "User"
  ADD COLUMN "username" TEXT,
  ADD COLUMN "mustChangePassword" BOOLEAN NOT NULL DEFAULT false,
  ALTER COLUMN "email" DROP NOT NULL;

CREATE UNIQUE INDEX "User_username_key" ON "User"("username");

ALTER TABLE "Room"
  ADD COLUMN "floor" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN "sortOrder" INTEGER NOT NULL DEFAULT 0;

ALTER TABLE "HabitProfile"
  ADD COLUMN "residentId" TEXT,
  ADD COLUMN "source" "HabitSource" NOT NULL DEFAULT 'LEARNED',
  ADD COLUMN "startMinute" INTEGER,
  ADD COLUMN "endMinute" INTEGER;

ALTER TABLE "HabitProfile" ALTER COLUMN "status" DROP DEFAULT;
ALTER TABLE "HabitProfile" ALTER COLUMN "status" TYPE "HabitStatus" USING "status"::"HabitStatus";
ALTER TABLE "HabitProfile" ALTER COLUMN "status" SET DEFAULT 'LEARNING';
CREATE INDEX "HabitProfile_residentId_kind_idx" ON "HabitProfile"("residentId", "kind");
ALTER TABLE "HabitProfile" ADD CONSTRAINT "HabitProfile_residentId_fkey" FOREIGN KEY ("residentId") REFERENCES "Resident"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE "ResidentContext" (
  "id" TEXT NOT NULL,
  "residentId" TEXT NOT NULL,
  "livesAlone" BOOLEAN NOT NULL DEFAULT false,
  "livesWithPartner" BOOLEAN NOT NULL DEFAULT false,
  "livesWithRelative" BOOLEAN NOT NULL DEFAULT false,
  "receivesHomeHelp" BOOLEAN NOT NULL DEFAULT false,
  "receivesVisits" BOOLEAN NOT NULL DEFAULT false,
  "hasPet" BOOLEAN NOT NULL DEFAULT false,
  "mobility" "MobilityLevel" NOT NULL,
  "hearingDifficulty" BOOLEAN NOT NULL DEFAULT false,
  "visualDifficulty" BOOLEAN NOT NULL DEFAULT false,
  CONSTRAINT "ResidentContext_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "ResidentContext_residentId_key" ON "ResidentContext"("residentId");
ALTER TABLE "ResidentContext" ADD CONSTRAINT "ResidentContext_residentId_fkey" FOREIGN KEY ("residentId") REFERENCES "Resident"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE "SupportNeed" (
  "id" TEXT NOT NULL,
  "residentId" TEXT NOT NULL,
  "kind" "SupportNeedKind" NOT NULL,
  "note" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "SupportNeed_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "SupportNeed_residentId_kind_key" ON "SupportNeed"("residentId", "kind");
ALTER TABLE "SupportNeed" ADD CONSTRAINT "SupportNeed_residentId_fkey" FOREIGN KEY ("residentId") REFERENCES "Resident"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE "TrustedContact" (
  "id" TEXT NOT NULL,
  "homeId" TEXT NOT NULL,
  "residentId" TEXT NOT NULL,
  "userId" TEXT,
  "firstName" TEXT NOT NULL,
  "lastName" TEXT NOT NULL,
  "phone" TEXT,
  "email" TEXT,
  "relation" TEXT,
  "role" "TrustedContactRole" NOT NULL,
  "priority" INTEGER NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "TrustedContact_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "TrustedContact_userId_key" ON "TrustedContact"("userId");
CREATE UNIQUE INDEX "TrustedContact_homeId_priority_key" ON "TrustedContact"("homeId", "priority");
CREATE INDEX "TrustedContact_residentId_idx" ON "TrustedContact"("residentId");
ALTER TABLE "TrustedContact" ADD CONSTRAINT "TrustedContact_homeId_fkey" FOREIGN KEY ("homeId") REFERENCES "Home"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "TrustedContact" ADD CONSTRAINT "TrustedContact_residentId_fkey" FOREIGN KEY ("residentId") REFERENCES "Resident"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "TrustedContact" ADD CONSTRAINT "TrustedContact_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
