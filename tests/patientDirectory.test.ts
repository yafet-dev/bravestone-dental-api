import assert from 'node:assert/strict';
import test from 'node:test';
import {
  pagePatientDirectorySlices,
  parsePatientDirectoryQuery,
  type PatientDirectoryQuery,
} from '../src/clinic/patientDirectory';
import type { ClinicPatient, ClinicPatientProfile } from '../src/clinic/types';

function patient(id: string, overrides: Partial<ClinicPatient> = {}): ClinicPatient {
  return {
    id,
    name: `Patient ${id}`,
    age: 30,
    gender: 'female',
    phone: `09000000${id}`,
    email: `${id}@example.com`,
    lastVisit: '2026-08-01',
    status: 'active',
    balance: 0,
    medicalHistory: [],
    ...overrides,
  };
}

function profile(patientId: string, overrides: Partial<ClinicPatientProfile> = {}): ClinicPatientProfile {
  return {
    patientId,
    directoryId: `PAT-${patientId.padStart(4, '0')}`,
    dob: '1996-01-01',
    address: '',
    branchId: 'branch-1',
    branchName: 'Main Branch',
    bloodGroup: 'Unknown',
    paymentPlan: { treatment: '', total: 0, paid: 0, firstPayment: 0, lastPaymentDate: '', method: '' },
    pendingAmount: 0,
    recordCount: 0,
    cardNumber: `PAT-${patientId}`,
    registrationTime: '2026-08-01T09:00:00',
    ...overrides,
  };
}

const slices = {
  patients: [
    patient('1', { name: 'Abebe Kebede', phone: '0911000001' }),
    patient('2', { name: 'Hanna Tesfaye', phone: '0911000002', status: 'inactive' }),
    patient('3', { name: 'Samuel Kiptoo', phone: '0911000003' }),
    patient('4', { name: 'Grace Wanjiku', phone: '0911000004', status: 'lost' }),
    patient('5', { name: 'Martha Chebet', phone: '0911000005' }),
  ],
  patientProfiles: [
    profile('1', { pendingAmount: 12500 }),
    profile('2'),
    profile('3', { pendingAmount: 400 }),
    profile('4'),
    profile('5'),
  ],
  patientPayments: [
    { id: 'PAY-1', patientId: '1', date: '2026-08-02', amount: 500, method: 'Cash', receivedBy: '', note: '' },
    { id: 'PAY-2', patientId: '5', date: '2026-08-03', amount: 800, method: 'Cash', receivedBy: '', note: '' },
  ],
  // The second row identifies its patient by name alone, as rows written before
  // the id column did.
  diagnoses: [
    { patientId: '1', patient: 'Abebe Kebede' },
    { patientId: null, patient: '  martha chebet ' },
  ],
};

/**
 * Built directly rather than through {@link parsePatientDirectoryQuery}, which
 * clamps the page size to the sizes the rows-per-page selector offers. Two rows
 * a page keeps the fixtures short enough to read; the parser's own clamping is
 * covered by its tests at the bottom of this file.
 */
const query = (overrides: Partial<PatientDirectoryQuery> = {}): PatientDirectoryQuery => ({
  page: 1,
  pageSize: 2,
  records: 'all',
  search: '',
  status: 'all',
  ...overrides,
});

test('a page carries only its own rows, and the total counts them all', () => {
  const first = pagePatientDirectorySlices(slices, query({ page: 1 }));

  assert.equal(first.total, 5);
  assert.deepEqual(first.patients.map((item) => item.id), ['1', '2']);
  assert.deepEqual(first.patientProfiles.map((item) => item.patientId), ['1', '2']);
});

test('consecutive pages neither repeat nor skip a patient', () => {
  const pages = [1, 2, 3].flatMap((page) => (
    pagePatientDirectorySlices(slices, query({ page })).patients.map((item) => item.id)
  ));

  assert.deepEqual(pages, ['1', '2', '3', '4', '5']);
});

test('a page past the end is empty rather than an error', () => {
  const page = pagePatientDirectorySlices(slices, query({ page: 99 }));

  assert.equal(page.total, 5);
  assert.deepEqual(page.patients, []);
});

test('only the payments of the patients on the page come back', () => {
  const first = pagePatientDirectorySlices(slices, query({ page: 1 }));
  const third = pagePatientDirectorySlices(slices, query({ page: 3 }));

  assert.deepEqual(first.patientPayments.map((payment) => payment.id), ['PAY-1']);
  assert.deepEqual(third.patientPayments.map((payment) => payment.id), ['PAY-2']);
});

test('the search matches a name, a phone number, an email, or a patient number', () => {
  const byName = pagePatientDirectorySlices(slices, query({ search: 'hanna' }));
  const byPhone = pagePatientDirectorySlices(slices, query({ search: '0911000003' }));
  const byNumber = pagePatientDirectorySlices(slices, query({ search: 'pat-0004' }));
  const byEmail = pagePatientDirectorySlices(slices, query({ search: '5@example' }));

  assert.deepEqual(byName.patients.map((item) => item.name), ['Hanna Tesfaye']);
  assert.deepEqual(byPhone.patients.map((item) => item.name), ['Samuel Kiptoo']);
  assert.deepEqual(byNumber.patients.map((item) => item.name), ['Grace Wanjiku']);
  assert.deepEqual(byEmail.patients.map((item) => item.name), ['Martha Chebet']);
});

test('a search that matches nobody reports no patients rather than everybody', () => {
  const page = pagePatientDirectorySlices(slices, query({ search: 'no such patient' }));

  assert.equal(page.total, 0);
  assert.deepEqual(page.patients, []);
});

test('the status filter reads a stored status, and "needs payment" reads the balance', () => {
  const inactive = pagePatientDirectorySlices(slices, query({ status: 'inactive' }));
  const owing = pagePatientDirectorySlices(slices, query({ status: 'needsPayment' }));

  assert.deepEqual(inactive.patients.map((item) => item.name), ['Hanna Tesfaye']);
  assert.deepEqual(owing.patients.map((item) => item.name), ['Abebe Kebede', 'Samuel Kiptoo']);
});

test('a diagnosis counts towards its patient whether it names them by id or by name', () => {
  const has = pagePatientDirectorySlices(slices, query({ records: 'has' }));
  const none = pagePatientDirectorySlices(slices, query({ records: 'none' }));

  assert.deepEqual(has.patients.map((item) => item.name), ['Abebe Kebede', 'Martha Chebet']);
  assert.deepEqual(none.patients.map((item) => item.name), ['Hanna Tesfaye', 'Samuel Kiptoo']);
  assert.equal(none.total, 3);
});

test('the record tallies answer for the search in force, not for the whole clinic', () => {
  const everyone = pagePatientDirectorySlices(slices, query({}));
  const searched = pagePatientDirectorySlices(slices, query({ search: 'abebe' }));

  assert.deepEqual(everyone.counts, { withRecords: 2, withoutRecords: 3 });
  assert.deepEqual(searched.counts, { withRecords: 1, withoutRecords: 0 });
});

test('the tallies still describe the filtered directory when a record filter is applied', () => {
  const has = pagePatientDirectorySlices(slices, query({ records: 'has' }));

  assert.deepEqual(has.counts, { withRecords: 2, withoutRecords: 3 });
  assert.equal(has.total, 2);
});

test('a malformed query falls back to the unfiltered first page', () => {
  assert.deepEqual(parsePatientDirectoryQuery({
    page: 'abc',
    pageSize: '7',
    records: 'maybe',
    status: 'nope',
  }), {
    page: 1,
    pageSize: 25,
    records: 'all',
    search: '',
    status: 'all',
  });
});

test('a query is read as sent when every field is valid', () => {
  assert.deepEqual(parsePatientDirectoryQuery({
    page: '3',
    pageSize: '100',
    records: 'none',
    search: '  Abebe  ',
    status: 'needsPayment',
  }), {
    page: 3,
    pageSize: 100,
    records: 'none',
    search: 'Abebe',
    status: 'needsPayment',
  });
});

test('every size the rows-per-page selector offers is accepted', () => {
  [10, 25, 50, 100].forEach((pageSize) => {
    assert.equal(parsePatientDirectoryQuery({ pageSize: String(pageSize) }).pageSize, pageSize);
  });
});

test('a size the selector does not offer falls back to twenty-five, not to the smallest', () => {
  [1, 7, 24, 1000, -10, 0].forEach((pageSize) => {
    assert.equal(parsePatientDirectoryQuery({ pageSize: String(pageSize) }).pageSize, 25);
  });

  assert.equal(parsePatientDirectoryQuery({}).pageSize, 25);
});

test('an over-long search term is cut rather than sent to the database whole', () => {
  const { search } = parsePatientDirectoryQuery({ search: 'a'.repeat(500) });

  assert.equal(search.length, 120);
});
