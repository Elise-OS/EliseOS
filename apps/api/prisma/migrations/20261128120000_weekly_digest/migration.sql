-- Weekly digest of the notebook ("bilan de la semaine"): the measures of each finished week,
-- kept so earlier digests stay readable after raw events are deleted. See docs/bilan-de-la-semaine.md.

-- CreateTable
CREATE TABLE "WeeklyDigestSnapshot" (
    "id" TEXT NOT NULL,
    "homeId" TEXT NOT NULL,
    "weekStart" TEXT NOT NULL,
    "metrics" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "WeeklyDigestSnapshot_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "WeeklyDigestSnapshot_homeId_weekStart_key" ON "WeeklyDigestSnapshot"("homeId", "weekStart");

-- AddForeignKey
ALTER TABLE "WeeklyDigestSnapshot" ADD CONSTRAINT "WeeklyDigestSnapshot_homeId_fkey" FOREIGN KEY ("homeId") REFERENCES "Home"("id") ON DELETE CASCADE ON UPDATE CASCADE;
