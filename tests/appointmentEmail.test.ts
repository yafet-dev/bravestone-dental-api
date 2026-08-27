import assert from 'node:assert/strict';
import test from 'node:test';

import {
  buildAppointmentEmail,
  formatAppointmentDate,
  formatAppointmentTime,
  normalizePatientAppointmentEmail,
  sendPatientAppointmentEmail,
} from '../src/clinic/appointmentEmail';
import { clinicSeedState } from '../src/clinic/seed';
import type { ClinicAppointment } from '../src/clinic/types';

const appointment: ClinicAppointment = {
  id: 'appointment-email-test',
  patientId: 'p1',
  patientName: 'Eleanor Fant',
  doctorId: 'd1',
  doctorName: 'Dr. Julianne Kim',
  date: '2026-08-29',
  time: '14:05',
  duration: 45,
  type: 'consultation',
  status: 'scheduled',
  reason: 'Review & cleaning',
};

test('appointment recipient validation accepts email and rejects missing placeholders', () => {
  assert.equal(normalizePatientAppointmentEmail(' Patient@Example.COM '), 'patient@example.com');
  assert.equal(normalizePatientAppointmentEmail('No email recorded'), '');
  assert.equal(normalizePatientAppointmentEmail('not-an-email'), '');
  assert.equal(normalizePatientAppointmentEmail(undefined), '');
});

test('appointment date and time are formatted for a patient', () => {
  assert.equal(formatAppointmentDate('2026-08-29'), 'Saturday, August 29, 2026');
  assert.equal(formatAppointmentTime('00:15'), '12:15 AM');
  assert.equal(formatAppointmentTime('14:05'), '2:05 PM');
});

test('appointment email includes the visit details and safely escapes HTML', () => {
  const message = buildAppointmentEmail({
    appointment: {
      ...appointment,
      doctorName: 'Dr. <Example>',
    },
    clinicContact: '+251 900 000 000',
    clinicName: 'Bright & Smile',
    kind: 'confirmed',
    patientName: 'Marta <script>',
  });

  assert.match(message.subject, /Saturday, August 29, 2026 at 2:05 PM/);
  assert.match(message.text, /Doctor: Dr\. <Example>/);
  assert.match(message.text, /Duration: 45 minutes/);
  assert.match(message.html, /Marta &lt;script&gt;/);
  assert.match(message.html, /Dr\. &lt;Example&gt;/);
  assert.doesNotMatch(message.html, /Marta <script>/);
});

test('email sending is skipped when the appointment is not scheduled', async () => {
  const state = structuredClone(clinicSeedState);
  const result = await sendPatientAppointmentEmail({
    appointment: { ...appointment, status: 'cancelled' },
    kind: 'updated',
    state,
  });

  assert.deepEqual(result, { ok: true, skipped: true, skipReason: 'not_scheduled' });
});

test('email sending is skipped when the patient has no valid email', async () => {
  const state = structuredClone(clinicSeedState);
  const patient = state.patients.find((item) => item.id === appointment.patientId);

  assert.ok(patient);
  patient.email = 'No email recorded';

  const result = await sendPatientAppointmentEmail({
    appointment,
    kind: 'confirmed',
    state,
  });

  assert.deepEqual(result, { ok: true, skipped: true, skipReason: 'no_email' });
});
