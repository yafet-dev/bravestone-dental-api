-- Patient record images move out of the workspace JSON and into a private bucket.
--
-- Additive only: the existing `dataUrl` strings inside `clinic_workspace_states`
-- are left untouched so the app keeps rendering them until the migration script has
-- copied each one across and the copies have been verified.
CREATE TABLE "patient_attachments" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "patientId" TEXT NOT NULL,
    "recordId" TEXT,
    "fileName" TEXT NOT NULL,
    "contentType" TEXT NOT NULL,
    "storagePath" TEXT NOT NULL,
    "bytes" INTEGER NOT NULL,
    "width" INTEGER,
    "height" INTEGER,
    "isRadiograph" BOOLEAN NOT NULL DEFAULT false,
    "checksum" TEXT NOT NULL,
    "uploadedById" TEXT,
    "uploadedByName" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "patient_attachments_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "patient_attachments_storagePath_key" ON "patient_attachments"("storagePath");

CREATE INDEX "patient_attachments_organizationId_patientId_createdAt_idx" ON "patient_attachments"("organizationId", "patientId", "createdAt");

CREATE INDEX "patient_attachments_organizationId_createdAt_idx" ON "patient_attachments"("organizationId", "createdAt");

ALTER TABLE "patient_attachments" ADD CONSTRAINT "patient_attachments_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;
