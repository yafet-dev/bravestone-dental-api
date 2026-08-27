import { sendMail, type MailResult } from '../mail/mailer';
import type { ClinicAppointment, ClinicWorkspaceState } from './types';

export type AppointmentEmailKind = 'confirmed' | 'updated';
export type AppointmentEmailSkipReason = 'no_email' | 'not_scheduled';
export type AppointmentMailResult = MailResult & {
  skipReason?: AppointmentEmailSkipReason;
};

const missingPatientEmails = new Set([
  '',
  'no email recorded',
  'not recorded',
  'n/a',
]);

function escapeHtml(value: string) {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

export function normalizePatientAppointmentEmail(value: string | null | undefined) {
  const email = typeof value === 'string' ? value.trim().toLowerCase() : '';

  if (missingPatientEmails.has(email)) {
    return '';
  }

  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) ? email : '';
}

export function formatAppointmentDate(value: string) {
  const parsed = new Date(`${value}T12:00:00.000Z`);

  if (Number.isNaN(parsed.getTime())) {
    return value;
  }

  return new Intl.DateTimeFormat('en-US', {
    day: 'numeric',
    month: 'long',
    timeZone: 'UTC',
    weekday: 'long',
    year: 'numeric',
  }).format(parsed);
}

export function formatAppointmentTime(value: string) {
  const match = /^(\d{1,2}):(\d{2})$/.exec(value.trim());

  if (!match) {
    return value;
  }

  const hour = Number(match[1]);
  const minute = Number(match[2]);

  if (hour > 23 || minute > 59) {
    return value;
  }

  const period = hour >= 12 ? 'PM' : 'AM';
  const displayHour = hour % 12 || 12;
  return `${displayHour}:${String(minute).padStart(2, '0')} ${period}`;
}

function appointmentTypeLabel(type: ClinicAppointment['type']) {
  return type.charAt(0).toUpperCase() + type.slice(1);
}

export function buildAppointmentEmail({
  appointment,
  clinicContact,
  clinicName,
  kind,
  patientName,
}: {
  appointment: ClinicAppointment;
  clinicContact?: string;
  clinicName: string;
  kind: AppointmentEmailKind;
  patientName: string;
}) {
  const date = formatAppointmentDate(appointment.date);
  const time = formatAppointmentTime(appointment.time);
  const action = kind === 'updated' ? 'updated' : 'confirmed';
  const contact = clinicContact?.trim() || '';
  const rows = [
    ['Date', date],
    ['Time', time],
    ['Doctor', appointment.doctorName],
    ['Visit', appointmentTypeLabel(appointment.type)],
    ['Duration', `${appointment.duration} minutes`],
  ];
  const textRows = rows.map(([label, value]) => `${label}: ${value}`).join('\n');

  return {
    subject: `Appointment ${action}: ${date} at ${time}`,
    text: [
      `Hello ${patientName},`,
      '',
      `Your appointment at ${clinicName} has been ${action}.`,
      '',
      textRows,
      ...(appointment.reason?.trim() ? ['', `Reason: ${appointment.reason.trim()}`] : []),
      ...(contact ? ['', `To make a change, contact the clinic at ${contact}.`] : []),
      '',
      `Thank you,`,
      clinicName,
    ].join('\n'),
    html: `
      <div style="background:#f5f7f6;padding:32px 16px;font-family:Inter,Arial,sans-serif;color:#17352d">
        <div style="max-width:560px;margin:0 auto;background:#ffffff;border:1px solid #dce7e2;border-radius:20px;overflow:hidden">
          <div style="background:#185c49;padding:24px 28px;color:#ffffff">
            <p style="margin:0 0 6px;font-size:12px;font-weight:700;letter-spacing:.08em;text-transform:uppercase;opacity:.78">${escapeHtml(clinicName)}</p>
            <h1 style="margin:0;font-size:24px;line-height:1.25">Appointment ${escapeHtml(action)}</h1>
          </div>
          <div style="padding:28px">
            <p style="margin:0 0 10px;font-size:16px">Hello ${escapeHtml(patientName)},</p>
            <p style="margin:0 0 22px;color:#55736a;line-height:1.6">Your appointment has been ${escapeHtml(action)}. Here are the details:</p>
            <div style="border:1px solid #dce7e2;border-radius:16px;overflow:hidden">
              ${rows.map(([label, value], index) => `
                <div style="display:flex;justify-content:space-between;gap:20px;padding:13px 16px;${index ? 'border-top:1px solid #e8efec;' : ''}">
                  <span style="color:#6b827b;font-size:14px">${escapeHtml(label)}</span>
                  <strong style="font-size:14px;text-align:right">${escapeHtml(value)}</strong>
                </div>
              `).join('')}
            </div>
            ${appointment.reason?.trim() ? `<p style="margin:20px 0 0;color:#55736a;font-size:14px;line-height:1.6"><strong style="color:#17352d">Reason:</strong> ${escapeHtml(appointment.reason.trim())}</p>` : ''}
            ${contact ? `<p style="margin:20px 0 0;color:#55736a;font-size:14px;line-height:1.6">Need to make a change? Contact the clinic at <strong style="color:#17352d">${escapeHtml(contact)}</strong>.</p>` : ''}
          </div>
        </div>
      </div>
    `.trim(),
  };
}

export async function sendPatientAppointmentEmail({
  appointment,
  kind,
  state,
}: {
  appointment: ClinicAppointment;
  kind: AppointmentEmailKind;
  state: ClinicWorkspaceState;
}): Promise<AppointmentMailResult> {
  if (appointment.status !== 'scheduled') {
    return { ok: true, skipped: true, skipReason: 'not_scheduled' };
  }

  const patient = state.patients.find((item) => item.id === appointment.patientId);
  const recipient = normalizePatientAppointmentEmail(patient?.email);

  if (!patient || !recipient) {
    return { ok: true, skipped: true, skipReason: 'no_email' };
  }

  const clinicName = state.organizationProfile.name.trim() || 'Your dental clinic';

  return sendMail({
    to: recipient,
    ...buildAppointmentEmail({
      appointment,
      clinicContact: state.organizationProfile.contact,
      clinicName,
      kind,
      patientName: patient.name,
    }),
  });
}
