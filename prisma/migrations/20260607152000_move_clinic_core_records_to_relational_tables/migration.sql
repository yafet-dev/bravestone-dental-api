-- CreateTable
CREATE TABLE "clinic_patients" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "age" INTEGER NOT NULL,
    "gender" TEXT NOT NULL,
    "phone" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "lastVisit" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "balance" INTEGER NOT NULL DEFAULT 0,
    "medicalHistory" JSONB NOT NULL,
    "dentalChart" JSONB NOT NULL,
    "notes" JSONB NOT NULL,
    "emergencyContacts" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "clinic_patients_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "clinic_patient_profiles" (
    "patientId" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "directoryId" TEXT NOT NULL,
    "dob" TEXT NOT NULL,
    "address" TEXT NOT NULL,
    "branchId" TEXT NOT NULL,
    "branchName" TEXT NOT NULL,
    "bloodGroup" TEXT NOT NULL,
    "nextAppointment" TEXT,
    "paymentPlan" JSONB NOT NULL,
    "pendingAmount" INTEGER NOT NULL DEFAULT 0,
    "recordCount" INTEGER NOT NULL DEFAULT 0,
    "cardNumber" TEXT NOT NULL,
    "registrationTime" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "clinic_patient_profiles_pkey" PRIMARY KEY ("patientId")
);

-- CreateTable
CREATE TABLE "clinic_patient_payments" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "patientId" TEXT NOT NULL,
    "date" TEXT NOT NULL,
    "amount" INTEGER NOT NULL,
    "method" TEXT NOT NULL,
    "receivedBy" TEXT NOT NULL,
    "note" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "clinic_patient_payments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "clinic_doctors" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "specialty" TEXT NOT NULL,
    "schedule" TEXT NOT NULL,
    "availability" TEXT NOT NULL,
    "assignedPatients" INTEGER NOT NULL DEFAULT 0,
    "revenue" INTEGER NOT NULL DEFAULT 0,
    "procedures" INTEGER NOT NULL DEFAULT 0,
    "rating" INTEGER NOT NULL DEFAULT 0,
    "weeklyAvailability" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "clinic_doctors_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "clinic_appointments" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "patientId" TEXT NOT NULL,
    "doctorId" TEXT NOT NULL,
    "patientName" TEXT NOT NULL,
    "doctorName" TEXT NOT NULL,
    "date" TEXT NOT NULL,
    "time" TEXT NOT NULL,
    "duration" INTEGER NOT NULL,
    "type" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "reason" TEXT,
    "createdNow" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "clinic_appointments_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "clinic_patients_organizationId_idx" ON "clinic_patients"("organizationId");

-- CreateIndex
CREATE INDEX "clinic_patients_status_idx" ON "clinic_patients"("status");

-- CreateIndex
CREATE INDEX "clinic_patient_profiles_organizationId_idx" ON "clinic_patient_profiles"("organizationId");

-- CreateIndex
CREATE INDEX "clinic_patient_profiles_branchId_idx" ON "clinic_patient_profiles"("branchId");

-- CreateIndex
CREATE INDEX "clinic_patient_payments_organizationId_idx" ON "clinic_patient_payments"("organizationId");

-- CreateIndex
CREATE INDEX "clinic_patient_payments_patientId_idx" ON "clinic_patient_payments"("patientId");

-- CreateIndex
CREATE INDEX "clinic_doctors_organizationId_idx" ON "clinic_doctors"("organizationId");

-- CreateIndex
CREATE INDEX "clinic_doctors_availability_idx" ON "clinic_doctors"("availability");

-- CreateIndex
CREATE INDEX "clinic_appointments_organizationId_idx" ON "clinic_appointments"("organizationId");

-- CreateIndex
CREATE INDEX "clinic_appointments_patientId_idx" ON "clinic_appointments"("patientId");

-- CreateIndex
CREATE INDEX "clinic_appointments_doctorId_idx" ON "clinic_appointments"("doctorId");

-- CreateIndex
CREATE INDEX "clinic_appointments_date_idx" ON "clinic_appointments"("date");

-- CreateIndex
CREATE INDEX "clinic_appointments_status_idx" ON "clinic_appointments"("status");

-- AddForeignKey
ALTER TABLE "clinic_patients" ADD CONSTRAINT "clinic_patients_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "clinic_patient_profiles" ADD CONSTRAINT "clinic_patient_profiles_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "clinic_patient_profiles" ADD CONSTRAINT "clinic_patient_profiles_patientId_fkey" FOREIGN KEY ("patientId") REFERENCES "clinic_patients"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "clinic_patient_payments" ADD CONSTRAINT "clinic_patient_payments_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "clinic_patient_payments" ADD CONSTRAINT "clinic_patient_payments_patientId_fkey" FOREIGN KEY ("patientId") REFERENCES "clinic_patients"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "clinic_doctors" ADD CONSTRAINT "clinic_doctors_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "clinic_appointments" ADD CONSTRAINT "clinic_appointments_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "clinic_appointments" ADD CONSTRAINT "clinic_appointments_patientId_fkey" FOREIGN KEY ("patientId") REFERENCES "clinic_patients"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "clinic_appointments" ADD CONSTRAINT "clinic_appointments_doctorId_fkey" FOREIGN KEY ("doctorId") REFERENCES "clinic_doctors"("id") ON DELETE CASCADE ON UPDATE CASCADE;
