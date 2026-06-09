-- CreateTable
CREATE TABLE "clinic_workspace_states" (
    "id" TEXT NOT NULL,
    "patients" JSONB NOT NULL,
    "patientProfiles" JSONB NOT NULL,
    "patientPayments" JSONB NOT NULL,
    "appointments" JSONB NOT NULL,
    "revenueData" JSONB NOT NULL,
    "doctors" JSONB NOT NULL,
    "procedures" JSONB NOT NULL,
    "diagnoses" JSONB NOT NULL,
    "symptoms" JSONB NOT NULL,
    "prescriptions" JSONB NOT NULL,
    "invoices" JSONB NOT NULL,
    "forms" JSONB NOT NULL,
    "sickLeaves" JSONB NOT NULL,
    "reports" JSONB NOT NULL,
    "staffUsers" JSONB NOT NULL,
    "roles" JSONB NOT NULL,
    "financeEntries" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "clinic_workspace_states_pkey" PRIMARY KEY ("id")
);
