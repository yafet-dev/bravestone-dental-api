import { Prisma } from '@prisma/client';
import { ensureAdminStateSeeded } from '../admin/service';
import { prisma } from '../db';
import {
  buildClinicFallbackAssistantContent,
  buildClinicFallbackMemory,
  buildClinicFallbackReportInsights,
  clinicAssistantGreetingReply,
  clinicAssistantOffTopicReply,
  isClinicAIReportInsightSetFresh,
  isClinicScopedMessage,
  isConversationalCourtesy,
  requestClinicAssistantAI,
  requestClinicReportInsightsAI,
} from './ai';
import { extractAttachmentContents } from './attachments';
import { clinicSeedState } from './seed';
import type {
  ClinicAIMemory,
  ClinicAppointment,
  ClinicAssistantAttachment,
  ClinicAssistantMessage,
  ClinicAssistantProject,
  ClinicAssistantReplyResult,
  ClinicAssistantSession,
  ClinicDoctor,
  ClinicDoctorProfileNotification,
  ClinicFinanceEntry,
  ClinicForm,
  ClinicDiagnosis,
  ClinicInvoice,
  ClinicOrganizationBranch,
  ClinicOrganizationProfile,
  ClinicPatient,
  ClinicPatientPayment,
  ClinicPatientProfile,
  ClinicPrescription,
  ClinicProcedure,
  ClinicReport,
  ClinicReportInsightsResult,
  ClinicRevenuePoint,
  ClinicRoleDefinition,
  ClinicRolePermission,
  ClinicSickLeave,
  ClinicStaffUser,
  ClinicSymptom,
  ClinicUserPreferences,
  ClinicWorkspaceState,
} from './types';

export const clinicStateId = 'primary';
export const clinicOrganizationId = 'clinic-primary-organization';
const personalClinicOrganizationPrefix = 'clinic-org-';
const personalClinicWorkspacePrefix = 'clinic-workspace-';
const legacyMissingPatientEmail = 'No email recorded';
const legacyMissingPatientAddress = 'Address on file';
const legacyDefaultPatientTreatment = 'General dental treatment';
const legacyDefaultPatientPaymentMethod = 'Cash';
const seededClinicStaffEmails = new Set(
  clinicSeedState.staffUsers.map((user) => user.email.trim().toLowerCase())
);

const defaultPreferences: ClinicUserPreferences = {
  appointmentReminders: true,
  billingAlerts: true,
  recordReviewAlerts: false,
  weeklySummary: true,
  twoFactor: true,
  compactMode: false,
  defaultLandingPage: 'Dashboard overview',
  calendarView: 'Week view',
  timeZone: 'Africa/Nairobi',
  theme: 'Calm green',
};

function defaultOrganizationStatusForScope(organizationId: string) {
  return organizationId === clinicOrganizationId ? 'active' : 'trial';
}

type ClinicWorkspaceScope = {
  organizationId: string;
  workspaceId: string;
};

function sanitizeScopeSegment(value: string) {
  const sanitized = value.trim().toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
  return sanitized || 'clinic';
}

function getClinicWorkspaceId(organizationId: string) {
  if (organizationId === clinicOrganizationId) {
    return clinicStateId;
  }

  return `${personalClinicWorkspacePrefix}${organizationId}`;
}

function getClinicWorkspaceScope(organizationId: string): ClinicWorkspaceScope {
  return {
    organizationId,
    workspaceId: getClinicWorkspaceId(organizationId),
  };
}

function normalizePatientEmail(email: string | null | undefined) {
  const normalized = typeof email === 'string' ? email.trim() : '';
  return normalized === legacyMissingPatientEmail ? '' : normalized;
}

function normalizePatientAddress(address: string | null | undefined) {
  const normalized = typeof address === 'string' ? address.trim() : '';
  return normalized === legacyMissingPatientAddress ? '' : normalized;
}

function normalizeStaffPhone(phone: string | null | undefined) {
  const normalized = typeof phone === 'string' ? phone.trim() : '';

  if (!normalized) {
    return '';
  }

  if (normalized.includes('@') || normalized.includes('(555)')) {
    return '';
  }

  return normalized;
}

function normalizePatientPaymentPlan(
  paymentPlan: ClinicWorkspaceState['patientProfiles'][number]['paymentPlan'] | null | undefined,
  lastVisit: string | null | undefined
) {
  const total = paymentPlan?.total;
  const paid = paymentPlan?.paid;
  const firstPayment = paymentPlan?.firstPayment;

  const normalized = {
    treatment: typeof paymentPlan?.treatment === 'string' ? paymentPlan.treatment.trim() : '',
    total: typeof total === 'number' && Number.isFinite(total) ? total : 0,
    paid: typeof paid === 'number' && Number.isFinite(paid) ? paid : 0,
    firstPayment: typeof firstPayment === 'number' && Number.isFinite(firstPayment) ? firstPayment : 0,
    lastPaymentDate: typeof paymentPlan?.lastPaymentDate === 'string' ? paymentPlan.lastPaymentDate.trim() : '',
    method: typeof paymentPlan?.method === 'string' ? paymentPlan.method.trim() : '',
  };

  if (normalized.total === 0 && normalized.paid === 0 && normalized.firstPayment === 0) {
    if (normalized.treatment === legacyDefaultPatientTreatment) {
      normalized.treatment = '';
    }

    if (
      normalized.method === legacyDefaultPatientPaymentMethod
      || normalized.method === 'Not recorded'
    ) {
      normalized.method = '';
    }

    if (!normalized.lastPaymentDate || normalized.lastPaymentDate === (lastVisit || '')) {
      normalized.lastPaymentDate = '';
    }
  }

  return normalized;
}

export function isSeedClinicStaffEmail(email: string) {
  return seededClinicStaffEmails.has(email.trim().toLowerCase());
}

export function getPersonalClinicOrganizationId(authUserId: string) {
  return `${personalClinicOrganizationPrefix}${sanitizeScopeSegment(authUserId)}`;
}

function buildEmptyClinicState({
  authUserId,
  email,
  fullName,
}: {
  authUserId: string;
  email: string;
  fullName: string;
}): ClinicWorkspaceState {
  const memberName = fullName.trim() || email.split('@')[0] || 'Clinic Owner';
  const scopeSegment = sanitizeScopeSegment(authUserId).slice(0, 24);
  const branchId = `branch-${scopeSegment}`;
  const staffId = `member-${scopeSegment}`;
  const organizationName = `${memberName}'s Clinic`;

  return {
    patients: [],
    patientProfiles: [],
    patientPayments: [],
    appointments: [],
    revenueData: [],
    doctors: [],
    procedures: [],
    diagnoses: [],
    symptoms: [],
    prescriptions: [],
    invoices: [],
    forms: [],
    sickLeaves: [],
    reports: [],
    staffUsers: [
      {
        id: staffId,
        name: memberName,
        email,
        role: 'clinic_admin',
        status: 'Active',
        lastActive: 'Now',
        branchId,
        defaultBranchId: branchId,
        phone: '',
        emailSignature: `${memberName}\nClinic Admin\n${organizationName}`,
        preferences: {
          ...defaultPreferences,
        },
      },
    ],
    roles: clinicSeedState.roles,
    rolePermissions: clinicSeedState.rolePermissions,
    branches: [
      {
        id: branchId,
        name: 'Main Branch',
        city: '',
        manager: memberName,
        status: 'Active',
      },
    ],
    organizationProfile: {
      name: organizationName,
      legalName: organizationName,
      contact: email,
      license: '',
      assistantMessages: [],
      doctorProfileNotifications: [],
    },
    financeEntries: [],
  };
}

export async function ensureClinicWorkspaceForMember({
  authUserId,
  email,
  fullName,
}: {
  authUserId: string;
  email: string;
  fullName: string;
}) {
  const organizationId = getPersonalClinicOrganizationId(authUserId);
  const existingWorkspace = await prisma.clinicWorkspaceState.findUnique({
    where: { organizationId },
    select: { id: true },
  });

  if (!existingWorkspace) {
    await replaceClinicState(buildEmptyClinicState({
      authUserId,
      email,
      fullName,
    }), organizationId);
  }

  return {
    organizationId,
    branchId: `branch-${sanitizeScopeSegment(authUserId).slice(0, 24)}`,
  };
}

type RelationalClinicOrganization = {
  id: string;
  name: string;
  legalName: string | null;
  contactPhone: string | null;
  licenseNumber: string | null;
  assistantMessages: Prisma.JsonValue | null;
  doctorProfileNotifications: Prisma.JsonValue | null;
  branches: Array<{
    id: string;
    name: string;
    city: string;
    manager: string;
    status: string;
  }>;
  users: Array<{
    id: string;
    email: string;
    fullName: string;
    role: string;
    status: string;
    lastActiveAt: Date | null;
    branchId: string | null;
    defaultBranchId: string | null;
    phone: string | null;
    emailSignature: string | null;
    preferences: Prisma.JsonValue | null;
  }>;
  clinicRoles: Array<{
    role: string;
    access: string;
    features: Prisma.JsonValue;
  }>;
  clinicPatients: Array<{
    id: string;
    name: string;
    age: number;
    gender: string;
    phone: string;
    email: string;
    lastVisit: string;
    status: string;
    balance: number;
    medicalHistory: Prisma.JsonValue;
    dentalChart: Prisma.JsonValue;
    notes: Prisma.JsonValue;
    emergencyContacts: Prisma.JsonValue;
  }>;
  clinicPatientProfiles: Array<{
    patientId: string;
    directoryId: string;
    dob: string;
    address: string;
    branchId: string;
    branchName: string;
    bloodGroup: string;
    nextAppointment: string | null;
    paymentPlan: Prisma.JsonValue;
    pendingAmount: number;
    recordCount: number;
    cardNumber: string;
    registrationTime: string;
  }>;
  clinicPatientPayments: Array<{
    id: string;
    patientId: string;
    date: string;
    amount: number;
    method: string;
    receivedBy: string;
    note: string;
  }>;
  clinicDoctors: Array<{
    id: string;
    name: string;
    specialty: string;
    schedule: string;
    availability: string;
    assignedPatients: number;
    revenue: number;
    procedures: number;
    rating: number;
    weeklyAvailability: Prisma.JsonValue;
  }>;
  clinicAppointments: Array<{
    id: string;
    patientId: string;
    doctorId: string;
    patientName: string;
    doctorName: string;
    date: string;
    time: string;
    duration: number;
    type: string;
    status: string;
    reason: string | null;
    createdNow: boolean;
  }>;
  clinicRevenuePoints: Array<{
    name: string;
    revenue: number;
    patients: number;
    sortOrder: number;
  }>;
  clinicProcedures: Array<{
    id: string;
    name: string;
    category: string;
    cost: number;
    duration: string;
    followUp: string;
    patient: string;
    doctor: string;
  }>;
  clinicDiagnoses: Array<{
    id: string;
    patientId: string | null;
    doctorId: string | null;
    patient: string;
    tooth: string;
    diagnosis: string;
    severity: string;
    date: string;
    doctor: string;
    complaint: string | null;
    doctorAction: string | null;
    medicine: string | null;
    followUp: string | null;
    attachments: Prisma.JsonValue;
  }>;
  clinicSymptoms: Array<{
    id: string;
    patientId: string | null;
    patient: string;
    date: string;
    tooth: string;
    pain: number;
    sensitivity: string;
    bleeding: string;
    swelling: string;
    infection: string;
    notes: string;
  }>;
  clinicPrescriptions: Array<{
    id: string;
    patientId: string | null;
    doctorId: string | null;
    patient: string;
    doctor: string;
    medicine: string;
    dosage: string;
    duration: string;
    status: string;
    date: string;
    instructions: string | null;
  }>;
  clinicInvoices: Array<{
    id: string;
    patientId: string | null;
    billToName: string;
    date: string;
    amount: number;
    status: string;
    items: Prisma.JsonValue;
  }>;
  clinicForms: Array<{
    id: string;
    patientId: string | null;
    patient: string;
    type: string;
    status: string;
    owner: string;
    updated: string;
  }>;
  clinicSickLeaves: Array<{
    id: string;
    patientId: string | null;
    doctorId: string | null;
    patient: string;
    doctor: string;
    diagnosis: string;
    start: string;
    end: string;
    status: string;
  }>;
  clinicReports: Array<{
    id: string;
    name: string;
    type: string;
    range: string;
    format: string;
  }>;
  clinicFinanceEntries: Array<{
    id: string;
    type: string;
    date: string;
    category: string;
    description: string;
    party: string;
    owner: string;
    amount: number;
    status: string;
    frequency: string;
  }>;
};

type ClinicWorkspaceRecord = {
  id: string;
  organizationId: string | null;
  patients: Prisma.JsonValue;
  patientProfiles: Prisma.JsonValue;
  patientPayments: Prisma.JsonValue;
  appointments: Prisma.JsonValue;
  revenueData: Prisma.JsonValue;
  doctors: Prisma.JsonValue;
  procedures: Prisma.JsonValue;
  diagnoses: Prisma.JsonValue;
  symptoms: Prisma.JsonValue;
  prescriptions: Prisma.JsonValue;
  invoices: Prisma.JsonValue;
  forms: Prisma.JsonValue;
  sickLeaves: Prisma.JsonValue;
  reports: Prisma.JsonValue;
  staffUsers: Prisma.JsonValue;
  roles: Prisma.JsonValue;
  rolePermissions: Prisma.JsonValue;
  branches: Prisma.JsonValue;
  organizationProfile: Prisma.JsonValue;
  financeEntries: Prisma.JsonValue;
  organization?: RelationalClinicOrganization | null;
};

function toJsonValue(value: unknown) {
  return value as Prisma.InputJsonValue;
}

function isClinicAssistantMessage(value: unknown): value is ClinicAssistantMessage {
  if (!value || typeof value !== 'object') {
    return false;
  }

  const message = value as Partial<ClinicAssistantMessage>;
  return (
    typeof message.id === 'string'
    && (message.role === 'assistant' || message.role === 'user')
    && typeof message.content === 'string'
    && typeof message.timestamp === 'string'
  );
}

function isClinicAssistantSession(value: unknown): value is ClinicAssistantSession {
  if (!value || typeof value !== 'object') {
    return false;
  }

  const session = value as Partial<ClinicAssistantSession>;
  return (
    typeof session.id === 'string'
    && typeof session.title === 'string'
    && typeof session.createdAt === 'string'
    && typeof session.updatedAt === 'string'
    && Array.isArray(session.messages)
    && session.messages.every(isClinicAssistantMessage)
  );
}

function toAssistantSessions(value: unknown, fallback: ClinicAssistantSession[] = []) {
  return Array.isArray(value)
    ? value.filter(isClinicAssistantSession)
    : fallback;
}

function isClinicAssistantProject(value: unknown): value is ClinicAssistantProject {
  if (!value || typeof value !== 'object') {
    return false;
  }

  const project = value as Partial<ClinicAssistantProject>;
  return (
    typeof project.id === 'string'
    && typeof project.name === 'string'
    && typeof project.createdAt === 'string'
  );
}

function toAssistantProjects(value: unknown, fallback: ClinicAssistantProject[] = []) {
  return Array.isArray(value)
    ? value.filter(isClinicAssistantProject)
    : fallback;
}

function isDoctorProfileNotification(value: unknown): value is ClinicDoctorProfileNotification {
  if (!value || typeof value !== 'object') {
    return false;
  }

  const notification = value as Partial<ClinicDoctorProfileNotification>;
  return (
    typeof notification.id === 'string'
    && typeof notification.patientId === 'string'
    && typeof notification.patientName === 'string'
    && typeof notification.doctorId === 'string'
    && typeof notification.doctorName === 'string'
    && typeof notification.createdAt === 'string'
  );
}

function toAssistantMessages(
  value: Prisma.JsonValue | null | undefined,
  fallback: ClinicAssistantMessage[]
) {
  return Array.isArray(value)
    ? value.filter(isClinicAssistantMessage)
    : fallback;
}

function toDoctorProfileNotifications(
  value: Prisma.JsonValue | null | undefined,
  fallback: ClinicDoctorProfileNotification[]
) {
  return Array.isArray(value)
    ? value.filter(isDoctorProfileNotification)
    : fallback;
}

function toRoleFeatures(value: Prisma.JsonValue | null | undefined, fallback: string[] = []) {
  return Array.isArray(value)
    ? value.filter((feature): feature is string => typeof feature === 'string')
    : fallback;
}

function toUserPreferences(value: Prisma.JsonValue | null | undefined) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return undefined;
  }

  return value as ClinicUserPreferences;
}

function toStringList(value: Prisma.JsonValue | null | undefined, fallback: string[] = []) {
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === 'string')
    : fallback;
}

function toJsonArray<T>(value: Prisma.JsonValue | null | undefined, fallback: T[] = []) {
  return Array.isArray(value) ? value as T[] : fallback;
}

function toJsonObject<T extends object>(value: Prisma.JsonValue | null | undefined, fallback: T) {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as T
    : fallback;
}

const genericClinicOrganizationName = 'Your clinic';
const genericClinicRole = 'Clinic staff';

function normalizeClinicState(state: ClinicWorkspaceState): ClinicWorkspaceState {
  const defaultAssistantMessages: ClinicAssistantMessage[] = [];
  const defaultDoctorProfileNotifications: ClinicDoctorProfileNotification[] = [];
  const defaultOrganizationProfile = {
    name: genericClinicOrganizationName,
    legalName: '',
    contact: '',
    license: '',
    assistantMessages: defaultAssistantMessages,
    doctorProfileNotifications: defaultDoctorProfileNotifications,
  };
  const patientLastVisitById = new Map(state.patients.map((patient) => [patient.id, patient.lastVisit]));

  return {
    ...state,
    patients: state.patients.map((patient) => ({
      ...patient,
      email: normalizePatientEmail(patient.email),
      dentalChart: patient.dentalChart ?? [],
      notes: patient.notes ?? [],
      emergencyContacts: patient.emergencyContacts ?? [],
    })),
    patientProfiles: state.patientProfiles.map((profile) => ({
      ...profile,
      address: normalizePatientAddress(profile.address),
      paymentPlan: normalizePatientPaymentPlan(profile.paymentPlan, patientLastVisitById.get(profile.patientId)),
    })),
    appointments: state.appointments.map((appointment) => ({
      ...appointment,
      reason: appointment.reason || 'Patient visit',
    })),
    doctors: state.doctors.map((doctor) => ({
      ...doctor,
      availability: doctor.availability || 'Available',
      schedule: doctor.schedule || 'No clinic hours set',
      weeklyAvailability: doctor.weeklyAvailability?.length
        ? doctor.weeklyAvailability
        : [],
    })),
    diagnoses: state.diagnoses.map((diagnosis) => ({
      ...diagnosis,
      complaint: diagnosis.complaint ?? '',
      doctorAction: diagnosis.doctorAction ?? '',
      medicine: diagnosis.medicine ?? '',
      followUp: diagnosis.followUp ?? '',
      attachments: diagnosis.attachments ?? [],
    })),
    prescriptions: state.prescriptions.map((prescription) => ({
      ...prescription,
      instructions: prescription.instructions ?? '',
    })),
    staffUsers: state.staffUsers.map((user, index) => {
      const fallbackBranchId = state.branches[index % Math.max(state.branches.length, 1)]?.id || '';
      const organizationName = state.organizationProfile.name || defaultOrganizationProfile.name;
      const branchId = user.branchId || fallbackBranchId;

      return {
        ...user,
        branchId,
        phone: normalizeStaffPhone(user.phone),
        defaultBranchId: user.defaultBranchId || branchId,
        emailSignature: user.emailSignature ?? `${user.name}\n${user.role}\n${organizationName}`,
        preferences: {
          ...defaultPreferences,
          ...(user.preferences || {}),
        },
      };
    }),
    roles: state.roles,
    rolePermissions: state.rolePermissions.length
      ? state.rolePermissions
      : state.roles.map((role) => ({
        role: role.role,
        features: [],
      })),
    branches: state.branches,
    organizationProfile: Object.keys(state.organizationProfile || {}).length
      ? {
          ...defaultOrganizationProfile,
          ...state.organizationProfile,
          assistantMessages: state.organizationProfile.assistantMessages || defaultAssistantMessages,
          assistantSessions: toAssistantSessions(state.organizationProfile.assistantSessions),
          assistantProjects: toAssistantProjects(state.organizationProfile.assistantProjects),
          doctorProfileNotifications: Array.isArray(state.organizationProfile.doctorProfileNotifications)
            ? state.organizationProfile.doctorProfileNotifications.filter(isDoctorProfileNotification)
            : defaultDoctorProfileNotifications,
        }
      : defaultOrganizationProfile,
  };
}

function formatCurrency(amount: number) {
  return `ETB ${new Intl.NumberFormat('en-US').format(amount)}`;
}

function toTimestamp(value: string) {
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? 0 : parsed.getTime();
}

function getLocalDateKey(date = new Date()) {
  return [
    date.getFullYear(),
    String(date.getMonth() + 1).padStart(2, '0'),
    String(date.getDate()).padStart(2, '0'),
  ].join('-');
}

function getCollectedRevenue(state: ClinicWorkspaceState) {
  const patientPaymentRevenue = state.patientPayments.reduce((sum, payment) => sum + payment.amount, 0);
  const receivedFinanceRevenue = state.financeEntries.reduce((sum, entry) => {
    if (entry.type !== 'income' || entry.status !== 'Received') {
      return sum;
    }

    return sum + entry.amount;
  }, 0);

  return patientPaymentRevenue + receivedFinanceRevenue;
}

function formatLastActive(lastActiveAt: Date | null | undefined, status: string) {
  if (status === 'invited') {
    return 'Pending';
  }

  if (status === 'banned' || status === 'suspended') {
    return 'Suspended';
  }

  if (!lastActiveAt) {
    return 'Now';
  }

  const diffMinutes = Math.max(0, Math.round((Date.now() - lastActiveAt.getTime()) / 60000));

  if (diffMinutes <= 1) {
    return 'Now';
  }

  if (diffMinutes < 60) {
    return `${diffMinutes} min ago`;
  }

  const diffHours = Math.round(diffMinutes / 60);

  if (diffHours < 24) {
    return `${diffHours} hour${diffHours === 1 ? '' : 's'} ago`;
  }

  const diffDays = Math.round(diffHours / 24);
  return `${diffDays} day${diffDays === 1 ? '' : 's'} ago`;
}

function toDatabaseBranchStatus(status: string) {
  if (status === 'Opening soon') {
    return 'trial';
  }

  if (status === 'Paused') {
    return 'banned';
  }

  return 'active';
}

function toClinicBranchStatus(status: string): ClinicOrganizationBranch['status'] {
  if (status === 'trial') {
    return 'Opening soon';
  }

  if (status === 'banned') {
    return 'Paused';
  }

  return 'Active';
}

function toDatabaseUserStatus(status: string) {
  if (status.toLowerCase() === 'invited') {
    return 'invited';
  }

  if (status.toLowerCase() === 'suspended' || status.toLowerCase() === 'banned') {
    return 'banned';
  }

  return 'active';
}

function toClinicUserStatus(status: string) {
  if (status === 'invited') {
    return 'Invited';
  }

  if (status === 'banned' || status === 'suspended') {
    return 'Suspended';
  }

  return 'Active';
}

function mapLegacyClinicState(record: ClinicWorkspaceRecord): ClinicWorkspaceState {
  return normalizeClinicState({
    patients: record.patients as ClinicWorkspaceState['patients'],
    patientProfiles: record.patientProfiles as ClinicWorkspaceState['patientProfiles'],
    patientPayments: record.patientPayments as ClinicWorkspaceState['patientPayments'],
    appointments: record.appointments as ClinicWorkspaceState['appointments'],
    revenueData: record.revenueData as ClinicWorkspaceState['revenueData'],
    doctors: record.doctors as ClinicWorkspaceState['doctors'],
    procedures: record.procedures as ClinicWorkspaceState['procedures'],
    diagnoses: record.diagnoses as ClinicWorkspaceState['diagnoses'],
    symptoms: record.symptoms as ClinicWorkspaceState['symptoms'],
    prescriptions: record.prescriptions as ClinicWorkspaceState['prescriptions'],
    invoices: record.invoices as ClinicWorkspaceState['invoices'],
    forms: record.forms as ClinicWorkspaceState['forms'],
    sickLeaves: record.sickLeaves as ClinicWorkspaceState['sickLeaves'],
    reports: record.reports as ClinicWorkspaceState['reports'],
    staffUsers: record.staffUsers as ClinicWorkspaceState['staffUsers'],
    roles: record.roles as ClinicWorkspaceState['roles'],
    rolePermissions: record.rolePermissions as ClinicWorkspaceState['rolePermissions'],
    branches: record.branches as ClinicWorkspaceState['branches'],
    organizationProfile: record.organizationProfile as ClinicWorkspaceState['organizationProfile'],
    financeEntries: record.financeEntries as ClinicWorkspaceState['financeEntries'],
  });
}

function mapRelationalPatients(
  organization: RelationalClinicOrganization,
  fallbackPatients: ClinicPatient[]
): ClinicPatient[] {
  if (!organization.clinicPatients.length) {
    return fallbackPatients;
  }

  return organization.clinicPatients.map((patient) => {
    const fallbackPatient = fallbackPatients.find((item) => item.id === patient.id);

    return {
      id: patient.id,
      name: patient.name,
      age: patient.age,
      gender: patient.gender as ClinicPatient['gender'],
      phone: patient.phone,
      email: normalizePatientEmail(patient.email),
      lastVisit: patient.lastVisit,
      status: patient.status as ClinicPatient['status'],
      balance: patient.balance,
      medicalHistory: toStringList(patient.medicalHistory, fallbackPatient?.medicalHistory || []),
      dentalChart: toJsonArray(patient.dentalChart, fallbackPatient?.dentalChart || []),
      notes: toJsonArray(patient.notes, fallbackPatient?.notes || []),
      emergencyContacts: toJsonArray(patient.emergencyContacts, fallbackPatient?.emergencyContacts || []),
    };
  });
}

function mapRelationalPatientProfiles(
  organization: RelationalClinicOrganization,
  fallbackProfiles: ClinicPatientProfile[]
): ClinicPatientProfile[] {
  if (!organization.clinicPatientProfiles.length) {
    return fallbackProfiles;
  }

  return organization.clinicPatientProfiles.map((profile) => {
    const fallbackProfile = fallbackProfiles.find((item) => item.patientId === profile.patientId);

    return {
      patientId: profile.patientId,
      directoryId: profile.directoryId,
      dob: profile.dob,
      address: normalizePatientAddress(profile.address),
      branchId: profile.branchId,
      branchName: profile.branchName,
      bloodGroup: profile.bloodGroup,
      nextAppointment: profile.nextAppointment || fallbackProfile?.nextAppointment,
      paymentPlan: toJsonObject(profile.paymentPlan, fallbackProfile?.paymentPlan || {
        treatment: 'General dental treatment',
        total: 0,
        paid: 0,
        firstPayment: 0,
        lastPaymentDate: '',
        method: 'Cash',
      }),
      pendingAmount: profile.pendingAmount,
      recordCount: profile.recordCount,
      cardNumber: profile.cardNumber,
      registrationTime: profile.registrationTime,
    };
  });
}

function mapRelationalPatientPayments(
  organization: RelationalClinicOrganization,
  fallbackPayments: ClinicPatientPayment[]
): ClinicPatientPayment[] {
  if (!organization.clinicPatientPayments.length) {
    return fallbackPayments;
  }

  return organization.clinicPatientPayments.map((payment) => ({
    id: payment.id,
    patientId: payment.patientId,
    date: payment.date,
    amount: payment.amount,
    method: payment.method,
    receivedBy: payment.receivedBy,
    note: payment.note,
  }));
}

function mapRelationalDoctors(
  organization: RelationalClinicOrganization,
  fallbackDoctors: ClinicDoctor[]
): ClinicDoctor[] {
  if (!organization.clinicDoctors.length) {
    return fallbackDoctors;
  }

  return organization.clinicDoctors.map((doctor) => {
    const fallbackDoctor = fallbackDoctors.find((item) => item.id === doctor.id);

    return {
      id: doctor.id,
      name: doctor.name,
      specialty: doctor.specialty,
      schedule: doctor.schedule,
      availability: doctor.availability as ClinicDoctor['availability'],
      assignedPatients: doctor.assignedPatients,
      revenue: doctor.revenue,
      procedures: doctor.procedures,
      rating: doctor.rating,
      weeklyAvailability: toJsonArray(doctor.weeklyAvailability, fallbackDoctor?.weeklyAvailability || []),
    };
  });
}

function mapRelationalAppointments(
  organization: RelationalClinicOrganization,
  fallbackAppointments: ClinicAppointment[]
): ClinicAppointment[] {
  if (!organization.clinicAppointments.length) {
    return fallbackAppointments;
  }

  return organization.clinicAppointments.map((appointment) => ({
    id: appointment.id,
    patientId: appointment.patientId,
    patientName: appointment.patientName,
    doctorId: appointment.doctorId,
    doctorName: appointment.doctorName,
    date: appointment.date,
    time: appointment.time,
    duration: appointment.duration,
    type: appointment.type as ClinicAppointment['type'],
    status: appointment.status as ClinicAppointment['status'],
    reason: appointment.reason || fallbackAppointments.find((item) => item.id === appointment.id)?.reason || 'Patient visit',
    createdNow: appointment.createdNow,
  }));
}

function mapRelationalRevenuePoints(
  organization: RelationalClinicOrganization,
  fallbackPoints: ClinicRevenuePoint[]
): ClinicRevenuePoint[] {
  if (!organization.clinicRevenuePoints.length) {
    return fallbackPoints;
  }

  return [...organization.clinicRevenuePoints]
    .sort((left, right) => left.sortOrder - right.sortOrder)
    .map((point) => ({
      name: point.name,
      revenue: point.revenue,
      patients: point.patients,
    }));
}

function mapRelationalProcedures(
  organization: RelationalClinicOrganization,
  fallbackProcedures: ClinicProcedure[]
): ClinicProcedure[] {
  if (!organization.clinicProcedures.length) {
    return fallbackProcedures;
  }

  return organization.clinicProcedures.map((procedure) => ({
    id: procedure.id,
    name: procedure.name,
    category: procedure.category,
    cost: procedure.cost,
    duration: procedure.duration,
    followUp: procedure.followUp,
    patient: procedure.patient,
    doctor: procedure.doctor,
  }));
}

function mapRelationalDiagnoses(
  organization: RelationalClinicOrganization,
  fallbackDiagnoses: ClinicDiagnosis[]
): ClinicDiagnosis[] {
  if (!organization.clinicDiagnoses.length) {
    return fallbackDiagnoses;
  }

  return organization.clinicDiagnoses.map((diagnosis) => {
    const fallbackDiagnosis = fallbackDiagnoses.find((item) => item.id === diagnosis.id);

    return {
      id: diagnosis.id,
      patientId: diagnosis.patientId || undefined,
      doctorId: diagnosis.doctorId || undefined,
      patient: diagnosis.patient,
      tooth: diagnosis.tooth,
      diagnosis: diagnosis.diagnosis,
      severity: diagnosis.severity,
      date: diagnosis.date,
      doctor: diagnosis.doctor,
      complaint: diagnosis.complaint ?? fallbackDiagnosis?.complaint ?? '',
      doctorAction: diagnosis.doctorAction ?? fallbackDiagnosis?.doctorAction ?? '',
      medicine: diagnosis.medicine ?? fallbackDiagnosis?.medicine ?? '',
      followUp: diagnosis.followUp ?? fallbackDiagnosis?.followUp ?? '',
      attachments: toJsonArray(diagnosis.attachments, fallbackDiagnosis?.attachments || []),
    };
  });
}

function mapRelationalSymptoms(
  organization: RelationalClinicOrganization,
  fallbackSymptoms: ClinicSymptom[]
): ClinicSymptom[] {
  if (!organization.clinicSymptoms.length) {
    return fallbackSymptoms;
  }

  return organization.clinicSymptoms.map((symptom) => ({
    id: symptom.id,
    patientId: symptom.patientId || undefined,
    patient: symptom.patient,
    date: symptom.date,
    tooth: symptom.tooth,
    pain: symptom.pain,
    sensitivity: symptom.sensitivity,
    bleeding: symptom.bleeding,
    swelling: symptom.swelling,
    infection: symptom.infection,
    notes: symptom.notes,
  }));
}

function mapRelationalPrescriptions(
  organization: RelationalClinicOrganization,
  fallbackPrescriptions: ClinicPrescription[]
): ClinicPrescription[] {
  if (!organization.clinicPrescriptions.length) {
    return fallbackPrescriptions;
  }

  return organization.clinicPrescriptions.map((prescription) => ({
    id: prescription.id,
    patientId: prescription.patientId || undefined,
    doctorId: prescription.doctorId || undefined,
    patient: prescription.patient,
    doctor: prescription.doctor,
    medicine: prescription.medicine,
    dosage: prescription.dosage,
    duration: prescription.duration,
    status: prescription.status,
    date: prescription.date,
    instructions: prescription.instructions ?? fallbackPrescriptions.find((item) => item.id === prescription.id)?.instructions ?? '',
  }));
}

function mapRelationalInvoices(
  organization: RelationalClinicOrganization,
  fallbackInvoices: ClinicInvoice[]
): ClinicInvoice[] {
  if (!organization.clinicInvoices.length) {
    return fallbackInvoices;
  }

  return organization.clinicInvoices.map((invoice) => ({
    id: invoice.id,
    patientId: invoice.patientId || undefined,
    billToName: invoice.billToName,
    date: invoice.date,
    amount: invoice.amount,
    status: invoice.status as ClinicInvoice['status'],
    items: toJsonArray(invoice.items, []),
  }));
}

function mapRelationalForms(
  organization: RelationalClinicOrganization,
  fallbackForms: ClinicForm[]
): ClinicForm[] {
  if (!organization.clinicForms.length) {
    return fallbackForms;
  }

  return organization.clinicForms.map((form) => ({
    id: form.id,
    patientId: form.patientId || undefined,
    patient: form.patient,
    type: form.type,
    status: form.status,
    owner: form.owner,
    updated: form.updated,
  }));
}

function mapRelationalSickLeaves(
  organization: RelationalClinicOrganization,
  fallbackSickLeaves: ClinicSickLeave[]
): ClinicSickLeave[] {
  if (!organization.clinicSickLeaves.length) {
    return fallbackSickLeaves;
  }

  return organization.clinicSickLeaves.map((leave) => ({
    id: leave.id,
    patientId: leave.patientId || undefined,
    doctorId: leave.doctorId || undefined,
    patient: leave.patient,
    doctor: leave.doctor,
    diagnosis: leave.diagnosis,
    start: leave.start,
    end: leave.end,
    status: leave.status,
  }));
}

function mapRelationalReports(
  organization: RelationalClinicOrganization,
  fallbackReports: ClinicReport[]
): ClinicReport[] {
  if (!organization.clinicReports.length) {
    return fallbackReports;
  }

  return organization.clinicReports.map((report) => ({
    id: report.id,
    name: report.name,
    type: report.type,
    range: report.range,
    format: report.format,
  }));
}

function mapRelationalFinanceEntries(
  organization: RelationalClinicOrganization,
  fallbackEntries: ClinicFinanceEntry[]
): ClinicFinanceEntry[] {
  if (!organization.clinicFinanceEntries.length) {
    return fallbackEntries;
  }

  return organization.clinicFinanceEntries.map((entry) => ({
    id: entry.id,
    type: entry.type as ClinicFinanceEntry['type'],
    date: entry.date,
    category: entry.category,
    description: entry.description,
    party: entry.party,
    owner: entry.owner,
    amount: Number(entry.amount),
    status: entry.status as ClinicFinanceEntry['status'],
    frequency: entry.frequency as ClinicFinanceEntry['frequency'],
  }));
}

function mapRelationalOrganizationProfile(
  organization: RelationalClinicOrganization,
  fallbackProfile: ClinicOrganizationProfile
): ClinicOrganizationProfile {
  return {
    name: organization.name || fallbackProfile.name,
    legalName: organization.legalName || fallbackProfile.legalName,
    contact: organization.contactPhone || fallbackProfile.contact,
    license: organization.licenseNumber || fallbackProfile.license,
    aiMemory: fallbackProfile.aiMemory,
    assistantMessages: toAssistantMessages(
      organization.assistantMessages,
      fallbackProfile.assistantMessages || []
    ),
    assistantSessions: toAssistantSessions(fallbackProfile.assistantSessions),
    assistantProjects: toAssistantProjects(fallbackProfile.assistantProjects),
    doctorProfileNotifications: toDoctorProfileNotifications(
      organization.doctorProfileNotifications,
      fallbackProfile.doctorProfileNotifications || []
    ),
  };
}

function mapRelationalClinicState(
  legacyState: ClinicWorkspaceState,
  organization: RelationalClinicOrganization | null | undefined
) {
  if (!organization) {
    return legacyState;
  }

  const organizationProfile = mapRelationalOrganizationProfile(
    organization,
    legacyState.organizationProfile
  );
  const patients = mapRelationalPatients(organization, legacyState.patients);
  const patientProfiles = mapRelationalPatientProfiles(organization, legacyState.patientProfiles);
  const patientPayments = mapRelationalPatientPayments(organization, legacyState.patientPayments);
  const doctors = mapRelationalDoctors(organization, legacyState.doctors);
  const appointments = mapRelationalAppointments(organization, legacyState.appointments);
  const revenueData = mapRelationalRevenuePoints(organization, legacyState.revenueData);
  const procedures = mapRelationalProcedures(organization, legacyState.procedures);
  const diagnoses = mapRelationalDiagnoses(organization, legacyState.diagnoses);
  const symptoms = mapRelationalSymptoms(organization, legacyState.symptoms);
  const prescriptions = mapRelationalPrescriptions(organization, legacyState.prescriptions);
  const invoices = mapRelationalInvoices(organization, legacyState.invoices);
  const forms = mapRelationalForms(organization, legacyState.forms);
  const sickLeaves = mapRelationalSickLeaves(organization, legacyState.sickLeaves);
  const reports = mapRelationalReports(organization, legacyState.reports);
  const financeEntries = mapRelationalFinanceEntries(organization, legacyState.financeEntries);
  const fallbackBranches = legacyState.branches;
  const fallbackStaffUsers = legacyState.staffUsers;
  const branches = organization.branches.length
    ? organization.branches.map((branch): ClinicOrganizationBranch => ({
        id: branch.id,
        name: branch.name,
        city: branch.city,
        manager: branch.manager,
        status: toClinicBranchStatus(branch.status),
      }))
    : fallbackBranches;
  const branchIds = new Set(branches.map((branch) => branch.id));
  const primaryBranchId = branches[0]?.id || fallbackBranches[0]?.id || '';
  const staffUsers = organization.users.length
    ? organization.users.map((user, index): ClinicStaffUser => {
        const fallbackUser = fallbackStaffUsers.find((candidate) => (
          candidate.id === user.id || candidate.email.toLowerCase() === user.email.toLowerCase()
        ));
        const branchId = user.branchId && branchIds.has(user.branchId)
          ? user.branchId
          : fallbackUser?.branchId && branchIds.has(fallbackUser.branchId)
            ? fallbackUser.branchId
            : primaryBranchId;
        const defaultBranchId = user.defaultBranchId && branchIds.has(user.defaultBranchId)
          ? user.defaultBranchId
          : branchId;

        return {
          id: user.id,
          name: user.fullName,
          email: user.email,
          role: user.role,
          status: toClinicUserStatus(user.status),
          lastActive: formatLastActive(user.lastActiveAt, user.status),
          branchId,
          phone: normalizeStaffPhone(user.phone) || normalizeStaffPhone(fallbackUser?.phone),
          defaultBranchId,
          emailSignature: user.emailSignature ?? fallbackUser?.emailSignature ?? `${user.fullName}\n${user.role}\n${organizationProfile.name}`,
          preferences: {
            ...defaultPreferences,
            ...(fallbackUser?.preferences || {}),
            ...(toUserPreferences(user.preferences) || {}),
          },
        };
      })
    : fallbackStaffUsers;

  const clinicRoles = organization.clinicRoles.length
    ? organization.clinicRoles
    : legacyState.roles.map((role) => ({
        role: role.role,
        access: role.access,
        features: toRoleFeatures(
          legacyState.rolePermissions.find((permission) => permission.role === role.role)?.features
        ) as Prisma.JsonValue,
      }));

  const roles: ClinicRoleDefinition[] = clinicRoles.map((role) => ({
    role: role.role,
    access: role.access,
  }));
  const rolePermissions: ClinicRolePermission[] = clinicRoles.map((role) => ({
    role: role.role,
    features: toRoleFeatures(role.features),
  }));

  return normalizeClinicState({
    ...legacyState,
    patients,
    patientProfiles,
    patientPayments,
    appointments,
    revenueData,
    doctors,
    procedures,
    diagnoses,
    symptoms,
    prescriptions,
    invoices,
    forms,
    sickLeaves,
    reports,
    staffUsers,
    roles,
    rolePermissions,
    branches,
    organizationProfile,
    financeEntries,
  });
}

function buildAssistantSummary(state: ClinicWorkspaceState) {
  const totalOutstanding = state.patients.reduce((sum, patient) => sum + patient.balance, 0);
  const upcomingAppointments = state.appointments.filter((appointment) => (
    ['scheduled', 'arrived', 'in-progress'].includes(appointment.status)
  ));

  return `You have ${state.patients.length} patients, ${state.doctors.length} doctors, ${upcomingAppointments.length} active appointments, and ${formatCurrency(totalOutstanding)} still outstanding.`;
}

function buildPatientReply(state: ClinicWorkspaceState, query: string) {
  const normalizedQuery = query.toLowerCase();
  const patient = state.patients.find((candidate) => {
    const fullName = candidate.name.toLowerCase();
    const nameParts = fullName.split(/\s+/);
    return normalizedQuery.includes(fullName) || nameParts.some((part) => part.length > 2 && normalizedQuery.includes(part));
  });

  if (!patient) {
    return null;
  }

  const profile = state.patientProfiles.find((item) => item.patientId === patient.id);
  const latestDiagnosis = state.diagnoses
    .filter((item) => item.patientId === patient.id)
    .sort((first, second) => toTimestamp(second.date) - toTimestamp(first.date))[0];
  const latestPrescription = state.prescriptions
    .filter((item) => item.patientId === patient.id)
    .sort((first, second) => toTimestamp(second.date) - toTimestamp(first.date))[0];

  return `${patient.name} is ${patient.status} with an outstanding balance of ${formatCurrency(patient.balance)}. ${latestDiagnosis ? `Latest record: ${latestDiagnosis.diagnosis}${latestDiagnosis.tooth ? ` on ${latestDiagnosis.tooth}` : ''} by ${latestDiagnosis.doctor} on ${latestDiagnosis.date}.` : 'No diagnosis is recorded yet.'} ${latestPrescription ? `Latest prescription: ${latestPrescription.medicine} (${latestPrescription.status}).` : 'No prescription is recorded yet.'} ${profile?.nextAppointment ? `Next appointment: ${profile.nextAppointment}.` : 'No next appointment is scheduled.'}`;
}

function buildClinicAssistantContent(state: ClinicWorkspaceState, message: string) {
  const query = message.trim().toLowerCase();
  const patientReply = buildPatientReply(state, query);

  if (patientReply) {
    return patientReply;
  }

  if (query.includes('revenue') || query.includes('income') || query.includes('billing') || query.includes('balance')) {
    const collectedIncome = getCollectedRevenue(state);
    const outstandingBalance = state.patients.reduce((sum, patient) => sum + patient.balance, 0);
    const unpaidInvoices = state.invoices.filter((invoice) => invoice.status !== 'paid').length;

    return `Collected income recorded so far is ${formatCurrency(collectedIncome)}. Patients still owe ${formatCurrency(outstandingBalance)}, and ${unpaidInvoices} invoices are not fully paid yet.`;
  }

  if (query.includes('appointment') || query.includes('follow-up') || query.includes('visit') || query.includes('schedule')) {
    const activeAppointments = state.appointments
      .filter((appointment) => ['scheduled', 'arrived', 'in-progress'].includes(appointment.status))
      .sort((first, second) => toTimestamp(`${first.date}T${first.time}`) - toTimestamp(`${second.date}T${second.time}`));
    const nextThree = activeAppointments.slice(0, 3).map((appointment) => (
      `${appointment.patientName} with ${appointment.doctorName} on ${appointment.date} at ${appointment.time}`
    ));

    return nextThree.length
      ? `There are ${activeAppointments.length} active appointments. Next up: ${nextThree.join('; ')}.`
      : 'There are no active appointments scheduled right now.';
  }

  if (query.includes('doctor') || query.includes('dentist') || query.includes('provider')) {
    const availableDoctors = state.doctors.filter((doctor) => doctor.availability === 'Available');
    const topDoctor = [...state.doctors].sort((first, second) => second.revenue - first.revenue)[0];

    return `${availableDoctors.length} doctors are currently marked available. ${topDoctor ? `${topDoctor.name} is leading revenue with ${formatCurrency(topDoctor.revenue)} and ${topDoctor.assignedPatients} assigned patients.` : 'No doctor performance data is available yet.'}`;
  }

  if (query.includes('record') || query.includes('note') || query.includes('form')) {
    const openForms = state.forms.filter((form) => form.status !== 'Signed').length;
    const patientNotes = state.patients.reduce((sum, patient) => sum + (patient.notes?.length || 0), 0);
    const recentDiagnosis = [...state.diagnoses].sort((first, second) => toTimestamp(second.date) - toTimestamp(first.date))[0];

    return `There are ${openForms} forms still waiting on completion, ${patientNotes} saved patient notes, and ${recentDiagnosis ? `the latest diagnosis is ${recentDiagnosis.diagnosis} for ${recentDiagnosis.patient}.` : 'no diagnoses recorded yet.'}`;
  }

  return buildAssistantSummary(state);
}

function buildClinicOwner(state: ClinicWorkspaceState) {
  const ownerUser = state.staffUsers.find((user) => user.role.toLowerCase().includes('admin'))
    || state.staffUsers[0];

  return {
    owner: ownerUser?.name || state.organizationProfile.name || 'Clinic Owner',
    ownerEmail: ownerUser?.email?.trim().toLowerCase() || '',
  };
}

function buildClinicRoleRows(state: ClinicWorkspaceState) {
  const defaultAccessByRole = new Map(clinicSeedState.roles.map((role) => [role.role, role.access]));
  const defaultFeaturesByRole = new Map(clinicSeedState.rolePermissions.map((permission) => [permission.role, permission.features]));
  const roleRows = new Map<string, { access: string; features: string[] }>();

  state.roles.forEach((role) => {
    roleRows.set(role.role, {
      access: role.access,
      features: [...new Set(defaultFeaturesByRole.get(role.role) || [])],
    });
  });

  state.rolePermissions.forEach((permission) => {
    const existing = roleRows.get(permission.role);
    roleRows.set(permission.role, {
      access: existing?.access || defaultAccessByRole.get(permission.role) || 'Custom workspace access',
      features: [...new Set(permission.features)],
    });
  });

  state.staffUsers.forEach((user) => {
    const existing = roleRows.get(user.role);
    roleRows.set(user.role, {
      access: existing?.access || defaultAccessByRole.get(user.role) || 'Custom workspace access',
      features: existing?.features || [...new Set(defaultFeaturesByRole.get(user.role) || [])],
    });
  });

  return [...roleRows.entries()]
    .map(([role, value]) => ({
      role,
      access: value.access,
      features: [...new Set(value.features)].sort(),
    }))
    .sort((left, right) => left.role.localeCompare(right.role));
}

function countPatientsByBranch(state: ClinicWorkspaceState) {
  const branchCounts = new Map<string, number>();

  state.patientProfiles.forEach((profile) => {
    branchCounts.set(profile.branchId, (branchCounts.get(profile.branchId) || 0) + 1);
  });

  return branchCounts;
}

function computeDashboardMetrics(state: ClinicWorkspaceState) {
  const today = getLocalDateKey();

  return {
    appointmentsToday: state.appointments.filter((appointment) => appointment.date === today).length,
    monthlyRevenue: getCollectedRevenue(state),
    pendingForms: state.forms.filter((form) => form.status !== 'Signed').length,
  };
}

async function queryClinicState(organizationId: string): Promise<ClinicWorkspaceState> {
  const record = await prisma.clinicWorkspaceState.findUnique({
    where: { organizationId },
    include: {
      organization: {
        include: {
          branches: {
            orderBy: { createdAt: 'asc' },
          },
          clinicAppointments: {
            orderBy: { createdAt: 'asc' },
          },
          clinicDiagnoses: {
            orderBy: { createdAt: 'asc' },
          },
          clinicDoctors: {
            orderBy: { createdAt: 'asc' },
          },
          clinicFinanceEntries: {
            orderBy: { createdAt: 'asc' },
          },
          clinicForms: {
            orderBy: { createdAt: 'asc' },
          },
          clinicInvoices: {
            orderBy: { createdAt: 'asc' },
          },
          clinicPatientPayments: {
            orderBy: { createdAt: 'asc' },
          },
          clinicPatientProfiles: {
            orderBy: { createdAt: 'asc' },
          },
          clinicPatients: {
            orderBy: { createdAt: 'asc' },
          },
          clinicPrescriptions: {
            orderBy: { createdAt: 'asc' },
          },
          clinicProcedures: {
            orderBy: { createdAt: 'asc' },
          },
          clinicReports: {
            orderBy: { createdAt: 'asc' },
          },
          clinicRevenuePoints: {
            orderBy: { sortOrder: 'asc' },
          },
          clinicSickLeaves: {
            orderBy: { createdAt: 'asc' },
          },
          clinicSymptoms: {
            orderBy: { createdAt: 'asc' },
          },
          users: {
            orderBy: { createdAt: 'asc' },
          },
          clinicRoles: {
            orderBy: { role: 'asc' },
          },
        },
      },
    },
  }) as ClinicWorkspaceRecord | null;

  if (!record) {
    if (organizationId === clinicOrganizationId) {
      return replaceClinicState(clinicSeedState, organizationId);
    }

    throw new Error(`Clinic workspace for organization ${organizationId} was not found.`);
  }

  const legacyState = mapLegacyClinicState(record);

  if (!record.organizationId || !record.organization) {
    return replaceClinicState(legacyState, organizationId);
  }

  const shouldBackfillCoreRecords = (
    (record.organization.clinicPatients.length === 0 && legacyState.patients.length > 0)
    || (record.organization.clinicPatientProfiles.length === 0 && legacyState.patientProfiles.length > 0)
    || (record.organization.clinicPatientPayments.length === 0 && legacyState.patientPayments.length > 0)
    || (record.organization.clinicDoctors.length === 0 && legacyState.doctors.length > 0)
    || (record.organization.clinicAppointments.length === 0 && legacyState.appointments.length > 0)
    || (record.organization.clinicRevenuePoints.length === 0 && legacyState.revenueData.length > 0)
    || (record.organization.clinicProcedures.length === 0 && legacyState.procedures.length > 0)
    || (record.organization.clinicDiagnoses.length === 0 && legacyState.diagnoses.length > 0)
    || (record.organization.clinicSymptoms.length === 0 && legacyState.symptoms.length > 0)
    || (record.organization.clinicPrescriptions.length === 0 && legacyState.prescriptions.length > 0)
    || (record.organization.clinicInvoices.length === 0 && legacyState.invoices.length > 0)
    || (record.organization.clinicForms.length === 0 && legacyState.forms.length > 0)
    || (record.organization.clinicSickLeaves.length === 0 && legacyState.sickLeaves.length > 0)
    || (record.organization.clinicReports.length === 0 && legacyState.reports.length > 0)
    || (record.organization.clinicFinanceEntries.length === 0 && legacyState.financeEntries.length > 0)
  );

  if (shouldBackfillCoreRecords) {
    return replaceClinicState(legacyState, organizationId);
  }

  return mapRelationalClinicState(legacyState, record.organization);
}

export async function ensureClinicStateSeeded() {
  const workspace = await prisma.clinicWorkspaceState.findUnique({
    where: { organizationId: clinicOrganizationId },
    select: { id: true },
  });

  if (!workspace) {
    await replaceClinicState(clinicSeedState, clinicOrganizationId);
  }
}

export async function getClinicState(organizationId = clinicOrganizationId) {
  if (organizationId === clinicOrganizationId) {
    await ensureClinicStateSeeded();
  }

  return queryClinicState(organizationId);
}

export async function replaceClinicState(state: ClinicWorkspaceState, organizationId = clinicOrganizationId) {
  const nextState = normalizeClinicState(state);
  await ensureAdminStateSeeded();
  const defaultPlan = await prisma.plan.findFirst({
    orderBy: { createdAt: 'asc' },
    select: { id: true },
  });

  if (!defaultPlan) {
    throw new Error('Unable to seed the clinic workspace without a default plan.');
  }

  const branchPatientCounts = countPatientsByBranch(nextState);
  const roleRows = buildClinicRoleRows(nextState);
  const { owner, ownerEmail } = buildClinicOwner(nextState);
  const dashboardMetrics = computeDashboardMetrics(nextState);
  const dueDate = new Date();
  dueDate.setDate(dueDate.getDate() + 30);
  const { organizationId: targetOrganizationId, workspaceId } = getClinicWorkspaceScope(organizationId);

  await prisma.$transaction(async (transaction) => {
    await transaction.organization.upsert({
      where: { id: targetOrganizationId },
      update: {
        name: nextState.organizationProfile.name,
        legalName: nextState.organizationProfile.legalName,
        owner,
        ownerEmail,
        contactPhone: nextState.organizationProfile.contact,
        licenseNumber: nextState.organizationProfile.license,
        assistantMessages: nextState.organizationProfile.assistantMessages?.length
          ? toJsonValue(nextState.organizationProfile.assistantMessages)
          : Prisma.DbNull,
        doctorProfileNotifications: nextState.organizationProfile.doctorProfileNotifications?.length
          ? toJsonValue(nextState.organizationProfile.doctorProfileNotifications)
          : Prisma.DbNull,
        dashboardAppointmentsToday: dashboardMetrics.appointmentsToday,
        dashboardMonthlyRevenue: dashboardMetrics.monthlyRevenue,
        dashboardPendingForms: dashboardMetrics.pendingForms,
      },
      create: {
        id: targetOrganizationId,
        name: nextState.organizationProfile.name,
        legalName: nextState.organizationProfile.legalName,
        owner,
        ownerEmail,
        contactPhone: nextState.organizationProfile.contact,
        licenseNumber: nextState.organizationProfile.license,
        assistantMessages: nextState.organizationProfile.assistantMessages?.length
          ? toJsonValue(nextState.organizationProfile.assistantMessages)
          : Prisma.DbNull,
        doctorProfileNotifications: nextState.organizationProfile.doctorProfileNotifications?.length
          ? toJsonValue(nextState.organizationProfile.doctorProfileNotifications)
          : Prisma.DbNull,
        planId: defaultPlan.id,
        status: defaultOrganizationStatusForScope(targetOrganizationId),
        paymentStatus: 'paid',
        dueDate,
        aiResetDate: dueDate,
        dashboardAppointmentsToday: dashboardMetrics.appointmentsToday,
        dashboardMonthlyRevenue: dashboardMetrics.monthlyRevenue,
        dashboardPendingForms: dashboardMetrics.pendingForms,
      },
    });

    for (const branch of nextState.branches) {
      await transaction.branch.upsert({
        where: { id: branch.id },
        update: {
          organizationId: targetOrganizationId,
          name: branch.name,
          city: branch.city,
          manager: branch.manager,
          patientsCount: branchPatientCounts.get(branch.id) || 0,
          status: toDatabaseBranchStatus(branch.status),
        },
        create: {
          id: branch.id,
          organizationId: targetOrganizationId,
          name: branch.name,
          city: branch.city,
          manager: branch.manager,
          patientsCount: branchPatientCounts.get(branch.id) || 0,
          status: toDatabaseBranchStatus(branch.status),
        },
      });
    }

    await transaction.clinicAppointment.deleteMany({
      where: { organizationId: targetOrganizationId },
    });
    await transaction.clinicDiagnosis.deleteMany({
      where: { organizationId: targetOrganizationId },
    });
    await transaction.clinicSymptom.deleteMany({
      where: { organizationId: targetOrganizationId },
    });
    await transaction.clinicPrescription.deleteMany({
      where: { organizationId: targetOrganizationId },
    });
    await transaction.clinicInvoice.deleteMany({
      where: { organizationId: targetOrganizationId },
    });
    await transaction.clinicForm.deleteMany({
      where: { organizationId: targetOrganizationId },
    });
    await transaction.clinicSickLeave.deleteMany({
      where: { organizationId: targetOrganizationId },
    });
    await transaction.clinicPatientPayment.deleteMany({
      where: { organizationId: targetOrganizationId },
    });
    await transaction.clinicPatientProfile.deleteMany({
      where: { organizationId: targetOrganizationId },
    });
    await transaction.clinicPatient.deleteMany({
      where: { organizationId: targetOrganizationId },
    });
    await transaction.clinicDoctor.deleteMany({
      where: { organizationId: targetOrganizationId },
    });
    await transaction.clinicProcedure.deleteMany({
      where: { organizationId: targetOrganizationId },
    });
    await transaction.clinicReport.deleteMany({
      where: { organizationId: targetOrganizationId },
    });
    await transaction.clinicFinanceEntry.deleteMany({
      where: { organizationId: targetOrganizationId },
    });
    await transaction.clinicRevenuePoint.deleteMany({
      where: { organizationId: targetOrganizationId },
    });

    for (const point of nextState.revenueData) {
      await transaction.clinicRevenuePoint.create({
        data: {
          organizationId: targetOrganizationId,
          name: point.name,
          revenue: point.revenue,
          patients: point.patients,
          sortOrder: nextState.revenueData.indexOf(point),
        },
      });
    }

    for (const procedure of nextState.procedures) {
      await transaction.clinicProcedure.create({
        data: {
          id: procedure.id,
          organizationId: targetOrganizationId,
          name: procedure.name,
          category: procedure.category,
          cost: procedure.cost,
          duration: procedure.duration,
          followUp: procedure.followUp,
          patient: procedure.patient,
          doctor: procedure.doctor,
        },
      });
    }

    for (const doctor of nextState.doctors) {
      await transaction.clinicDoctor.create({
        data: {
          id: doctor.id,
          organizationId: targetOrganizationId,
          name: doctor.name,
          specialty: doctor.specialty,
          schedule: doctor.schedule,
          availability: doctor.availability,
          assignedPatients: doctor.assignedPatients,
          revenue: doctor.revenue,
          procedures: doctor.procedures,
          rating: doctor.rating,
          weeklyAvailability: toJsonValue(doctor.weeklyAvailability || []),
        },
      });
    }

    for (const patient of nextState.patients) {
      await transaction.clinicPatient.create({
        data: {
          id: patient.id,
          organizationId: targetOrganizationId,
          name: patient.name,
          age: patient.age,
          gender: patient.gender,
          phone: patient.phone,
          email: normalizePatientEmail(patient.email),
          lastVisit: patient.lastVisit,
          status: patient.status,
          balance: patient.balance,
          medicalHistory: toJsonValue(patient.medicalHistory || []),
          dentalChart: toJsonValue(patient.dentalChart || []),
          notes: toJsonValue(patient.notes || []),
          emergencyContacts: toJsonValue(patient.emergencyContacts || []),
        },
      });
    }

    for (const profile of nextState.patientProfiles) {
      await transaction.clinicPatientProfile.create({
        data: {
          patientId: profile.patientId,
          organizationId: targetOrganizationId,
          directoryId: profile.directoryId,
          dob: profile.dob,
          address: normalizePatientAddress(profile.address),
          branchId: profile.branchId,
          branchName: profile.branchName,
          bloodGroup: profile.bloodGroup,
          nextAppointment: profile.nextAppointment || null,
          paymentPlan: toJsonValue(profile.paymentPlan),
          pendingAmount: profile.pendingAmount,
          recordCount: profile.recordCount,
          cardNumber: profile.cardNumber,
          registrationTime: profile.registrationTime,
        },
      });
    }

    for (const payment of nextState.patientPayments) {
      await transaction.clinicPatientPayment.create({
        data: {
          id: payment.id,
          organizationId: targetOrganizationId,
          patientId: payment.patientId,
          date: payment.date,
          amount: payment.amount,
          method: payment.method,
          receivedBy: payment.receivedBy,
          note: payment.note,
        },
      });
    }

    for (const appointment of nextState.appointments) {
      await transaction.clinicAppointment.create({
        data: {
          id: appointment.id,
          organizationId: targetOrganizationId,
          patientId: appointment.patientId,
          doctorId: appointment.doctorId,
          patientName: appointment.patientName,
          doctorName: appointment.doctorName,
          date: appointment.date,
          time: appointment.time,
          duration: appointment.duration,
          type: appointment.type,
          status: appointment.status,
          reason: appointment.reason || null,
          createdNow: appointment.createdNow ?? false,
        },
      });
    }

    for (const diagnosis of nextState.diagnoses) {
      await transaction.clinicDiagnosis.create({
        data: {
          id: diagnosis.id,
          organizationId: targetOrganizationId,
          patientId: diagnosis.patientId || null,
          doctorId: diagnosis.doctorId || null,
          patient: diagnosis.patient,
          tooth: diagnosis.tooth,
          diagnosis: diagnosis.diagnosis,
          severity: diagnosis.severity,
          date: diagnosis.date,
          doctor: diagnosis.doctor,
          complaint: diagnosis.complaint || null,
          doctorAction: diagnosis.doctorAction || null,
          medicine: diagnosis.medicine || null,
          followUp: diagnosis.followUp || null,
          attachments: toJsonValue(diagnosis.attachments || []),
        },
      });
    }

    for (const symptom of nextState.symptoms) {
      await transaction.clinicSymptom.create({
        data: {
          id: symptom.id,
          organizationId: targetOrganizationId,
          patientId: symptom.patientId || null,
          patient: symptom.patient,
          date: symptom.date,
          tooth: symptom.tooth,
          pain: symptom.pain,
          sensitivity: symptom.sensitivity,
          bleeding: symptom.bleeding,
          swelling: symptom.swelling,
          infection: symptom.infection,
          notes: symptom.notes,
        },
      });
    }

    for (const prescription of nextState.prescriptions) {
      await transaction.clinicPrescription.create({
        data: {
          id: prescription.id,
          organizationId: targetOrganizationId,
          patientId: prescription.patientId || null,
          doctorId: prescription.doctorId || null,
          patient: prescription.patient,
          doctor: prescription.doctor,
          medicine: prescription.medicine,
          dosage: prescription.dosage,
          duration: prescription.duration,
          status: prescription.status,
          date: prescription.date,
          instructions: prescription.instructions || null,
        },
      });
    }

    for (const invoice of nextState.invoices) {
      await transaction.clinicInvoice.create({
        data: {
          id: invoice.id,
          organizationId: targetOrganizationId,
          patientId: invoice.patientId || null,
          billToName: invoice.billToName,
          date: invoice.date,
          amount: invoice.amount,
          status: invoice.status,
          items: toJsonValue(invoice.items || []),
        },
      });
    }

    for (const form of nextState.forms) {
      await transaction.clinicForm.create({
        data: {
          id: form.id,
          organizationId: targetOrganizationId,
          patientId: form.patientId || null,
          patient: form.patient,
          type: form.type,
          status: form.status,
          owner: form.owner,
          updated: form.updated,
        },
      });
    }

    for (const leave of nextState.sickLeaves) {
      await transaction.clinicSickLeave.create({
        data: {
          id: leave.id,
          organizationId: targetOrganizationId,
          patientId: leave.patientId || null,
          doctorId: leave.doctorId || null,
          patient: leave.patient,
          doctor: leave.doctor,
          diagnosis: leave.diagnosis,
          start: leave.start,
          end: leave.end,
          status: leave.status,
        },
      });
    }

    for (const report of nextState.reports) {
      await transaction.clinicReport.create({
        data: {
          id: report.id,
          organizationId: targetOrganizationId,
          name: report.name,
          type: report.type,
          range: report.range,
          format: report.format,
        },
      });
    }

    for (const entry of nextState.financeEntries) {
      await transaction.clinicFinanceEntry.create({
        data: {
          id: entry.id,
          organizationId: targetOrganizationId,
          type: entry.type,
          date: entry.date,
          category: entry.category,
          description: entry.description,
          party: entry.party,
          owner: entry.owner,
          amount: entry.amount,
          status: entry.status,
          frequency: entry.frequency,
        },
      });
    }

    for (const role of roleRows) {
      await transaction.clinicRole.upsert({
        where: {
          organizationId_role: {
            organizationId: targetOrganizationId,
            role: role.role,
          },
        },
        update: {
          access: role.access,
          features: toJsonValue(role.features),
        },
        create: {
          organizationId: targetOrganizationId,
          role: role.role,
          access: role.access,
          features: toJsonValue(role.features),
        },
      });
    }

    if (roleRows.length > 0) {
      await transaction.clinicRole.deleteMany({
        where: {
          organizationId: targetOrganizationId,
          role: {
            notIn: roleRows.map((role) => role.role),
          },
        },
      });
    } else {
      await transaction.clinicRole.deleteMany({
        where: { organizationId: targetOrganizationId },
      });
    }

    const knownEmails = nextState.staffUsers.map((user) => user.email.trim().toLowerCase());
    const existingUsers = await transaction.user.findMany({
      where: {
        OR: [
          { organizationId: targetOrganizationId },
          { email: { in: knownEmails } },
        ],
      },
    });
    const validBranchIds = new Set(nextState.branches.map((branch) => branch.id));
    const fallbackBranchId = nextState.branches[0]?.id || null;
    const retainedUserIds: string[] = [];

    for (const user of nextState.staffUsers) {
      const normalizedEmail = user.email.trim().toLowerCase();
      const existingUser = existingUsers.find((candidate) => (
        candidate.id === user.id || candidate.email.toLowerCase() === normalizedEmail
      ));
      const branchId = user.branchId && validBranchIds.has(user.branchId)
        ? user.branchId
        : fallbackBranchId;
      const defaultBranchId = user.defaultBranchId && validBranchIds.has(user.defaultBranchId)
        ? user.defaultBranchId
        : branchId;
      const nextStatus = toDatabaseUserStatus(user.status);
      const nextLastActiveAt = nextStatus === 'active'
        ? existingUser?.lastActiveAt || new Date()
        : null;

      if (existingUser) {
        retainedUserIds.push(existingUser.id);
        await transaction.user.update({
          where: { id: existingUser.id },
          data: {
            organizationId: targetOrganizationId,
            branchId,
            defaultBranchId,
            email: normalizedEmail,
            fullName: user.name.trim() || normalizedEmail,
            role: user.role.trim() || genericClinicRole,
            status: nextStatus,
            phone: user.phone?.trim() || null,
            emailSignature: user.emailSignature?.trim() || `${user.name}\n${user.role}\n${nextState.organizationProfile.name}`,
            preferences: user.preferences ? toJsonValue(user.preferences) : Prisma.DbNull,
            lastActiveAt: nextLastActiveAt,
          },
        });
      } else {
        retainedUserIds.push(user.id);
        await transaction.user.create({
          data: {
            id: user.id,
            organizationId: targetOrganizationId,
            branchId,
            defaultBranchId,
            email: normalizedEmail,
            fullName: user.name.trim() || normalizedEmail,
            role: user.role.trim() || genericClinicRole,
            status: nextStatus,
            phone: user.phone?.trim() || null,
            emailSignature: user.emailSignature?.trim() || `${user.name}\n${user.role}\n${nextState.organizationProfile.name}`,
            preferences: user.preferences ? toJsonValue(user.preferences) : Prisma.DbNull,
            lastActiveAt: nextLastActiveAt,
          },
        });
      }
    }

    if (retainedUserIds.length > 0) {
      await transaction.user.deleteMany({
        where: {
          organizationId: targetOrganizationId,
          id: {
            notIn: retainedUserIds,
          },
        },
      });
    } else {
      await transaction.user.deleteMany({
        where: { organizationId: targetOrganizationId },
      });
    }

    if (nextState.branches.length > 0) {
      await transaction.branch.deleteMany({
        where: {
          organizationId: targetOrganizationId,
          id: {
            notIn: nextState.branches.map((branch) => branch.id),
          },
        },
      });
    } else {
      await transaction.branch.deleteMany({
        where: { organizationId: targetOrganizationId },
      });
    }

    await transaction.clinicWorkspaceState.upsert({
      where: { organizationId: targetOrganizationId },
      update: {
        organizationId: targetOrganizationId,
        patients: toJsonValue(nextState.patients),
        patientProfiles: toJsonValue(nextState.patientProfiles),
        patientPayments: toJsonValue(nextState.patientPayments),
        appointments: toJsonValue(nextState.appointments),
        revenueData: toJsonValue(nextState.revenueData),
        doctors: toJsonValue(nextState.doctors),
        procedures: toJsonValue(nextState.procedures),
        diagnoses: toJsonValue(nextState.diagnoses),
        symptoms: toJsonValue(nextState.symptoms),
        prescriptions: toJsonValue(nextState.prescriptions),
        invoices: toJsonValue(nextState.invoices),
        forms: toJsonValue(nextState.forms),
        sickLeaves: toJsonValue(nextState.sickLeaves),
        reports: toJsonValue(nextState.reports),
        staffUsers: toJsonValue(nextState.staffUsers),
        roles: toJsonValue(nextState.roles),
        rolePermissions: toJsonValue(nextState.rolePermissions),
        branches: toJsonValue(nextState.branches),
        organizationProfile: toJsonValue(nextState.organizationProfile),
        financeEntries: toJsonValue(nextState.financeEntries),
      },
      create: {
        id: workspaceId,
        organizationId: targetOrganizationId,
        patients: toJsonValue(nextState.patients),
        patientProfiles: toJsonValue(nextState.patientProfiles),
        patientPayments: toJsonValue(nextState.patientPayments),
        appointments: toJsonValue(nextState.appointments),
        revenueData: toJsonValue(nextState.revenueData),
        doctors: toJsonValue(nextState.doctors),
        procedures: toJsonValue(nextState.procedures),
        diagnoses: toJsonValue(nextState.diagnoses),
        symptoms: toJsonValue(nextState.symptoms),
        prescriptions: toJsonValue(nextState.prescriptions),
        invoices: toJsonValue(nextState.invoices),
        forms: toJsonValue(nextState.forms),
        sickLeaves: toJsonValue(nextState.sickLeaves),
        reports: toJsonValue(nextState.reports),
        staffUsers: toJsonValue(nextState.staffUsers),
        roles: toJsonValue(nextState.roles),
        rolePermissions: toJsonValue(nextState.rolePermissions),
        branches: toJsonValue(nextState.branches),
        organizationProfile: toJsonValue(nextState.organizationProfile),
        financeEntries: toJsonValue(nextState.financeEntries),
      },
    });
  }, {
    maxWait: 20000,
    timeout: 60000,
  });

  return queryClinicState(targetOrganizationId);
}

function buildAssistantSessionTitle(message: string) {
  const normalized = message.replace(/\s+/g, ' ').trim();
  return normalized.length > 42 ? `${normalized.slice(0, 42).trimEnd()}...` : normalized || 'New chat';
}

/**
 * Narrow update of the workspace organizationProfile Json column against a
 * fresh read. The assistant endpoints must NOT use replaceClinicState: that
 * full read-modify-write spans the multi-second AI call and clobbers any
 * workspace changes the frontend autosaves in the meantime.
 */
async function updateClinicOrganizationProfileColumn(
  organizationId: string,
  mutate: (profile: ClinicOrganizationProfile) => ClinicOrganizationProfile
) {
  const record = await prisma.clinicWorkspaceState.findUnique({
    where: { organizationId },
    select: { id: true, organizationProfile: true },
  });

  if (!record) {
    return false;
  }

  const currentProfile = record.organizationProfile
    && typeof record.organizationProfile === 'object'
    && !Array.isArray(record.organizationProfile)
    ? record.organizationProfile as unknown as ClinicOrganizationProfile
    : { name: '', legalName: '', contact: '', license: '' } as ClinicOrganizationProfile;

  await prisma.clinicWorkspaceState.update({
    where: { id: record.id },
    data: { organizationProfile: toJsonValue(mutate(currentProfile)) },
  });

  return true;
}

export async function generateClinicAssistantReply(
  message: string,
  organizationId = clinicOrganizationId,
  sessionId?: string,
  attachments?: ClinicAssistantAttachment[]
): Promise<ClinicAssistantReplyResult> {
  const state = await getClinicState(organizationId);
  const sessions = state.organizationProfile.assistantSessions || [];
  const activeSession = sessionId
    ? sessions.find((session) => session.id === sessionId)
    : undefined;
  // Greetings get an instant friendly reply; off-topic requests with no
  // attachments never reach the LLM at all.
  const isCourtesy = !attachments?.length && isConversationalCourtesy(message);
  const skipAI = !attachments?.length && !isCourtesy && !isClinicScopedMessage(state, message);
  const enrichedAttachments = attachments?.length && !skipAI
    ? await extractAttachmentContents(attachments)
    : attachments;
  const aiResult = skipAI || isCourtesy
    ? null
    : await requestClinicAssistantAI(
        state,
        message,
        state.organizationProfile.aiMemory,
        activeSession?.messages,
        enrichedAttachments
      );
  const replyTimestamp = new Date().toISOString();
  const trimmedMessage = message.trim();
  const replyMessage: ClinicAssistantMessage = {
    id: `assistant-${Date.now()}`,
    role: 'assistant',
    content: isCourtesy
      ? clinicAssistantGreetingReply
      : skipAI
        ? clinicAssistantOffTopicReply
        : aiResult?.reply || buildClinicFallbackAssistantContent(state, message, attachments),
    timestamp: replyTimestamp,
  };
  const userMessage: ClinicAssistantMessage = {
    id: `user-${Date.now()}`,
    role: 'user',
    content: trimmedMessage,
    timestamp: replyTimestamp,
    ...(attachments?.length ? { attachments } : {}),
  };
  const memory = aiResult?.memory || buildClinicFallbackMemory(
    state,
    state.organizationProfile.aiMemory
  );

  // Prefer the short AI-generated topic label over the truncated user prompt.
  const aiSessionTitle = aiResult?.sessionTitle?.trim() || '';

  // Apply the conversation delta to a FRESH profile read so chats and
  // projects created while the AI call was in flight are never clobbered.
  const applyReplyToProfile = (profile: ClinicOrganizationProfile): ClinicOrganizationProfile => {
    let profileUpdate: Partial<ClinicOrganizationProfile>;

    if (sessionId) {
      const freshSessions = profile.assistantSessions || [];
      const freshActiveSession = freshSessions.find((session) => session.id === sessionId);
      const nextSessions = freshActiveSession
        ? freshSessions.map((session) => {
            if (session.id !== sessionId) {
              return session;
            }

            const alreadyHasPrompt = session.messages.some((entry) => (
              entry.role === 'user' && entry.content.trim() === trimmedMessage
            ));
            // Only auto-derived titles get replaced — user renames are kept.
            const titleIsAuto = !session.title.trim()
              || session.title === 'New chat'
              || session.title === buildAssistantSessionTitle(trimmedMessage);

            return {
              ...session,
              title: titleIsAuto
                ? (aiSessionTitle || buildAssistantSessionTitle(trimmedMessage))
                : session.title,
              updatedAt: replyTimestamp,
              messages: [
                ...session.messages,
                ...(alreadyHasPrompt ? [] : [userMessage]),
                replyMessage,
              ],
            };
          })
        : [
            ...freshSessions,
            {
              id: sessionId,
              title: aiSessionTitle || buildAssistantSessionTitle(trimmedMessage),
              createdAt: replyTimestamp,
              updatedAt: replyTimestamp,
              messages: [userMessage, replyMessage],
            },
          ];

      profileUpdate = { assistantSessions: nextSessions };
    } else {
      const existingMessages = profile.assistantMessages || [];
      const alreadyHasPrompt = existingMessages.some((entry) => (
        entry.role === 'user' && entry.content.trim() === trimmedMessage
      ));

      profileUpdate = {
        assistantMessages: [
          ...existingMessages,
          ...(alreadyHasPrompt ? [] : [userMessage]),
          replyMessage,
        ],
      };
    }

    return {
      ...profile,
      aiMemory: memory,
      ...profileUpdate,
    };
  };

  const updated = await updateClinicOrganizationProfileColumn(organizationId, applyReplyToProfile);

  if (!updated) {
    // No workspace row yet (first-ever interaction) — fall back to seeding the
    // full state.
    await replaceClinicState({
      ...state,
      organizationProfile: applyReplyToProfile(state.organizationProfile),
    }, organizationId);
  }

  return {
    memory,
    message: replyMessage,
    ...(aiSessionTitle ? { sessionTitle: aiSessionTitle } : {}),
    model: aiResult?.model,
    source: aiResult?.source || 'fallback',
  };
}

export async function generateClinicReportInsights(
  organizationId = clinicOrganizationId
): Promise<ClinicReportInsightsResult> {
  const state = await getClinicState(organizationId);
  const existingMemory = state.organizationProfile.aiMemory;

  if (isClinicAIReportInsightSetFresh(existingMemory?.reportInsights)) {
    return {
      insights: existingMemory!.reportInsights!,
      memory: existingMemory!,
    };
  }

  const aiResult = await requestClinicReportInsightsAI(state, existingMemory);
  const insights = aiResult?.insights || buildClinicFallbackReportInsights(state);
  const memory: ClinicAIMemory = aiResult?.memory || buildClinicFallbackMemory(
    state,
    existingMemory,
    insights
  );
  const updated = await updateClinicOrganizationProfileColumn(organizationId, (profile) => ({
    ...profile,
    aiMemory: memory,
  }));

  if (!updated) {
    await replaceClinicState({
      ...state,
      organizationProfile: {
        ...state.organizationProfile,
        aiMemory: memory,
      },
    }, organizationId);
  }

  return {
    insights,
    memory,
  };
}
