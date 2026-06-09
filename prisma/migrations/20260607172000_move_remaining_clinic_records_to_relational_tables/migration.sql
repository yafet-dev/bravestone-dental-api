-- CreateTable
CREATE TABLE "clinic_revenue_points" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "revenue" INTEGER NOT NULL,
    "patients" INTEGER NOT NULL,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "clinic_revenue_points_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "clinic_procedures" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "category" TEXT NOT NULL,
    "cost" INTEGER NOT NULL,
    "duration" TEXT NOT NULL,
    "followUp" TEXT NOT NULL,
    "patient" TEXT NOT NULL,
    "doctor" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "clinic_procedures_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "clinic_diagnoses" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "patientId" TEXT,
    "doctorId" TEXT,
    "patient" TEXT NOT NULL,
    "tooth" TEXT NOT NULL,
    "diagnosis" TEXT NOT NULL,
    "severity" TEXT NOT NULL,
    "date" TEXT NOT NULL,
    "doctor" TEXT NOT NULL,
    "complaint" TEXT,
    "doctorAction" TEXT,
    "medicine" TEXT,
    "followUp" TEXT,
    "attachments" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "clinic_diagnoses_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "clinic_symptoms" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "patientId" TEXT,
    "patient" TEXT NOT NULL,
    "date" TEXT NOT NULL,
    "tooth" TEXT NOT NULL,
    "pain" INTEGER NOT NULL,
    "sensitivity" TEXT NOT NULL,
    "bleeding" TEXT NOT NULL,
    "swelling" TEXT NOT NULL,
    "infection" TEXT NOT NULL,
    "notes" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "clinic_symptoms_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "clinic_prescriptions" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "patientId" TEXT,
    "doctorId" TEXT,
    "patient" TEXT NOT NULL,
    "doctor" TEXT NOT NULL,
    "medicine" TEXT NOT NULL,
    "dosage" TEXT NOT NULL,
    "duration" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "date" TEXT NOT NULL,
    "instructions" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "clinic_prescriptions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "clinic_invoices" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "patientId" TEXT,
    "billToName" TEXT NOT NULL,
    "date" TEXT NOT NULL,
    "amount" INTEGER NOT NULL,
    "status" TEXT NOT NULL,
    "items" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "clinic_invoices_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "clinic_forms" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "patientId" TEXT,
    "patient" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "owner" TEXT NOT NULL,
    "updated" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "clinic_forms_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "clinic_sick_leaves" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "patientId" TEXT,
    "doctorId" TEXT,
    "patient" TEXT NOT NULL,
    "doctor" TEXT NOT NULL,
    "diagnosis" TEXT NOT NULL,
    "start" TEXT NOT NULL,
    "end" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "clinic_sick_leaves_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "clinic_reports" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "range" TEXT NOT NULL,
    "format" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "clinic_reports_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "clinic_finance_entries" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "date" TEXT NOT NULL,
    "category" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "party" TEXT NOT NULL,
    "owner" TEXT NOT NULL,
    "amount" INTEGER NOT NULL,
    "status" TEXT NOT NULL,
    "frequency" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "clinic_finance_entries_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "clinic_revenue_points_organizationId_sortOrder_idx" ON "clinic_revenue_points"("organizationId", "sortOrder");
CREATE INDEX "clinic_procedures_organizationId_idx" ON "clinic_procedures"("organizationId");
CREATE INDEX "clinic_diagnoses_organizationId_idx" ON "clinic_diagnoses"("organizationId");
CREATE INDEX "clinic_diagnoses_patientId_idx" ON "clinic_diagnoses"("patientId");
CREATE INDEX "clinic_diagnoses_doctorId_idx" ON "clinic_diagnoses"("doctorId");
CREATE INDEX "clinic_symptoms_organizationId_idx" ON "clinic_symptoms"("organizationId");
CREATE INDEX "clinic_symptoms_patientId_idx" ON "clinic_symptoms"("patientId");
CREATE INDEX "clinic_prescriptions_organizationId_idx" ON "clinic_prescriptions"("organizationId");
CREATE INDEX "clinic_prescriptions_patientId_idx" ON "clinic_prescriptions"("patientId");
CREATE INDEX "clinic_prescriptions_doctorId_idx" ON "clinic_prescriptions"("doctorId");
CREATE INDEX "clinic_invoices_organizationId_idx" ON "clinic_invoices"("organizationId");
CREATE INDEX "clinic_invoices_patientId_idx" ON "clinic_invoices"("patientId");
CREATE INDEX "clinic_forms_organizationId_idx" ON "clinic_forms"("organizationId");
CREATE INDEX "clinic_forms_patientId_idx" ON "clinic_forms"("patientId");
CREATE INDEX "clinic_sick_leaves_organizationId_idx" ON "clinic_sick_leaves"("organizationId");
CREATE INDEX "clinic_sick_leaves_patientId_idx" ON "clinic_sick_leaves"("patientId");
CREATE INDEX "clinic_sick_leaves_doctorId_idx" ON "clinic_sick_leaves"("doctorId");
CREATE INDEX "clinic_reports_organizationId_idx" ON "clinic_reports"("organizationId");
CREATE INDEX "clinic_finance_entries_organizationId_idx" ON "clinic_finance_entries"("organizationId");

-- AddForeignKey
ALTER TABLE "clinic_revenue_points" ADD CONSTRAINT "clinic_revenue_points_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "clinic_procedures" ADD CONSTRAINT "clinic_procedures_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "clinic_diagnoses" ADD CONSTRAINT "clinic_diagnoses_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "clinic_diagnoses" ADD CONSTRAINT "clinic_diagnoses_patientId_fkey" FOREIGN KEY ("patientId") REFERENCES "clinic_patients"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "clinic_diagnoses" ADD CONSTRAINT "clinic_diagnoses_doctorId_fkey" FOREIGN KEY ("doctorId") REFERENCES "clinic_doctors"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "clinic_symptoms" ADD CONSTRAINT "clinic_symptoms_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "clinic_symptoms" ADD CONSTRAINT "clinic_symptoms_patientId_fkey" FOREIGN KEY ("patientId") REFERENCES "clinic_patients"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "clinic_prescriptions" ADD CONSTRAINT "clinic_prescriptions_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "clinic_prescriptions" ADD CONSTRAINT "clinic_prescriptions_patientId_fkey" FOREIGN KEY ("patientId") REFERENCES "clinic_patients"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "clinic_prescriptions" ADD CONSTRAINT "clinic_prescriptions_doctorId_fkey" FOREIGN KEY ("doctorId") REFERENCES "clinic_doctors"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "clinic_invoices" ADD CONSTRAINT "clinic_invoices_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "clinic_invoices" ADD CONSTRAINT "clinic_invoices_patientId_fkey" FOREIGN KEY ("patientId") REFERENCES "clinic_patients"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "clinic_forms" ADD CONSTRAINT "clinic_forms_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "clinic_forms" ADD CONSTRAINT "clinic_forms_patientId_fkey" FOREIGN KEY ("patientId") REFERENCES "clinic_patients"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "clinic_sick_leaves" ADD CONSTRAINT "clinic_sick_leaves_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "clinic_sick_leaves" ADD CONSTRAINT "clinic_sick_leaves_patientId_fkey" FOREIGN KEY ("patientId") REFERENCES "clinic_patients"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "clinic_sick_leaves" ADD CONSTRAINT "clinic_sick_leaves_doctorId_fkey" FOREIGN KEY ("doctorId") REFERENCES "clinic_doctors"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "clinic_reports" ADD CONSTRAINT "clinic_reports_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "clinic_finance_entries" ADD CONSTRAINT "clinic_finance_entries_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;
