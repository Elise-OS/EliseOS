CREATE TABLE "CameraRecording" (
    "id" TEXT NOT NULL,
    "homeId" TEXT NOT NULL,
    "cameraId" TEXT NOT NULL,
    "roomId" TEXT,
    "outboxId" TEXT NOT NULL,
    "sourceEventId" TEXT NOT NULL,
    "cameraName" TEXT NOT NULL,
    "roomName" TEXT,
    "doorName" TEXT NOT NULL DEFAULT 'Entrée principale',
    "path" TEXT NOT NULL,
    "mimeType" TEXT NOT NULL DEFAULT 'video/mp4',
    "sizeBytes" INTEGER NOT NULL,
    "durationSeconds" INTEGER NOT NULL,
    "capturedAt" TIMESTAMP(3) NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CameraRecording_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "CameraRecording_outboxId_key" ON "CameraRecording"("outboxId");
CREATE INDEX "CameraRecording_homeId_capturedAt_idx" ON "CameraRecording"("homeId", "capturedAt" DESC);
CREATE INDEX "CameraRecording_expiresAt_idx" ON "CameraRecording"("expiresAt");

ALTER TABLE "CameraRecording"
ADD CONSTRAINT "CameraRecording_homeId_fkey"
FOREIGN KEY ("homeId") REFERENCES "Home"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "CameraRecording"
ADD CONSTRAINT "CameraRecording_cameraId_fkey"
FOREIGN KEY ("cameraId") REFERENCES "Camera"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "CameraRecording"
ADD CONSTRAINT "CameraRecording_roomId_fkey"
FOREIGN KEY ("roomId") REFERENCES "Room"("id") ON DELETE SET NULL ON UPDATE CASCADE;
