-- CreateTable
CREATE TABLE "clinic_discovery_entries" (
    "id" TEXT NOT NULL,
    "clinicName" TEXT NOT NULL,
    "contactName" TEXT,
    "contactPhone" TEXT,
    "notes" TEXT,
    "answers" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "clinic_discovery_entries_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "clinic_discovery_entries_clinicName_idx" ON "clinic_discovery_entries"("clinicName");
