import assert from 'node:assert/strict';
import test from 'node:test';
import {
  mergeSubmittedTreatmentCharges,
  resolveTreatmentTotal,
  type TreatmentChargeLike,
} from '../src/clinic/treatmentCharges';

function charge(id: string, overrides: Partial<TreatmentChargeLike> = {}): TreatmentChargeLike {
  return {
    id,
    description: `Treatment ${id}`,
    amount: 1000,
    addedByName: 'Dr. Selam',
    addedAt: '2026-09-16T09:00:00.000Z',
    ...overrides,
  };
}

const sent = (id: string, overrides: Partial<TreatmentChargeLike> = {}) => (
  charge(id, { sentAt: '2026-09-16T09:05:00.000Z', ...overrides })
);

test('the doctor submits the whole list, drafts included, and it is stored as given', () => {
  const submitted = [sent('a'), charge('b')];

  assert.deepEqual(
    mergeSubmittedTreatmentCharges({ canSeeDrafts: true, stored: [sent('a'), charge('b')], submitted }),
    submitted
  );
});

test('a doctor removing their own draft actually removes it', () => {
  const merged = mergeSubmittedTreatmentCharges({
    canSeeDrafts: true,
    stored: [sent('a'), charge('b')],
    submitted: [sent('a')],
  });

  assert.deepEqual(merged.map((item) => item.id), ['a']);
});

test('a save from reception cannot delete the drafts it was never shown', () => {
  // Reception is sent only the billable lines, so their submission has no draft
  // in it. Storing that literally would throw away the doctor's working notes.
  const merged = mergeSubmittedTreatmentCharges({
    canSeeDrafts: false,
    stored: [sent('a'), charge('draft-b'), charge('draft-c')],
    submitted: [sent('a'), sent('reception-line', { addedByName: 'Hana at reception' })],
  });

  assert.deepEqual(merged.map((item) => item.id), ['a', 'reception-line', 'draft-b', 'draft-c']);
});

test('reception can still withdraw a billable line', () => {
  const merged = mergeSubmittedTreatmentCharges({
    canSeeDrafts: false,
    stored: [sent('a'), sent('b'), charge('draft-c')],
    submitted: [sent('a')],
  });

  assert.deepEqual(merged.map((item) => item.id), ['a', 'draft-c']);
});

test('a line reception adds is billable at once, so it counts toward the total', () => {
  // There is nobody for reception to send a price to — they are the desk it
  // would be sent to — so it has to price the patient the moment it is saved.
  const receptionLine = sent('reception-line', { addedByName: 'Hana at reception', amount: 2500 });

  assert.equal(resolveTreatmentTotal(0, [receptionLine]), 2500);
});

test('a line still sitting as a draft prices nobody', () => {
  assert.equal(resolveTreatmentTotal(0, [charge('draft', { amount: 2500 })]), 0);
});
