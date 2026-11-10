CREATE TABLE "YouTubeConnection" (
    "id" TEXT NOT NULL,
    "homeId" TEXT NOT NULL,
    "googleAccountEmail" TEXT,
    "channelTitle" TEXT,
    "refreshTokenEncrypted" TEXT NOT NULL,
    "scope" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "YouTubeConnection_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "YouTubeConnection_homeId_key" ON "YouTubeConnection"("homeId");

ALTER TABLE "YouTubeConnection" ADD CONSTRAINT "YouTubeConnection_homeId_fkey"
  FOREIGN KEY ("homeId") REFERENCES "Home"("id") ON DELETE CASCADE ON UPDATE CASCADE;
