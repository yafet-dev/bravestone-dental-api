import assert from 'node:assert/strict';
import test from 'node:test';

import { shouldReclaimUnreferencedAttachment } from '../src/clinic/patientAttachments';

const now = new Date('2026-08-28T12:00:00.000Z').getTime();
const oldDate = new Date('2026-08-26T12:00:00.000Z');

test('patient-level image records remain durable without a diagnosis reference', () => {
  assert.equal(shouldReclaimUnreferencedAttachment({
    createdAt: oldDate,
    patientRecord: true,
    recordId: null,
  }, false, now), false);
});

test('abandoned diagnosis drafts are reclaimed after one day', () => {
  assert.equal(shouldReclaimUnreferencedAttachment({
    createdAt: oldDate,
    patientRecord: false,
    recordId: null,
  }, false, now), true);
});

test('a referenced diagnosis image is never reclaimed', () => {
  assert.equal(shouldReclaimUnreferencedAttachment({
    createdAt: oldDate,
    patientRecord: false,
    recordId: 'diagnosis-1',
  }, true, now), false);
});
