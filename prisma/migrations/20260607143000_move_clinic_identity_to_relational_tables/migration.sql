-- AlterTable
ALTER TABLE "organizations"
ADD COLUMN "legalName" TEXT,
ADD COLUMN "contactPhone" TEXT,
ADD COLUMN "licenseNumber" TEXT,
ADD COLUMN "assistantMessages" JSONB,
ADD COLUMN "doctorProfileNotifications" JSONB;

-- AlterTable
ALTER TABLE "users"
ADD COLUMN "defaultBranchId" TEXT,
ADD COLUMN "phone" TEXT,
ADD COLUMN "emailSignature" TEXT,
ADD COLUMN "preferences" JSONB;

-- AlterTable
ALTER TABLE "clinic_workspace_states"
ADD COLUMN "organizationId" TEXT;

-- CreateTable
CREATE TABLE "clinic_roles" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "role" TEXT NOT NULL,
    "access" TEXT NOT NULL,
    "features" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "clinic_roles_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "users_defaultBranchId_idx" ON "users"("defaultBranchId");

-- CreateIndex
CREATE UNIQUE INDEX "clinic_roles_organizationId_role_key" ON "clinic_roles"("organizationId", "role");

-- CreateIndex
CREATE INDEX "clinic_roles_organizationId_idx" ON "clinic_roles"("organizationId");

-- CreateIndex
CREATE UNIQUE INDEX "clinic_workspace_states_organizationId_key" ON "clinic_workspace_states"("organizationId");

-- AddForeignKey
ALTER TABLE "users" ADD CONSTRAINT "users_defaultBranchId_fkey" FOREIGN KEY ("defaultBranchId") REFERENCES "branches"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "clinic_roles" ADD CONSTRAINT "clinic_roles_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "clinic_workspace_states" ADD CONSTRAINT "clinic_workspace_states_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE SET NULL ON UPDATE CASCADE;
