-- Keep the account-level MFA failure window anchored to failed attempts rather
-- than challenge creation, so failures near expiry cannot fall out early.
ALTER TABLE "two_factor_login_challenges"
ADD COLUMN "lastFailedAt" TIMESTAMP(3);

-- Preserve any in-flight development challenges created before this migration.
UPDATE "two_factor_login_challenges"
SET "lastFailedAt" = "createdAt"
WHERE "attempts" > 0;

CREATE INDEX "two_factor_login_challenges_userId_lastFailedAt_idx"
ON "two_factor_login_challenges"("userId", "lastFailedAt");
