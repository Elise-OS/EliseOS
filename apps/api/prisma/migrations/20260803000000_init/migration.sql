-- CreateSchema
CREATE SCHEMA IF NOT EXISTS "public";

-- CreateEnum
CREATE TYPE "MembershipRole" AS ENUM ('OWNER', 'ADMINISTRATOR', 'CAREGIVER', 'VIEWER');

-- CreateEnum
CREATE TYPE "SensorStatus" AS ENUM ('ONLINE', 'DEGRADED', 'OFFLINE', 'UNKNOWN');

-- CreateEnum
CREATE TYPE "AlertType" AS ENUM ('INACTIVITY', 'DOOR_OPEN', 'SOS', 'UNUSUAL_ACTIVITY', 'SYSTEM');

-- CreateEnum
CREATE TYPE "AlertSeverity" AS ENUM ('INFO', 'ATTENTION', 'URGENT');

-- CreateEnum
CREATE TYPE "AlertStatus" AS ENUM ('OPEN', 'ACKNOWLEDGED', 'RESOLVED', 'DISMISSED');

-- CreateEnum
CREATE TYPE "OutboxStatus" AS ENUM ('PENDING', 'PROCESSING', 'COMPLETED', 'FAILED');

-- CreateTable
CREATE TABLE "Organization" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Organization_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Home" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "timezone" TEXT NOT NULL DEFAULT 'Europe/Paris',
    "learningStartedAt" TIMESTAMP(3),
    "primaryResidentId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Home_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Resident" (
    "id" TEXT NOT NULL,
    "homeId" TEXT NOT NULL,
    "displayName" TEXT NOT NULL,
    "birthYear" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Resident_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "User" (
    "id" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "displayName" TEXT NOT NULL,
    "passwordHash" TEXT NOT NULL,
    "totpSecret" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "User_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Role" (
    "id" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "permissions" TEXT[],

    CONSTRAINT "Role_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Membership" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "roleId" TEXT,
    "systemRole" "MembershipRole" NOT NULL,

    CONSTRAINT "Membership_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CaregiverProfile" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "residentId" TEXT NOT NULL,
    "relation" TEXT,
    "isPrimary" BOOLEAN NOT NULL DEFAULT false,

    CONSTRAINT "CaregiverProfile_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Session" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Session_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Room" (
    "id" TEXT NOT NULL,
    "homeId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Room_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Device" (
    "id" TEXT NOT NULL,
    "homeId" TEXT NOT NULL,
    "roomId" TEXT,
    "sourceDeviceId" TEXT,
    "manufacturer" TEXT,
    "model" TEXT,
    "name" TEXT NOT NULL,
    "lastSeenAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Device_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Sensor" (
    "id" TEXT NOT NULL,
    "homeId" TEXT NOT NULL,
    "roomId" TEXT,
    "deviceId" TEXT,
    "entityId" TEXT NOT NULL,
    "capability" TEXT NOT NULL,
    "compatibility" TEXT NOT NULL DEFAULT 'RECOGNIZED',
    "status" "SensorStatus" NOT NULL DEFAULT 'UNKNOWN',
    "lastSeenAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Sensor_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ObservationEvent" (
    "id" TEXT NOT NULL,
    "homeId" TEXT NOT NULL,
    "sensorId" TEXT,
    "sourceEventId" TEXT NOT NULL,
    "capability" TEXT NOT NULL,
    "quality" TEXT NOT NULL,
    "payload" JSONB NOT NULL,
    "occurredAt" TIMESTAMP(3) NOT NULL,
    "receivedAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ObservationEvent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "HabitProfile" (
    "id" TEXT NOT NULL,
    "homeId" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'LEARNING',
    "parameters" JSONB NOT NULL,
    "confidence" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "validFrom" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "validTo" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "HabitProfile_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ModelArtifact" (
    "id" TEXT NOT NULL,
    "homeId" TEXT NOT NULL,
    "version" TEXT NOT NULL,
    "algorithm" TEXT NOT NULL,
    "path" TEXT NOT NULL,
    "sha256" TEXT NOT NULL,
    "trainedFrom" TIMESTAMP(3) NOT NULL,
    "trainedTo" TIMESTAMP(3) NOT NULL,
    "metrics" JSONB NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ModelArtifact_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AnomalyEvaluation" (
    "id" TEXT NOT NULL,
    "homeId" TEXT NOT NULL,
    "modelVersion" TEXT NOT NULL,
    "score" DOUBLE PRECISION NOT NULL,
    "confidence" DOUBLE PRECISION NOT NULL,
    "factors" JSONB NOT NULL,
    "evaluatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AnomalyEvaluation_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Alert" (
    "id" TEXT NOT NULL,
    "homeId" TEXT NOT NULL,
    "type" "AlertType" NOT NULL,
    "severity" "AlertSeverity" NOT NULL,
    "status" "AlertStatus" NOT NULL DEFAULT 'OPEN',
    "title" TEXT NOT NULL,
    "explanation" TEXT NOT NULL,
    "confidence" DOUBLE PRECISION,
    "openedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "acknowledgedAt" TIMESTAMP(3),
    "resolvedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Alert_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AlertTransition" (
    "id" TEXT NOT NULL,
    "alertId" TEXT NOT NULL,
    "userId" TEXT,
    "from" "AlertStatus" NOT NULL,
    "to" "AlertStatus" NOT NULL,
    "note" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AlertTransition_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "NotificationDelivery" (
    "id" TEXT NOT NULL,
    "alertId" TEXT NOT NULL,
    "channel" TEXT NOT NULL,
    "endpoint" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "lastAttemptAt" TIMESTAMP(3),
    "deliveredAt" TIMESTAMP(3),
    "error" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "NotificationDelivery_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "JournalEntry" (
    "id" TEXT NOT NULL,
    "homeId" TEXT NOT NULL,
    "authorId" TEXT,
    "kind" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "body" TEXT,
    "occurredAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "JournalEntry_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Visit" (
    "id" TEXT NOT NULL,
    "homeId" TEXT NOT NULL,
    "visitorName" TEXT NOT NULL,
    "startsAt" TIMESTAMP(3) NOT NULL,
    "endsAt" TIMESTAMP(3),
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Visit_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Appointment" (
    "id" TEXT NOT NULL,
    "homeId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "startsAt" TIMESTAMP(3) NOT NULL,
    "endsAt" TIMESTAMP(3),
    "location" TEXT,
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Appointment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ConfigurationRevision" (
    "id" TEXT NOT NULL,
    "homeId" TEXT NOT NULL,
    "version" INTEGER NOT NULL,
    "settings" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ConfigurationRevision_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AuditLog" (
    "id" TEXT NOT NULL,
    "homeId" TEXT NOT NULL,
    "actorId" TEXT,
    "action" TEXT NOT NULL,
    "target" TEXT NOT NULL,
    "metadata" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AuditLog_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "OutboxMessage" (
    "id" TEXT NOT NULL,
    "homeId" TEXT NOT NULL,
    "topic" TEXT NOT NULL,
    "payload" JSONB NOT NULL,
    "status" "OutboxStatus" NOT NULL DEFAULT 'PENDING',
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "availableAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "processedAt" TIMESTAMP(3),
    "lastError" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "OutboxMessage_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Home_primaryResidentId_key" ON "Home"("primaryResidentId");

-- CreateIndex
CREATE INDEX "Home_organizationId_idx" ON "Home"("organizationId");

-- CreateIndex
CREATE UNIQUE INDEX "User_email_key" ON "User"("email");

-- CreateIndex
CREATE UNIQUE INDEX "Role_key_key" ON "Role"("key");

-- CreateIndex
CREATE UNIQUE INDEX "Membership_organizationId_userId_key" ON "Membership"("organizationId", "userId");

-- CreateIndex
CREATE UNIQUE INDEX "CaregiverProfile_userId_key" ON "CaregiverProfile"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "Session_tokenHash_key" ON "Session"("tokenHash");

-- CreateIndex
CREATE INDEX "Session_expiresAt_idx" ON "Session"("expiresAt");

-- CreateIndex
CREATE UNIQUE INDEX "Room_homeId_name_key" ON "Room"("homeId", "name");

-- CreateIndex
CREATE UNIQUE INDEX "Device_homeId_sourceDeviceId_key" ON "Device"("homeId", "sourceDeviceId");

-- CreateIndex
CREATE UNIQUE INDEX "Sensor_homeId_entityId_key" ON "Sensor"("homeId", "entityId");

-- CreateIndex
CREATE UNIQUE INDEX "ObservationEvent_sourceEventId_key" ON "ObservationEvent"("sourceEventId");

-- CreateIndex
CREATE INDEX "ObservationEvent_homeId_occurredAt_idx" ON "ObservationEvent"("homeId", "occurredAt" DESC);

-- CreateIndex
CREATE INDEX "ObservationEvent_capability_occurredAt_idx" ON "ObservationEvent"("capability", "occurredAt");

-- CreateIndex
CREATE UNIQUE INDEX "ModelArtifact_homeId_version_key" ON "ModelArtifact"("homeId", "version");

-- CreateIndex
CREATE INDEX "AnomalyEvaluation_homeId_evaluatedAt_idx" ON "AnomalyEvaluation"("homeId", "evaluatedAt" DESC);

-- CreateIndex
CREATE INDEX "Alert_homeId_status_openedAt_idx" ON "Alert"("homeId", "status", "openedAt" DESC);

-- CreateIndex
CREATE UNIQUE INDEX "ConfigurationRevision_homeId_version_key" ON "ConfigurationRevision"("homeId", "version");

-- CreateIndex
CREATE INDEX "AuditLog_homeId_createdAt_idx" ON "AuditLog"("homeId", "createdAt" DESC);

-- CreateIndex
CREATE INDEX "OutboxMessage_status_availableAt_idx" ON "OutboxMessage"("status", "availableAt");

-- AddForeignKey
ALTER TABLE "Home" ADD CONSTRAINT "Home_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Home" ADD CONSTRAINT "Home_primaryResidentId_fkey" FOREIGN KEY ("primaryResidentId") REFERENCES "Resident"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Resident" ADD CONSTRAINT "Resident_homeId_fkey" FOREIGN KEY ("homeId") REFERENCES "Home"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Membership" ADD CONSTRAINT "Membership_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Membership" ADD CONSTRAINT "Membership_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Membership" ADD CONSTRAINT "Membership_roleId_fkey" FOREIGN KEY ("roleId") REFERENCES "Role"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CaregiverProfile" ADD CONSTRAINT "CaregiverProfile_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CaregiverProfile" ADD CONSTRAINT "CaregiverProfile_residentId_fkey" FOREIGN KEY ("residentId") REFERENCES "Resident"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Session" ADD CONSTRAINT "Session_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Room" ADD CONSTRAINT "Room_homeId_fkey" FOREIGN KEY ("homeId") REFERENCES "Home"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Device" ADD CONSTRAINT "Device_homeId_fkey" FOREIGN KEY ("homeId") REFERENCES "Home"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Device" ADD CONSTRAINT "Device_roomId_fkey" FOREIGN KEY ("roomId") REFERENCES "Room"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Sensor" ADD CONSTRAINT "Sensor_homeId_fkey" FOREIGN KEY ("homeId") REFERENCES "Home"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Sensor" ADD CONSTRAINT "Sensor_roomId_fkey" FOREIGN KEY ("roomId") REFERENCES "Room"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Sensor" ADD CONSTRAINT "Sensor_deviceId_fkey" FOREIGN KEY ("deviceId") REFERENCES "Device"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ObservationEvent" ADD CONSTRAINT "ObservationEvent_homeId_fkey" FOREIGN KEY ("homeId") REFERENCES "Home"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ObservationEvent" ADD CONSTRAINT "ObservationEvent_sensorId_fkey" FOREIGN KEY ("sensorId") REFERENCES "Sensor"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "HabitProfile" ADD CONSTRAINT "HabitProfile_homeId_fkey" FOREIGN KEY ("homeId") REFERENCES "Home"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ModelArtifact" ADD CONSTRAINT "ModelArtifact_homeId_fkey" FOREIGN KEY ("homeId") REFERENCES "Home"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AnomalyEvaluation" ADD CONSTRAINT "AnomalyEvaluation_homeId_fkey" FOREIGN KEY ("homeId") REFERENCES "Home"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Alert" ADD CONSTRAINT "Alert_homeId_fkey" FOREIGN KEY ("homeId") REFERENCES "Home"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AlertTransition" ADD CONSTRAINT "AlertTransition_alertId_fkey" FOREIGN KEY ("alertId") REFERENCES "Alert"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AlertTransition" ADD CONSTRAINT "AlertTransition_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "NotificationDelivery" ADD CONSTRAINT "NotificationDelivery_alertId_fkey" FOREIGN KEY ("alertId") REFERENCES "Alert"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "JournalEntry" ADD CONSTRAINT "JournalEntry_homeId_fkey" FOREIGN KEY ("homeId") REFERENCES "Home"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "JournalEntry" ADD CONSTRAINT "JournalEntry_authorId_fkey" FOREIGN KEY ("authorId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Visit" ADD CONSTRAINT "Visit_homeId_fkey" FOREIGN KEY ("homeId") REFERENCES "Home"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Appointment" ADD CONSTRAINT "Appointment_homeId_fkey" FOREIGN KEY ("homeId") REFERENCES "Home"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ConfigurationRevision" ADD CONSTRAINT "ConfigurationRevision_homeId_fkey" FOREIGN KEY ("homeId") REFERENCES "Home"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AuditLog" ADD CONSTRAINT "AuditLog_homeId_fkey" FOREIGN KEY ("homeId") REFERENCES "Home"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OutboxMessage" ADD CONSTRAINT "OutboxMessage_homeId_fkey" FOREIGN KEY ("homeId") REFERENCES "Home"("id") ON DELETE CASCADE ON UPDATE CASCADE;
