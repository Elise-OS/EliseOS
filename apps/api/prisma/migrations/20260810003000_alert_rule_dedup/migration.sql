CREATE UNIQUE INDEX "Alert_homeId_ruleKey_active_key"
ON "Alert"("homeId", "ruleKey")
WHERE "ruleKey" IS NOT NULL AND status IN ('OPEN', 'ACKNOWLEDGED');
