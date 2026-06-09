-- AlterTable
ALTER TABLE "clinic_workspace_states"
ADD COLUMN "rolePermissions" JSONB NOT NULL DEFAULT '[]'::jsonb,
ADD COLUMN "branches" JSONB NOT NULL DEFAULT '[]'::jsonb,
ADD COLUMN "organizationProfile" JSONB NOT NULL DEFAULT '{}'::jsonb;
