import { Prisma } from '@prisma/client';
import { prisma } from '../db';
import type { ClinicVitalReading } from './types';
import { normalizeVitalReadings } from './patientVitals';

/** Update only the patient's JSON history; never rebuild the clinic tables. */
export async function appendPatientVitalReading(organizationId: string, patientId: string, reading: ClinicVitalReading) {
  return prisma.$transaction(async transaction => {
    // Match the workspace writer's lock order so its later snapshot preserves this entry.
    await transaction.$queryRaw`SELECT id FROM organizations WHERE id = ${organizationId} FOR UPDATE`;
    const rows = await transaction.$queryRaw<Array<{ readings: unknown }>>(patientVitalsUpdateQuery(organizationId, patientId, reading));
    return rows.length ? normalizeVitalReadings(rows[0].readings) : null;
  }, { maxWait: 3000, timeout: 7000 });
}

export function patientVitalsUpdateQuery(organizationId: string, patientId: string, reading: ClinicVitalReading) {
  return Prisma.sql`
      UPDATE clinic_workspace_states
      SET "patientProfiles" = (
        SELECT jsonb_agg(
          CASE WHEN profile->>'patientId' = ${patientId} THEN
            jsonb_set(profile, '{vitalReadings}',
              CASE WHEN EXISTS (
                SELECT 1 FROM jsonb_array_elements(COALESCE(profile->'vitalReadings', '[]'::jsonb)) entry
                WHERE entry->>'id' = ${reading.id}
              ) THEN COALESCE(profile->'vitalReadings', '[]'::jsonb)
              ELSE jsonb_build_array(${JSON.stringify(reading)}::jsonb) || COALESCE(profile->'vitalReadings', '[]'::jsonb)
              END
            )
          ELSE profile END ORDER BY position
        )
        FROM jsonb_array_elements("patientProfiles") WITH ORDINALITY AS entries(profile, position)
      ), "updatedAt" = NOW()
      WHERE "organizationId" = ${organizationId}
        AND EXISTS (SELECT 1 FROM jsonb_array_elements("patientProfiles") profile WHERE profile->>'patientId' = ${patientId})
      RETURNING (SELECT profile->'vitalReadings' FROM jsonb_array_elements("patientProfiles") profile WHERE profile->>'patientId' = ${patientId} LIMIT 1) AS readings
    `;
}
