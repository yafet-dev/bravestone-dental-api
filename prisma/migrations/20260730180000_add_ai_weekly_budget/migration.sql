-- Weekly, money-denominated AI cap per clinic organization.
--
-- Spend is stored in integer micro-dollars (millionths of a USD, so $1.00 =
-- 1000000) rather than a float: a clinic accumulates many small charges per
-- week, and repeated floating-point addition would drift away from the real
-- total. `aiWeekResetAt` stays NULL until the organization's first AI call, at
-- which point the first weekly window is opened.
ALTER TABLE "organizations"
  ADD COLUMN "aiWeeklyBudgetMicroUsd" INTEGER NOT NULL DEFAULT 1000000,
  ADD COLUMN "aiWeekSpentMicroUsd" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN "aiWeekResetAt" TIMESTAMP(3),
  ADD COLUMN "aiWeekInputTokens" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN "aiWeekOutputTokens" INTEGER NOT NULL DEFAULT 0;
