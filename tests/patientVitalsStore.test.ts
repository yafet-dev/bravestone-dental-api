import assert from 'node:assert/strict';
import test from 'node:test';
import { prisma } from '../src/db';
import { patientVitalsUpdateQuery } from '../src/clinic/patientVitalsStore';

test('focused vitals SQL is scoped, preserves profiles, and is safe to retry', {
  skip: process.env.TEST_VITALS_DATABASE !== '1',
}, async () => {
  try {
    await prisma.$transaction(async transaction => {
      // Session-local synthetic data shadows the real table; no patient data is touched.
      await transaction.$executeRaw`CREATE TEMPORARY TABLE clinic_workspace_states ("organizationId" text, "patientProfiles" jsonb, "updatedAt" timestamp) ON COMMIT DROP`;
      const profiles = [{ patientId: 'test-patient', address: 'keep', paymentPlan: { total: 123 } }, { patientId: 'other-patient', address: 'unchanged' }];
      await transaction.$executeRaw`INSERT INTO clinic_workspace_states ("organizationId", "patientProfiles") VALUES ('test-org', ${JSON.stringify(profiles)}::jsonb)`;
      const reading = { id: 'test-vital', recordedAt: '2026-09-18T08:00:00.000Z', recordedBy: 'Test staff', temperature: '36.7', systolic: '120', diastolic: '80', fbs: '' };
      const started = Date.now();
      const first = await transaction.$queryRaw<Array<{ readings: unknown[] }>>(patientVitalsUpdateQuery('test-org', 'test-patient', reading));
      assert.deepEqual(first[0].readings, [reading]);
      const retry = await transaction.$queryRaw<Array<{ readings: unknown[] }>>(patientVitalsUpdateQuery('test-org', 'test-patient', { ...reading, temperature: '99' }));
      assert.deepEqual(retry[0].readings, [reading]);
      assert.deepEqual(await transaction.$queryRaw(patientVitalsUpdateQuery('another-org', 'test-patient', reading)), []);
      assert.deepEqual(await transaction.$queryRaw(patientVitalsUpdateQuery('test-org', 'missing-patient', reading)), []);
      const [row] = await transaction.$queryRaw<Array<{ patientProfiles: unknown[] }>>`SELECT "patientProfiles" FROM clinic_workspace_states`;
      assert.deepEqual(row.patientProfiles, [{ ...profiles[0], vitalReadings: [reading] }, profiles[1]]);
      console.log(`Four focused vitals queries: ${Date.now() - started} ms`);
    }, { timeout: 15000 });
  } finally {
    await prisma.$disconnect();
  }
});
