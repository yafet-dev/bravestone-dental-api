ALTER TABLE "clinic_finance_entries"
ALTER COLUMN "amount" TYPE DECIMAL(12, 2)
USING "amount"::DECIMAL(12, 2);
