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

import { randomUUID } from 'node:crypto';

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
  ClinicOrganizationBranch,
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

const ONBOARDING_BRANCH_STATUSES = new Set<ClinicOrganizationBranch['status']>([
  'Active',
  'Opening soon',
  'Paused',
]);

function readOnboardingText(value: unknown, maximumLength: number) {
  return typeof value === 'string' ? value.trim().slice(0, maximumLength) : '';
}

/**
 * Onboarding deliberately reuses the workspace document shape so the browser can
 * hydrate normally, but it must not receive the workspace hidden behind approval.
 * Only the application fields and the signed-in owner's identity leave the API.
 */
export function scopeClinicStateForOnboarding(
  state: ClinicWorkspaceState,
  actorId?: string,
): ClinicWorkspaceState {
  const actor = actorId ? state.staffUsers.find((user) => user.id === actorId) : undefined;

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
    staffUsers: actor ? [toColleagueRecord(actor)] : [],
    roles: [],
    rolePermissions: [],
    branches: state.branches.map((branch) => ({
      id: branch.id,
      name: branch.name,
      city: branch.city,
      manager: branch.manager,
      status: branch.status,
    })),
    organizationProfile: {
      name: state.organizationProfile.name,
      legalName: state.organizationProfile.legalName,
      contact: '',
      license: '',
      assistantMessages: [],
      assistantSessions: [],
      assistantProjects: [],
      doctorProfileNotifications: [],
    },
    financeEntries: [],
  };
}

/**
 * Applies an onboarding submission to the server's stored state.
 *
 * No clinical, financial, role, or roster data is accepted from the browser.
 * Existing branch IDs are honored only when they already belong to this
 * organization; IDs for new branches are allocated here so a crafted request
 * cannot re-parent another clinic's globally keyed branch.
 */
export function mergeClinicStateForOnboarding({
  actorId,
  current,
  incoming,
}: {
  actorId?: string;
  current: ClinicWorkspaceState;
  incoming: ClinicWorkspaceState;
}): ClinicWorkspaceState {
  const submittedProfile = incoming?.organizationProfile;
  const organizationName = readOnboardingText(submittedProfile?.name, 160);
  const legalName = readOnboardingText(submittedProfile?.legalName, 200) || organizationName;
  const submittedBranches = Array.isArray(incoming?.branches) ? incoming.branches : [];

  if (organizationName.length < 2) {
    throw new Error('Add an organization name before submitting the application.');
  }

  if (submittedBranches.length < 1 || submittedBranches.length > 12) {
    throw new Error('An application must include between 1 and 12 branches.');
  }

  const storedBranches = new Map(current.branches.map((branch) => [branch.id, branch]));
  const usedBranchIds = new Set<string>();
  const submittedBranchIds = new Map<string, string>();
  const branches = submittedBranches.map((submitted, index): ClinicOrganizationBranch => {
    const submittedId = readOnboardingText(submitted?.id, 200);
    const sameOrganizationBranch = submittedId ? storedBranches.get(submittedId) : undefined;
    const indexedStoredBranch = current.branches[index];
    const reusableIndexedId = indexedStoredBranch && !usedBranchIds.has(indexedStoredBranch.id)
      ? indexedStoredBranch.id
      : '';
    const id = sameOrganizationBranch && !usedBranchIds.has(sameOrganizationBranch.id)
      ? sameOrganizationBranch.id
      : reusableIndexedId || `branch-${randomUUID()}`;
    const name = readOnboardingText(submitted?.name, 120);
    const city = readOnboardingText(submitted?.city, 120);
    const manager = readOnboardingText(submitted?.manager, 160);
    const status = ONBOARDING_BRANCH_STATUSES.has(submitted?.status)
      ? submitted.status
      : 'Active';

    if (!name) {
      throw new Error(`Branch ${index + 1} needs a name before submitting the application.`);
    }

    usedBranchIds.add(id);
    if (submittedId && !submittedBranchIds.has(submittedId)) {
      submittedBranchIds.set(submittedId, id);
    }

    return {
      id,
      name,
      city,
      manager,
      status,
    };
  });
  const validBranchIds = new Set(branches.map((branch) => branch.id));
  const firstBranchId = branches[0].id;
  const submittedActor = actorId && Array.isArray(incoming?.staffUsers)
    ? incoming.staffUsers.find((user) => user.id === actorId)
    : undefined;
  const resolveSubmittedBranchId = (branchId: string | undefined) => {
    const resolved = branchId ? submittedBranchIds.get(branchId) || branchId : '';
    return validBranchIds.has(resolved) ? resolved : firstBranchId;
  };

  return {
    ...current,
    branches,
    organizationProfile: {
      ...current.organizationProfile,
      name: organizationName,
      legalName,
    },
    staffUsers: current.staffUsers.map((user) => {
      if (user.id !== actorId) {
        const branchId = validBranchIds.has(user.branchId) ? user.branchId : firstBranchId;
        const defaultBranchId = user.defaultBranchId && validBranchIds.has(user.defaultBranchId)
          ? user.defaultBranchId
          : branchId;

        return { ...user, branchId, defaultBranchId };
      }

      const branchId = resolveSubmittedBranchId(submittedActor?.branchId);
      const defaultBranchId = resolveSubmittedBranchId(submittedActor?.defaultBranchId || branchId);

      return { ...user, branchId, defaultBranchId };
    }),
  };
}

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
  prices: [],
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
  // Platform roles are stripped for every caller, admin included. The write path
  // keeps new ones out, but workspaces stored by older builds still carry a
  // `super_admin` row; withholding it on read means no client has to know to filter
  // it, and a clinic admin cannot be shown platform grants to edit.
  const withoutPlatformRoles = {
    ...state,
    roles: dropPlatformRoles(state.roles),
    rolePermissions: dropPlatformRoles(state.rolePermissions),
  };

  if (access.canManageClinic) {
    return withoutPlatformRoles;
  }

  const slices = readableSlices(access);
  const keep = <T>(slice: StateSlice, value: T[]): T[] => (slices.has(slice) ? value : []);
  // A patient's balance and treatment price belong to the front-desk scope; a
  // doctor's revenue and a procedure's list price describe the business, so they
  // follow the owner's scope.
  const showPatientMoney = access.canViewPatientPayments;
  const showClinicMoney = access.canViewClinicFinances;

  return {
    ...withoutPlatformRoles,
    patients: keep('patients', state.patients).map((patient) => (
      showPatientMoney ? patient : { ...patient, balance: 0 }
    )),
    patientProfiles: keep('patientProfiles', state.patientProfiles).map((profile) => {
      const visibleProfile = showPatientMoney
        ? profile
        : { ...profile, paymentPlan: { ...emptyPaymentPlan }, pendingAmount: 0 };

      // Draft prices are the doctor's working notes. Reception and other roles
      // receive only lines the doctor explicitly sent.
      if (access.role === 'dentist') {
        return visibleProfile;
      }

      const isReceptionDesk = access.role === 'receptionist' || access.role === 'cashier';

      return {
        ...visibleProfile,
        treatmentCharges: isReceptionDesk
          ? visibleProfile.treatmentCharges?.filter((charge) => charge.sentAt)
          : [],
      };
    }),
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

/** Reception can read a doctor's sent prices but cannot author or remove them. */
function restoreTreatmentCharges(
  incoming: ClinicWorkspaceState['patientProfiles'],
  current: ClinicWorkspaceState['patientProfiles']
) {
  const stored = new Map(current.map((profile) => [profile.patientId, profile]));

  return incoming.map((profile) => {
    const previous = stored.get(profile.patientId);

    return previous
      ? { ...profile, treatmentCharges: previous.treatmentCharges }
      : { ...profile, treatmentCharges: [] };
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
 * The price list follows the dedicated Prices feature. The assistant transcript,
 * chat sessions, projects, and handoff notifications are shared workspace
 * activity. The AI memory quotes money, so it follows the financial grant.
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

  if (hasFeature(access, 'prices') && Array.isArray(incoming.servicePrices)) {
    next.servicePrices = incoming.servicePrices;
  }

  // The medical-history checklist is one organization-wide paper form. Staff
  // who can work with patients may configure it from any branch, and the value
  // remains on the shared organization profile rather than a branch or patient.
  if (
    hasFeature(access, 'patients')
    && incoming.medicalHistoryTemplate
    && Array.isArray(incoming.medicalHistoryTemplate.categories)
  ) {
    next.medicalHistoryTemplate = incoming.medicalHistoryTemplate;
  }

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

function secureClinicAdminBranches(
  incoming: ClinicWorkspaceState['branches'],
  current: ClinicWorkspaceState['branches'],
) {
  const storedBranchIds = new Set(current.map((branch) => branch.id));
  const usedBranchIds = new Set<string>();
  const submittedBranchIds = new Map<string, string>();
  const branches = incoming.map((branch) => {
    const submittedId = typeof branch.id === 'string' ? branch.id.trim() : '';
    const mayKeepId = Boolean(
      submittedId
      && storedBranchIds.has(submittedId)
      && !usedBranchIds.has(submittedId),
    );
    const id = mayKeepId ? submittedId : `branch-${randomUUID()}`;

    usedBranchIds.add(id);
    if (submittedId && !submittedBranchIds.has(submittedId)) {
      submittedBranchIds.set(submittedId, id);
    }

    return { ...branch, id };
  });
  const validBranchIds = new Set(branches.map((branch) => branch.id));
  const fallbackBranchId = branches[0]?.id || '';
  const resolveBranchId = (branchId: string | undefined) => {
    const submittedId = typeof branchId === 'string' ? branchId.trim() : '';
    const resolved = submittedBranchIds.get(submittedId) || submittedId;
    return validBranchIds.has(resolved) ? resolved : fallbackBranchId;
  };

  return { branches, resolveBranchId };
}

/**
 * Clinic staff accounts are provisioned by the invitation service. A workspace
 * PUT may update or remove members already stored in this clinic, but it may not
 * introduce an arbitrary ID/email and thereby move another clinic's user.
 */
function secureClinicAdminStaffUsers({
  actorId,
  current,
  incoming,
  resolveBranchId,
}: {
  actorId?: string;
  current: ClinicWorkspaceState['staffUsers'];
  incoming: ClinicWorkspaceState['staffUsers'];
  resolveBranchId: (branchId: string | undefined) => string;
}) {
  const submittedById = new Map(incoming.map((user) => [user.id, user]));

  return current.flatMap((storedUser) => {
    const submitted = submittedById.get(storedUser.id);

    // Keep the caller's own account even if a stale or crafted snapshot omits it.
    if (!submitted) {
      return storedUser.id === actorId ? [storedUser] : [];
    }

    const [roleClamped] = clampStaffRoles([{
      ...submitted,
      id: storedUser.id,
      email: storedUser.email,
      branchId: resolveBranchId(submitted.branchId),
      defaultBranchId: resolveBranchId(submitted.defaultBranchId || submitted.branchId),
    }], current);

    return roleClamped ? [roleClamped] : [storedUser];
  });
}

/**
 * Drops the platform roles from a clinic's role catalog and grant list.
 *
 * `super_admin` and `platform_admin` administer the platform across every clinic;
 * they are not roles a clinic staffs or configures. {@link clampStaffRoles} already
 * stops one being written onto a *person*, but the grant list was a second route to
 * the same place: a stored `super_admin` row rendered an editable Super Admin column
 * in the clinic's own Roles & access screen. Their access never comes from a clinic
 * workspace, so a row here can only mislead — dropping it loses nothing.
 */
export function dropPlatformRoles<T extends { role: string }>(entries: T[]): T[] {
  return entries.filter((entry) => !isPlatformOnlyRole(entry.role));
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
    const submittedBranches = Array.isArray(incoming.branches)
      ? incoming.branches
      : current.branches;
    const { branches, resolveBranchId } = secureClinicAdminBranches(
      submittedBranches,
      current.branches,
    );
    const submittedStaffUsers = Array.isArray(incoming.staffUsers)
      ? incoming.staffUsers
      : current.staffUsers;
    // A clinic admin may rewrite the whole workspace — except that they may not
    // promote anyone into a platform role, which is not theirs to give, nor keep a
    // platform role in their own catalog or grant list.
    return {
      ...incoming,
      patientProfiles: Array.isArray(incoming.patientProfiles)
        ? incoming.patientProfiles.map((profile) => ({
            ...profile,
            branchId: resolveBranchId(profile.branchId),
          }))
        : current.patientProfiles,
      staffUsers: secureClinicAdminStaffUsers({
        actorId,
        current: current.staffUsers,
        incoming: submittedStaffUsers,
        resolveBranchId,
      }),
      branches,
      roles: Array.isArray(incoming.roles) ? dropPlatformRoles(incoming.roles) : current.roles,
      rolePermissions: Array.isArray(incoming.rolePermissions)
        ? dropPlatformRoles(incoming.rolePermissions)
        : current.rolePermissions,
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
  const submittedPatientProfiles = take('patientProfiles', incoming.patientProfiles, current.patientProfiles);
  const patientProfiles = access.role === 'dentist'
    ? submittedPatientProfiles
    : restoreTreatmentCharges(submittedPatientProfiles, current.patientProfiles);
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
