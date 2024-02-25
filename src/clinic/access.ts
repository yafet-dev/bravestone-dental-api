/**
 * Server-side enforcement of {@link ./permissions}.
 *
 * The whole clinic workspace travels as one document: the browser GETs it and
 * PUTs it back. That shape makes two things mandatory here, and they have to be
 * built together:
 *
 *   1. **Reads are redacted.** {@link scopeClinicStateForAccess} removes what the
 *      caller's role may not see — money above all — before the payload leaves
 *      the server. The browser copy of the permission rules decides what to
 *      *draw*; this decides what exists to draw at all.
 *
 *   2. **Writes are merged, never replaced.** Because a caller holds a redacted
 *      copy, echoing it back would erase everything that was hidden from them.
 *      {@link mergeClinicStateForAccess} rebuilds the next state from the stored
 *      one and layers on only the slices that caller is allowed to write. The
 *      same pass is what stops privilege escalation: `roles`, `rolePermissions`,
 *      `branches`, and other people's staff records are simply never taken from
 *      a non-admin request, so nobody can PUT themselves a financial grant.
 */

import {
  CLINIC_FINANCES_PERMISSION,
  PATIENT_PAYMENTS_PERMISSION,
  WORKSPACE_FEATURES,
  canOpenFeature,
  hasFeature,
  hasMoneyScope,
  isPlatformOnlyRole,
  type MoneyPermission,
  type WorkspaceAccess,
  type WorkspaceFeature,
} from './permissions';
import type {
  ClinicOrganizationProfile,
  ClinicStaffUser,
  ClinicWorkspaceState,
} from './types';

type StateSlice = keyof ClinicWorkspaceState;

/**
 * Slices that are money and nothing but money, and which scope each one needs.
 * Readable only with that scope, whatever sections the role otherwise holds.
 */
const SLICE_MONEY_SCOPE: Partial<Record<StateSlice, MoneyPermission>> = {
  financeEntries: CLINIC_FINANCES_PERMISSION,
  invoices: PATIENT_PAYMENTS_PERMISSION,
  patientPayments: PATIENT_PAYMENTS_PERMISSION,
  revenueData: CLINIC_FINANCES_PERMISSION,
};

const FINANCIAL_SLICES = Object.keys(SLICE_MONEY_SCOPE) as StateSlice[];

/**
 * Readable by every signed-in member of the clinic. These carry the workspace's
 * own identity — who the colleagues are, which branches exist, what the roles
 * are called — which the shell needs before it can render anything at all.
 * Individual sensitive fields inside them are still redacted below.
 */
const BASELINE_SLICES: StateSlice[] = [
  'branches',
  'organizationProfile',
  'rolePermissions',
  'roles',
  'staffUsers',
];

/**
 * Which slices each section unlocks. Deliberately overlapping: billing needs
 * patient names to bill, charting needs the procedure catalogue, and so on.
 */
const FEATURE_SLICES: Record<WorkspaceFeature, StateSlice[]> = {
  ai_assistant: [],
  appointments: ['appointments', 'patients', 'doctors'],
  billing: ['invoices', 'patientPayments', 'patients', 'patientProfiles', 'procedures'],
  dashboard: ['appointments', 'forms', 'patients', 'patientProfiles'],
  dental_charting: ['patients', 'diagnoses', 'symptoms', 'procedures', 'appointments'],
  doctors: ['doctors', 'appointments'],
  finance: ['financeEntries', 'revenueData', 'invoices', 'patientPayments', 'patients', 'patientProfiles'],
  organization: ['staffUsers', 'branches', 'roles', 'rolePermissions'],
  patients: ['patients', 'patientProfiles', 'diagnoses', 'symptoms', 'forms', 'appointments'],
  prescriptions: ['prescriptions', 'patients'],
  reports: [
    'reports',
    'patients',
    'patientProfiles',
    'appointments',
    'doctors',
    'procedures',
    'diagnoses',
    'forms',
    'sickLeaves',
    'prescriptions',
    'revenueData',
    'financeEntries',
    'invoices',
    'patientPayments',
  ],
  settings: [],
  sick_leave: ['sickLeaves', 'patients', 'doctors'],
};

/** Slices only a clinic admin may write. The permission grid is one of them. */
const ADMIN_ONLY_SLICES: StateSlice[] = ['branches', 'rolePermissions', 'roles'];

/** `organizationProfile` fields only a clinic admin may write. */
const ADMIN_ONLY_PROFILE_FIELDS = ['name', 'legalName', 'contact', 'license'] as const;

/** Staff fields a member may change on their own record, and only their own. */
const SELF_EDITABLE_STAFF_FIELDS = [
  'avatarUrl',
  'branchId',
  'defaultBranchId',
  'emailSignature',
  'name',
  'phone',
  'preferences',
] as const;

const emptyPaymentPlan = {
  treatment: '',
  total: 0,
  paid: 0,
  firstPayment: 0,
  lastPaymentDate: '',
  method: '',
};

/** The slices this access may read. */
function readableSlices(access: WorkspaceAccess): Set<StateSlice> {
  if (access.canManageClinic) {
    return new Set<StateSlice>(Object.keys(FEATURE_SLICES).flatMap(
      (feature) => FEATURE_SLICES[feature as WorkspaceFeature]
    ).concat(BASELINE_SLICES, FINANCIAL_SLICES));
  }

  const slices = new Set<StateSlice>(BASELINE_SLICES);

  WORKSPACE_FEATURES.forEach((feature) => {
    // A money-only section that the caller cannot open unlocks nothing. Without
    // this, granting "Billing" without the financial permission would still hand
    // over the invoice list.
    if (!hasFeature(access, feature) || !canOpenFeature(access, feature)) {
      return;
    }

    FEATURE_SLICES[feature].forEach((slice) => slices.add(slice));
  });

  FINANCIAL_SLICES.forEach((slice) => {
    const scope = SLICE_MONEY_SCOPE[slice];

    if (scope && !hasMoneyScope(access, scope)) {
      slices.delete(slice);
    }
  });

  return slices;
}

/**
 * Another member's record, reduced to what a colleague legitimately needs: who
 * they are, their role, and which branch they work from. Their contact details,
 * signature, and personal preferences stay private.
 */
function toColleagueRecord(user: ClinicStaffUser): ClinicStaffUser {
  return {
    id: user.id,
    name: user.name,
    email: user.email,
    role: user.role,
    status: user.status,
    lastActive: user.lastActive,
    branchId: user.branchId,
    ...(user.defaultBranchId ? { defaultBranchId: user.defaultBranchId } : {}),
  };
}

/**
 * A read-safe copy of the workspace for one caller.
 *
 * Slices they cannot read come back empty rather than absent, so the browser
 * renders an empty section instead of crashing on a missing array. Money inside
 * slices they *can* read is zeroed field by field.
 */
export function scopeClinicStateForAccess(
  state: ClinicWorkspaceState,
  access: WorkspaceAccess,
  actorId?: string
): ClinicWorkspaceState {
  if (access.canManageClinic) {
    return state;
  }

  const slices = readableSlices(access);
  const keep = <T>(slice: StateSlice, value: T[]): T[] => (slices.has(slice) ? value : []);
  // A patient's balance and treatment price belong to the front-desk scope; a
  // doctor's revenue and a procedure's list price describe the business, so they
  // follow the owner's scope.
  const showPatientMoney = access.canViewPatientPayments;
  const showClinicMoney = access.canViewClinicFinances;

  return {
    ...state,
    patients: keep('patients', state.patients).map((patient) => (
      showPatientMoney ? patient : { ...patient, balance: 0 }
    )),
    patientProfiles: keep('patientProfiles', state.patientProfiles).map((profile) => (
      showPatientMoney
        ? profile
        : { ...profile, paymentPlan: { ...emptyPaymentPlan }, pendingAmount: 0 }
    )),
    patientPayments: keep('patientPayments', state.patientPayments),
    appointments: keep('appointments', state.appointments),
    revenueData: keep('revenueData', state.revenueData),
    doctors: keep('doctors', state.doctors).map((doctor) => (
      showClinicMoney ? doctor : { ...doctor, revenue: 0 }
    )),
    procedures: keep('procedures', state.procedures).map((procedure) => (
      showClinicMoney ? procedure : { ...procedure, cost: 0 }
    )),
    diagnoses: keep('diagnoses', state.diagnoses),
    symptoms: keep('symptoms', state.symptoms),
    prescriptions: keep('prescriptions', state.prescriptions),
    invoices: keep('invoices', state.invoices),
    forms: keep('forms', state.forms),
    sickLeaves: keep('sickLeaves', state.sickLeaves),
    reports: keep('reports', state.reports),
    staffUsers: state.staffUsers.map((user) => (
      actorId && user.id === actorId ? user : toColleagueRecord(user)
    )),
    organizationProfile: {
      ...state.organizationProfile,
      // The AI memory is a cached narrative summary of the clinic, and it quotes
      // turnover and outstanding balances in plain text, so it follows the owner's
      // scope rather than the front desk's.
      ...(showClinicMoney ? {} : { aiMemory: undefined }),
    },
    financeEntries: keep('financeEntries', state.financeEntries),
  };
}

function indexById<T extends { id: string }>(records: T[]) {
  return new Map(records.map((record) => [record.id, record]));
}

/**
 * Restores money onto records a caller may edit but may not see, so that a PUT
 * carrying redacted zeros cannot wipe the real figures. A record with no stored
 * counterpart is new — the caller authored it, so its values stand.
 */
function restorePatientMoney(
  incoming: ClinicWorkspaceState['patients'],
  current: ClinicWorkspaceState['patients']
) {
  const stored = indexById(current);

  return incoming.map((patient) => {
    const previous = stored.get(patient.id);
    return previous ? { ...patient, balance: previous.balance } : patient;
  });
}

function restoreProfileMoney(
  incoming: ClinicWorkspaceState['patientProfiles'],
  current: ClinicWorkspaceState['patientProfiles']
) {
  const stored = new Map(current.map((profile) => [profile.patientId, profile]));

  return incoming.map((profile) => {
    const previous = stored.get(profile.patientId);

    return previous
      ? { ...profile, paymentPlan: previous.paymentPlan, pendingAmount: previous.pendingAmount }
      : profile;
  });
}

function restoreDoctorMoney(
  incoming: ClinicWorkspaceState['doctors'],
  current: ClinicWorkspaceState['doctors']
) {
  const stored = indexById(current);

  return incoming.map((doctor) => {
    const previous = stored.get(doctor.id);
    return previous ? { ...doctor, revenue: previous.revenue } : doctor;
  });
}

function restoreProcedureMoney(
  incoming: ClinicWorkspaceState['procedures'],
  current: ClinicWorkspaceState['procedures']
) {
  const stored = indexById(current);

  return incoming.map((procedure) => {
    const previous = stored.get(procedure.id);
    return previous ? { ...procedure, cost: previous.cost } : procedure;
  });
}

/**
 * Merges the caller's own staff record and drops every other edit to the roster.
 *
 * A member may keep their own profile current — name, photo, phone, signature,
 * preferences, and the branch they are working from. They may not touch their
 * own role, status, or email, and they may not touch anybody else's record at
 * all, so no PUT can promote an account or invent a colleague.
 */
function mergeStaffUsers(
  incoming: ClinicWorkspaceState['staffUsers'],
  current: ClinicWorkspaceState['staffUsers'],
  actorId?: string
) {
  if (!actorId) {
    return current;
  }

  const submitted = incoming.find((user) => user.id === actorId);

  if (!submitted) {
    return current;
  }

  return current.map((user) => {
    if (user.id !== actorId) {
      return user;
    }

    const next: ClinicStaffUser = { ...user };

    SELF_EDITABLE_STAFF_FIELDS.forEach((field) => {
      const value = (submitted as Record<string, unknown>)[field];

      if (value !== undefined) {
        (next as Record<string, unknown>)[field] = value;
      }
    });

    // Identity and standing stay as stored, whatever the request claimed.
    next.id = user.id;
    next.email = user.email;
    next.role = user.role;
    next.status = user.status;

    return next;
  });
}

/**
 * Field-wise merge of the organization profile.
 *
 * The clinic's own details (name, legal name, contact, licence) are admin-only.
 * The assistant transcript, chat sessions, projects, and handoff notifications
 * are shared workspace activity that any member may add to. The AI memory
 * quotes money, so it follows the financial grant.
 */
function mergeOrganizationProfile(
  incoming: ClinicOrganizationProfile | undefined,
  current: ClinicOrganizationProfile,
  access: WorkspaceAccess
): ClinicOrganizationProfile {
  if (!incoming || typeof incoming !== 'object') {
    return current;
  }

  const next: ClinicOrganizationProfile = { ...current };

  ADMIN_ONLY_PROFILE_FIELDS.forEach((field) => {
    next[field] = current[field];
  });

  if (hasFeature(access, 'ai_assistant')) {
    next.assistantMessages = incoming.assistantMessages ?? current.assistantMessages;
    next.assistantSessions = incoming.assistantSessions ?? current.assistantSessions;
    next.assistantProjects = incoming.assistantProjects ?? current.assistantProjects;
  }

  // Notifications are read receipts on clinical handoffs, not a section.
  next.doctorProfileNotifications = incoming.doctorProfileNotifications
    ?? current.doctorProfileNotifications;

  next.aiMemory = access.canViewClinicFinances
    ? (incoming.aiMemory ?? current.aiMemory)
    : current.aiMemory;

  return next;
}

/**
 * Stops a clinic admin from writing a platform role onto a staff record.
 *
 * The workspace snapshot is the source for the `User.role` column, so without
 * this a clinic admin could set their own staff row to `super_admin` and gain the
 * platform console across every clinic — the same escalation the invitation API
 * has to refuse, reachable by a second route. A platform role already on a record
 * is left alone; only a *change into* one is refused.
 */
export function clampStaffRoles(
  incoming: ClinicWorkspaceState['staffUsers'],
  current: ClinicWorkspaceState['staffUsers']
) {
  const storedRoles = new Map(current.map((user) => [user.id, user.role]));

  return incoming.map((user) => {
    if (!isPlatformOnlyRole(user.role)) {
      return user;
    }

    const stored = storedRoles.get(user.id);

    if (stored && isPlatformOnlyRole(stored)) {
      return { ...user, role: stored };
    }

    return { ...user, role: stored || 'clinic_staff' };
  });
}

/**
 * The state to actually persist for a PUT from this caller.
 *
 * Every slice starts from what is already stored and is replaced only where the
 * caller is permitted to write. Nothing a caller could not read can be lost, and
 * nothing they could not manage can be changed.
 */
export function mergeClinicStateForAccess({
  access,
  actorId,
  current,
  incoming,
}: {
  access: WorkspaceAccess;
  actorId?: string;
  current: ClinicWorkspaceState;
  incoming: ClinicWorkspaceState;
}): ClinicWorkspaceState {
  if (access.canManageClinic) {
    // A clinic admin may rewrite the whole workspace — except that they may not
    // promote anyone into a platform role, which is not theirs to give.
    return {
      ...incoming,
      staffUsers: Array.isArray(incoming.staffUsers)
        ? clampStaffRoles(incoming.staffUsers, current.staffUsers)
        : current.staffUsers,
    };
  }

  const slices = readableSlices(access);
  const showPatientMoney = access.canViewPatientPayments;
  const showClinicMoney = access.canViewClinicFinances;
  const writable = (slice: StateSlice) => (
    slices.has(slice) && !ADMIN_ONLY_SLICES.includes(slice)
  );
  const take = <T>(slice: StateSlice, next: T[] | undefined, fallback: T[]): T[] => (
    writable(slice) && Array.isArray(next) ? next : fallback
  );

  const patients = take('patients', incoming.patients, current.patients);
  const patientProfiles = take('patientProfiles', incoming.patientProfiles, current.patientProfiles);
  const doctors = take('doctors', incoming.doctors, current.doctors);
  const procedures = take('procedures', incoming.procedures, current.procedures);

  return {
    ...current,
    patients: showPatientMoney ? patients : restorePatientMoney(patients, current.patients),
    patientProfiles: showPatientMoney
      ? patientProfiles
      : restoreProfileMoney(patientProfiles, current.patientProfiles),
    patientPayments: take('patientPayments', incoming.patientPayments, current.patientPayments),
    appointments: take('appointments', incoming.appointments, current.appointments),
    revenueData: take('revenueData', incoming.revenueData, current.revenueData),
    doctors: showClinicMoney ? doctors : restoreDoctorMoney(doctors, current.doctors),
    procedures: showClinicMoney ? procedures : restoreProcedureMoney(procedures, current.procedures),
    diagnoses: take('diagnoses', incoming.diagnoses, current.diagnoses),
    symptoms: take('symptoms', incoming.symptoms, current.symptoms),
    prescriptions: take('prescriptions', incoming.prescriptions, current.prescriptions),
    invoices: take('invoices', incoming.invoices, current.invoices),
    forms: take('forms', incoming.forms, current.forms),
    sickLeaves: take('sickLeaves', incoming.sickLeaves, current.sickLeaves),
    reports: take('reports', incoming.reports, current.reports),
    staffUsers: mergeStaffUsers(
      Array.isArray(incoming.staffUsers) ? incoming.staffUsers : [],
      current.staffUsers,
      actorId
    ),
    roles: current.roles,
    rolePermissions: current.rolePermissions,
    branches: current.branches,
    organizationProfile: mergeOrganizationProfile(
      incoming.organizationProfile,
      current.organizationProfile,
      access
    ),
    financeEntries: take('financeEntries', incoming.financeEntries, current.financeEntries),
  };
}
