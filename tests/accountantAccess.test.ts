import assert from 'node:assert/strict';
import test from 'node:test';

import {
  defaultFeaturesForRole,
  isAssignableClinicRole,
  resolveWorkspaceAccess,
} from '../src/clinic/permissions';
import {
  mergeClinicStateForAccess,
  scopeClinicStateForAccess,
} from '../src/clinic/access';
import { clinicSeedState } from '../src/clinic/seed';

test('accountant is assignable with finance and patient-account access by default', () => {
  const features = defaultFeaturesForRole('accountant');
  const access = resolveWorkspaceAccess({ role: 'accountant' });

  assert.equal(isAssignableClinicRole('accountant'), true);
  assert.equal(access.canViewClinicFinances, true);
  assert.equal(access.canViewPatientPayments, true);
  assert.deepEqual(access.features, [
    'dashboard',
    'patients',
    'finance',
    'billing',
    'prices',
    'reports',
    'settings',
  ]);
  assert.equal(features.includes('appointments'), false);
  assert.equal(features.includes('dental_charting'), false);
  assert.equal(features.includes('prescriptions'), false);
  assert.equal(features.includes('organization'), false);
  assert.equal(features.includes('ai_assistant'), false);
});

test('accountant receives patient account data but not the clinical record', () => {
  const state = structuredClone(clinicSeedState);
  const patient = state.patients[0];
  const profile = state.patientProfiles.find((item) => item.patientId === patient.id);

  assert.ok(profile);
  patient.medicalHistory = ['Diabetes'];
  patient.notes = [{ id: 'note-1', date: '2026-08-27', note: 'Clinical note', user: 'Dentist' }];
  patient.emergencyContacts = [{ id: 'contact-1', name: 'Family', relationship: 'Sibling', phone: '0911000000' }];
  profile.bloodGroup = 'O+';
  profile.nextAppointment = '2026-09-02';
  profile.recordCount = 4;
  profile.treatmentCharges = [
    { id: 'draft', description: 'Draft crown', amount: 900, addedByName: 'Dentist', addedAt: '2026-08-27' },
    { id: 'sent', description: 'Consultation', amount: 200, addedByName: 'Dentist', addedAt: '2026-08-27', sentAt: '2026-08-27' },
  ];

  const access = resolveWorkspaceAccess({ role: 'accountant' });
  const scoped = scopeClinicStateForAccess(state, access);
  const visiblePatient = scoped.patients.find((item) => item.id === patient.id);
  const visibleProfile = scoped.patientProfiles.find((item) => item.patientId === patient.id);

  assert.ok(visiblePatient);
  assert.ok(visibleProfile);
  assert.equal(visiblePatient.name, patient.name);
  assert.equal(visiblePatient.balance, patient.balance);
  assert.deepEqual(visiblePatient.medicalHistory, []);
  assert.deepEqual(visiblePatient.notes, []);
  assert.deepEqual(visiblePatient.emergencyContacts, []);
  assert.equal(visibleProfile.bloodGroup, 'Unknown');
  assert.equal(visibleProfile.nextAppointment, undefined);
  assert.equal(visibleProfile.recordCount, 0);
  assert.deepEqual(visibleProfile.treatmentCharges?.map((charge) => charge.id), ['sent']);
  assert.deepEqual(scoped.appointments, []);
  assert.deepEqual(scoped.diagnoses, []);
  assert.deepEqual(scoped.symptoms, []);
  assert.deepEqual(scoped.prescriptions, []);
  assert.deepEqual(scoped.forms, []);
  assert.deepEqual(scoped.sickLeaves, []);
  assert.equal(scoped.financeEntries.length > 0, true);
  assert.equal(scoped.invoices.length > 0, true);
});

test('accountant saves cannot overwrite redacted clinical fields', () => {
  const current = structuredClone(clinicSeedState);
  const patient = current.patients[0];
  const profile = current.patientProfiles.find((item) => item.patientId === patient.id);

  assert.ok(profile);
  patient.medicalHistory = ['Stored condition'];
  patient.notes = [{ id: 'stored-note', date: '2026-08-27', note: 'Keep this', user: 'Dentist' }];
  profile.bloodGroup = 'A+';
  profile.recordCount = 7;
  profile.treatmentCharges = [
    { id: 'stored-charge', description: 'Filling', amount: 500, addedByName: 'Dentist', addedAt: '2026-08-27', sentAt: '2026-08-27' },
  ];

  const access = resolveWorkspaceAccess({ role: 'accountant' });
  const incoming = scopeClinicStateForAccess(current, access);
  const submittedPatient = incoming.patients.find((item) => item.id === patient.id);
  const submittedProfile = incoming.patientProfiles.find((item) => item.patientId === patient.id);

  assert.ok(submittedPatient);
  assert.ok(submittedProfile);
  submittedPatient.balance += 250;
  submittedPatient.medicalHistory = ['Injected condition'];
  submittedPatient.notes = [];
  submittedProfile.bloodGroup = 'B-';
  submittedProfile.recordCount = 0;
  submittedProfile.treatmentCharges = [];

  const merged = mergeClinicStateForAccess({ access, current, incoming });
  const mergedPatient = merged.patients.find((item) => item.id === patient.id);
  const mergedProfile = merged.patientProfiles.find((item) => item.patientId === patient.id);

  assert.ok(mergedPatient);
  assert.ok(mergedProfile);
  assert.equal(mergedPatient.balance, patient.balance + 250);
  assert.deepEqual(mergedPatient.medicalHistory, ['Stored condition']);
  assert.deepEqual(mergedPatient.notes, patient.notes);
  assert.equal(mergedProfile.bloodGroup, 'A+');
  assert.equal(mergedProfile.recordCount, 7);
  assert.deepEqual(mergedProfile.treatmentCharges, profile.treatmentCharges);
});
