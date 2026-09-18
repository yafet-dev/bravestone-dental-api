import assert from 'node:assert/strict';
import test from 'node:test';
import { mergeVitalReadings, normalizeVitalReadings, validVitalMeasurements } from '../src/clinic/patientVitals';
import { mergeClinicStateForAccess, scopeClinicStateForAccess } from '../src/clinic/access';
import { resolveWorkspaceAccess } from '../src/clinic/permissions';
import { clinicSeedState } from '../src/clinic/seed';

const reading = { id: 'v1', recordedAt: '2026-09-18T08:00:00.000Z', recordedBy: 'Reception', temperature: '36.7', systolic: '120', diastolic: '80', fbs: '95' };

test('reception and doctors can append readings without erasing earlier measurements', () => {
  for (const role of ['receptionist', 'dentist', 'clinic_admin']) {
    const current = structuredClone(clinicSeedState);
    current.patientProfiles[0].vitalReadings = [reading];
    const access = resolveWorkspaceAccess({ role });
    const incoming = scopeClinicStateForAccess(structuredClone(current), access);
    incoming.patientProfiles[0].vitalReadings = [{ ...reading, id: 'v2' }];
    const saved = mergeClinicStateForAccess({ access, current, incoming });
    assert.deepEqual(new Set(saved.patientProfiles[0].vitalReadings?.map(item => item.id)), new Set(['v1', 'v2']));
  }
});

test('accounting cannot read or change vitals through financial workflows', () => {
  const current = structuredClone(clinicSeedState);
  current.patientProfiles[0].vitalReadings = [reading];
  const access = resolveWorkspaceAccess({ role: 'accountant' });
  const incoming = scopeClinicStateForAccess(structuredClone(current), access);
  assert.deepEqual(incoming.patientProfiles[0].vitalReadings, []);
  incoming.patientProfiles[0].vitalReadings = [{ ...reading, id: 'v2' }];
  const saved = mergeClinicStateForAccess({ access, current, incoming });
  assert.deepEqual(saved.patientProfiles[0].vitalReadings, [reading]);
});

test('optional measurements stay blank and require at least one reading', () => {
  assert.equal(validVitalMeasurements({ temperature: '', systolic: '', diastolic: '', fbs: '' }), false);
  assert.equal(validVitalMeasurements({ temperature: '36.7', systolic: '', diastolic: '', fbs: '' }), true);
  assert.equal(validVitalMeasurements({ ...reading, diastolic: '' }), false);
  assert.equal(validVitalMeasurements({ ...reading, fbs: '-10' }), false);
  assert.equal(validVitalMeasurements({ ...reading, fbs: 'Infinity' }), false);
});

test('stale edits preserve readings and duplicate IDs cannot overwrite recorded values', () => {
  const newer = { ...reading, id: 'v2', recordedAt: '2026-09-19T08:00:00.000Z', fbs: '102' };
  assert.deepEqual(mergeVitalReadings([reading, newer], [{ ...reading, fbs: '10' }]), [newer, reading]);
  assert.deepEqual(mergeVitalReadings([reading], undefined), [reading]);
});

test('legacy glucose is never assumed fasting and malformed history is excluded', () => {
  assert.deepEqual(normalizeVitalReadings(undefined), []);
  assert.deepEqual(normalizeVitalReadings([{ ...reading, recordedAt: 'bad' }, null]), []);
  assert.equal(normalizeVitalReadings([{ ...reading, fbs: undefined, bloodGlucose: '180' }])[0].fbs, '');
});
