import { findManualPatientIdOwner } from '../src/clinic/manualPatientIds';
import assert from 'node:assert/strict';
import test from 'node:test';
import { isManualPatientIdInUse, validateManualPatientIds } from '../src/clinic/manualPatientIds';

test('availability during edit excludes only the current patient and recognizes numeric input', () => {
  const saved = [
    { patientId: 'editing', directoryId: 'PAT-0001' },
    { patientId: 'another-patient', directoryId: 'PAT-0002' },
  ];
  for (const input of ['0002', '2', 'PAT-0002', ' pat-2 ']) {
    assert.equal(isManualPatientIdInUse(input, saved, 'editing'), true);
  }
  assert.equal(isManualPatientIdInUse('0001', saved, 'editing'), false);
  assert.equal(isManualPatientIdInUse('0003', saved, 'editing'), false);
  assert.equal(isManualPatientIdInUse('0001', saved), true);
});

test('manual IDs preserve prefixes and leading zeros without allocating a number', () => {
  const profiles = [{ patientId: 'p1', directoryId: '  CARD-0007  ' }];
  assert.equal(validateManualPatientIds(profiles, [])[0].directoryId, 'CARD-0007');
});

test('existing IDs can be edited and unchanged legacy IDs are preserved', () => {
  const stored = [{ patientId: 'p1', directoryId: 'PAT-0001' }];
  assert.deepEqual(validateManualPatientIds(stored, stored), stored);
  assert.equal(validateManualPatientIds([{ patientId: 'p1', directoryId: '005' }], stored)[0].directoryId, 'PAT-0005');
});

test('new and edited IDs cannot be blank or duplicate another patient ID', () => {
  const stored = [{ patientId: 'p1', directoryId: 'Card-1' }];
  assert.throws(() => validateManualPatientIds([{ patientId: 'p2', directoryId: ' ' }], stored), /Enter the patient ID/);
  assert.throws(() => validateManualPatientIds([...stored, { patientId: 'p2', directoryId: ' card-1 ' }], stored), /already in use/);
  assert.throws(() => validateManualPatientIds([{ patientId: 'p1', directoryId: '' }], stored), /Enter the patient ID/);
});

test('numeric input is prefixed and duplicates are checked after formatting', () => {
  assert.equal(validateManualPatientIds([{ patientId: 'new', directoryId: '0001' }], [])[0].directoryId, 'PAT-0001');
  const stored = [{ patientId: 'old', directoryId: 'PAT-0001' }];
  assert.throws(() => validateManualPatientIds([...stored, { patientId: 'new', directoryId: '1' }], stored), /already in use/);
});

test('the duplicate error resolves the other patient, including prefixed and numeric IDs', () => {
  const profiles = [{ patientId: 'editing', directoryId: 'PAT-0001' }, { patientId: 'owner', directoryId: 'PAT-0003' }];
  for (const input of ['3', '0003', 'PAT-0003', ' pat-3 ']) {
    assert.equal(findManualPatientIdOwner(input, profiles, 'editing')?.patientId, 'owner');
  }
  assert.equal(findManualPatientIdOwner('0001', profiles, 'editing'), undefined);
  assert.equal(findManualPatientIdOwner('', profiles), undefined);
  assert.equal(findManualPatientIdOwner('0004', profiles), undefined);
});
