CREATE TABLE "GoogleIntegration" (
    "id" TEXT NOT NULL,
    "homeId" TEXT NOT NULL,
    "clientId" TEXT NOT NULL,
    "clientSecretEncrypted" TEXT NOT NULL,
    "redirectUri" TEXT,
    "youtubeEnabled" BOOLEAN NOT NULL DEFAULT true,
    "calendarEnabled" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "GoogleIntegration_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "GoogleIntegration_homeId_key" ON "GoogleIntegration"("homeId");

ALTER TABLE "GoogleIntegration" ADD CONSTRAINT "GoogleIntegration_homeId_fkey"
  FOREIGN KEY ("homeId") REFERENCES "Home"("id") ON DELETE CASCADE ON UPDATE CASCADE;
