-- Monthly finance recurrence.
--
-- Additive and nullable, so existing rows stay valid: a NULL "seriesId" simply
-- means the entry does not repeat. "generatedThrough" is the 'YYYY-MM' watermark
-- of the last month the roll-forward already booked for a series, which is what
-- stops a deleted occurrence from being recreated on the next load.
ALTER TABLE "clinic_finance_entries" ADD COLUMN "seriesId" TEXT;
ALTER TABLE "clinic_finance_entries" ADD COLUMN "recurrence" TEXT;
ALTER TABLE "clinic_finance_entries" ADD COLUMN "generatedThrough" TEXT;
ALTER TABLE "clinic_finance_entries" ADD COLUMN "autoAdded" BOOLEAN NOT NULL DEFAULT false;

CREATE INDEX "clinic_finance_entries_seriesId_idx" ON "clinic_finance_entries"("seriesId");
