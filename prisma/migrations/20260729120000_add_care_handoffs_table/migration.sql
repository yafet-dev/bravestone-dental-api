-- Care handoffs get their own table.
--
-- They previously lived inside `clinic_workspace_states."organizationProfile"`,
-- which meant a doctor's "I am free now" could only travel when the entire
-- workspace snapshot did: a multi-megabyte write, then a multi-megabyte read on
-- the other side's poll timer. A dedicated row makes the write small enough to
-- push instantly, and lets two receptionists answer different signals without
-- overwriting each other's copy of the shared profile blob.

CREATE TABLE "care_handoffs" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "branchId" TEXT NOT NULL,
    "doctorId" TEXT NOT NULL,
    "doctorName" TEXT NOT NULL,
    "doctorSpecialty" TEXT NOT NULL,
    "requestedByMemberId" TEXT NOT NULL,
    "requestedAt" TIMESTAMP(3) NOT NULL,
    "status" TEXT NOT NULL,
    "patientId" TEXT,
    "patientName" TEXT,
    "appointmentId" TEXT,
    "assignedByMemberId" TEXT,
    "assignedByName" TEXT,
    "assignedAt" TIMESTAMP(3),
    "acknowledgedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "care_handoffs_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "care_handoffs_organizationId_status_updatedAt_idx" ON "care_handoffs"("organizationId", "status", "updatedAt");

CREATE INDEX "care_handoffs_organizationId_updatedAt_idx" ON "care_handoffs"("organizationId", "updatedAt");

CREATE INDEX "care_handoffs_organizationId_doctorId_status_idx" ON "care_handoffs"("organizationId", "doctorId", "status");

ALTER TABLE "care_handoffs" ADD CONSTRAINT "care_handoffs_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Backfill from the JSON blob. Timestamps are read through `timestamptz` and
-- then pinned to UTC so a value carrying an offset is not silently stored as
-- local wall time; anything unparseable falls back rather than aborting the
-- migration. Rows whose organization was already detached are skipped, since
-- the new table requires an owning organization.
INSERT INTO "care_handoffs" (
    "id",
    "organizationId",
    "branchId",
    "doctorId",
    "doctorName",
    "doctorSpecialty",
    "requestedByMemberId",
    "requestedAt",
    "status",
    "patientId",
    "patientName",
    "appointmentId",
    "assignedByMemberId",
    "assignedByName",
    "assignedAt",
    "acknowledgedAt",
    "createdAt",
    "updatedAt"
)
SELECT
    handoff->>'id',
    state."organizationId",
    COALESCE(handoff->>'branchId', ''),
    COALESCE(handoff->>'doctorId', ''),
    COALESCE(handoff->>'doctorName', ''),
    COALESCE(handoff->>'doctorSpecialty', 'Dentist'),
    COALESCE(handoff->>'requestedByMemberId', ''),
    CASE
        WHEN handoff->>'requestedAt' ~ '^\d{4}-\d{2}-\d{2}T'
            THEN ((handoff->>'requestedAt')::timestamptz AT TIME ZONE 'UTC')::timestamp(3)
        ELSE CURRENT_TIMESTAMP
    END,
    CASE
        WHEN handoff->>'status' IN ('ready', 'assigned', 'acknowledged', 'cancelled')
            THEN handoff->>'status'
        ELSE 'cancelled'
    END,
    NULLIF(handoff->>'patientId', ''),
    NULLIF(handoff->>'patientName', ''),
    NULLIF(handoff->>'appointmentId', ''),
    NULLIF(handoff->>'assignedByMemberId', ''),
    NULLIF(handoff->>'assignedByName', ''),
    CASE
        WHEN handoff->>'assignedAt' ~ '^\d{4}-\d{2}-\d{2}T'
            THEN ((handoff->>'assignedAt')::timestamptz AT TIME ZONE 'UTC')::timestamp(3)
        ELSE NULL
    END,
    CASE
        WHEN handoff->>'acknowledgedAt' ~ '^\d{4}-\d{2}-\d{2}T'
            THEN ((handoff->>'acknowledgedAt')::timestamptz AT TIME ZONE 'UTC')::timestamp(3)
        ELSE NULL
    END,
    CURRENT_TIMESTAMP,
    CASE
        WHEN handoff->>'updatedAt' ~ '^\d{4}-\d{2}-\d{2}T'
            THEN ((handoff->>'updatedAt')::timestamptz AT TIME ZONE 'UTC')::timestamp(3)
        ELSE CURRENT_TIMESTAMP
    END
FROM "clinic_workspace_states" AS state
CROSS JOIN LATERAL jsonb_array_elements(
    CASE
        WHEN jsonb_typeof(state."organizationProfile"->'careHandoffs') = 'array'
            THEN state."organizationProfile"->'careHandoffs'
        ELSE '[]'::jsonb
    END
) AS handoff
WHERE state."organizationId" IS NOT NULL
  AND NULLIF(handoff->>'id', '') IS NOT NULL
ON CONFLICT ("id") DO NOTHING;

-- Drop the old copy so the table is the only source of truth. Leaving it in
-- place would let a stale snapshot write resurrect a cancelled signal.
UPDATE "clinic_workspace_states"
SET "organizationProfile" = "organizationProfile" - 'careHandoffs'
WHERE "organizationProfile" ? 'careHandoffs';
