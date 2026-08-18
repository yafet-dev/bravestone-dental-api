ALTER TABLE "clinic_diagnoses"
ADD COLUMN "diseaseId" TEXT;

CREATE INDEX "clinic_diagnoses_organizationId_diseaseId_idx"
ON "clinic_diagnoses"("organizationId", "diseaseId");
