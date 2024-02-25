/**
 * What each role is allowed to open and read.
 *
 * This module is the single vocabulary for workspace access, and it is mirrored
 * verbatim in the frontend at `src/lib/permissions.ts`. Keep both copies in step:
 * the browser uses it to draw the sidebar and guard routes, and the API uses it
 * to decide what a request may actually read and write. The browser copy is a
 * convenience — the API copy is the one that enforces anything.
 *
 * Two kinds of grant live in the same stored list (`rolePermissions[].features`):
 *
 *   - a **feature**, one of {@link WORKSPACE_FEATURES}, which is a sidebar
 *     section and the routes underneath it, and
 *   - a **money scope**, one of {@link MONEY_PERMISSIONS}, which is not a sidebar
 *     entry at all. It decides whether amounts are readable.
 *
 * There are two money scopes because a clinic has two very different kinds of
 * money, and the people who touch them are not the same people:
 *
 *   - {@link PATIENT_PAYMENTS_PERMISSION} — what one patient owes and has paid:
 *     balances, treatment prices, invoices, and recording a payment. The front
 *     desk and the cashier need this to do their job; a dentist needs it to
 *     discuss a treatment plan.
 *   - {@link CLINIC_FINANCES_PERMISSION} — how the business is doing: the
 *     income and expense ledger, revenue analytics, per-doctor revenue, owner
 *     reports, and the AI insight cards. This is the owner's view.
 *
 * Splitting them is what lets a receptionist take a payment without also seeing
 * the clinic's turnover. Clinic finances stay admin-only unless granted; patient
 * payments are on by default for the roles that handle them and can be revoked.
 *
 * Adding the Finance or Billing section to a role is NOT the same as granting the
 * money behind it — the section stays hidden until the matching scope is on.
 */

import { isClinicAdminRole, isSuperAdminRole, roleSlug } from './roles';

/** Sidebar sections, in display order. Feature keys are stable; labels are not. */
export const WORKSPACE_FEATURES = [
  'dashboard',
  'patients',
  'appointments',
  'doctors',
  'dental_charting',
  'prescriptions',
  'sick_leave',
  'finance',
  'billing',
  'reports',
  'ai_assistant',
  'organization',
  'settings',
] as const;

export type WorkspaceFeature = (typeof WORKSPACE_FEATURES)[number];

/** Patient-level money: balances, treatment prices, invoices, taking payments. */
export const PATIENT_PAYMENTS_PERMISSION = 'patient_payments';

/** Clinic-level money: the ledger, revenue analytics, owner reports. */
export const CLINIC_FINANCES_PERMISSION = 'clinic_finances';

/** Both money scopes. Stored alongside features but never drawn as nav entries. */
export const MONEY_PERMISSIONS = [PATIENT_PAYMENTS_PERMISSION, CLINIC_FINANCES_PERMISSION] as const;

export type MoneyPermission = (typeof MONEY_PERMISSIONS)[number];

/**
 * The single grant these two replaced. Rows written before the split hold it, and
 * it still means "all money", so it is expanded into both scopes on read rather
 * than requiring a migration.
 */
const legacyFinancialPermission = 'financials';

export const FEATURE_LABELS: Record<WorkspaceFeature, string> = {
  dashboard: 'Dashboard',
  patients: 'Patients',
  appointments: 'Appointments',
  doctors: 'Doctors',
  dental_charting: 'Dental Charting',
  prescriptions: 'Prescriptions',
  sick_leave: 'Sick Leave',
  finance: 'Finance',
  billing: 'Billing',
  reports: 'Reports',
  ai_assistant: 'AI Assistant',
  organization: 'Organization',
  settings: 'Settings',
};

/** Route prefix each feature owns. */
export const FEATURE_PATHS: Record<WorkspaceFeature, string> = {
  dashboard: '/',
  patients: '/patients',
  appointments: '/appointments',
  doctors: '/doctors',
  dental_charting: '/dental-charting',
  prescriptions: '/prescriptions',
  sick_leave: '/sick-leave',
  finance: '/finance',
  billing: '/billing',
  reports: '/reports',
  ai_assistant: '/ai-assistant',
  organization: '/users',
  settings: '/settings',
};

/**
 * Sections that exist only to show money, and the scope each one needs. Granting
 * the section is not enough: without its scope it would render nothing but
 * redacted zeros, so it is hidden instead.
 */
export const FEATURE_MONEY_SCOPE: Partial<Record<WorkspaceFeature, MoneyPermission>> = {
  billing: PATIENT_PAYMENTS_PERMISSION,
  finance: CLINIC_FINANCES_PERMISSION,
};

export const FINANCIAL_FEATURES = Object.keys(FEATURE_MONEY_SCOPE) as WorkspaceFeature[];

/**
 * Always available, to every role, and not revocable: your own profile and
 * preferences. Locking someone out of `/settings` would leave them unable to
 * change their own password or notification choices.
 */
export const BASELINE_FEATURES: WorkspaceFeature[] = ['settings'];

/**
 * Clinic administration — staff, branches, roles, and the permission grid
 * itself. Restricted to clinic admins no matter what the stored grant says: a
 * role that could edit the grid could grant itself the financial permission,
 * which would make the whole opt-in meaningless.
 */
export const ADMIN_ONLY_FEATURES: WorkspaceFeature[] = ['organization'];

type GrantKey = WorkspaceFeature | MoneyPermission | typeof legacyFinancialPermission;

const featureAliases: Record<string, GrantKey> = {
  ai: 'ai_assistant',
  ai_assistant: 'ai_assistant',
  assistant: 'ai_assistant',
  charting: 'dental_charting',
  clinic_finances: CLINIC_FINANCES_PERMISSION,
  dental_chart: 'dental_charting',
  dental_charting: 'dental_charting',
  finances: CLINIC_FINANCES_PERMISSION,
  financial: legacyFinancialPermission,
  financial_details: legacyFinancialPermission,
  financials: legacyFinancialPermission,
  organisation: 'organization',
  organization: 'organization',
  patient_payments: PATIENT_PAYMENTS_PERMISSION,
  payments: PATIENT_PAYMENTS_PERMISSION,
  sick_leave: 'sick_leave',
  users: 'organization',
};

const workspaceFeatureSet = new Set<string>(WORKSPACE_FEATURES);

/**
 * Canonical key for a stored grant. Accepts the display labels written by older
 * builds ("Dental Charting", "AI Assistant") as well as current keys, and
 * returns '' for anything unrecognised so unknown values can never widen access.
 */
export function featureKey(value: string | null | undefined): GrantKey | '' {
  const slug = roleSlug(value);

  if (!slug) {
    return '';
  }

  if (workspaceFeatureSet.has(slug)) {
    return slug as WorkspaceFeature;
  }

  return featureAliases[slug] || '';
}

/**
 * Parse a stored grant list into canonical keys, dropping anything unknown.
 *
 * The pre-split `financials` grant is expanded here into both money scopes, so a
 * clinic configured before the split keeps exactly the access it had.
 */
export function normalizeFeatureList(value: unknown): string[] {
  if (!Array.isArray(value)) {
    return [];
  }

  const keys = new Set<string>();

  value.forEach((entry) => {
    const key = featureKey(typeof entry === 'string' ? entry : '');

    if (!key) {
      return;
    }

    if (key === legacyFinancialPermission) {
      MONEY_PERMISSIONS.forEach((scope) => keys.add(scope));
      return;
    }

    keys.add(key);
  });

  return [...keys];
}

/**
 * The roles a clinic admin may assign to their staff, in display order.
 *
 * Deliberately short. The list previously offered nine roles, several of which
 * overlapped, which made the picker a guess rather than a decision — and it
 * offered `super_admin`, the platform console role, which no clinic admin should
 * ever be able to hand out.
 */
export const ASSIGNABLE_CLINIC_ROLES = [
  'clinic_admin',
  'dentist',
  'receptionist',
  'cashier',
  'nurse_assistant',
  'accountant',
] as const;

/**
 * Roles that are no longer offered but remain fully supported.
 *
 * A clinic that already has a pharmacist or a branch manager keeps them working,
 * grants and all — they simply are not choices for new staff. Removing them
 * outright would silently strip access from real accounts.
 */
export const LEGACY_CLINIC_ROLES = [
  'pharmacist',
  'prescription_assistant',
  'branch_manager',
  'nurse',
  'owner',
  'clinic_staff',
] as const;

/**
 * Platform roles. These are never assignable through the clinic UI or the
 * invitation API — they are granted out of band with
 * `npm run grant:super-admin -- <email>` in the API project.
 */
export const PLATFORM_ONLY_ROLES = ['super_admin', 'platform_admin'] as const;

const assignableRoleSet = new Set<string>(ASSIGNABLE_CLINIC_ROLES);
const legacyRoleSet = new Set<string>(LEGACY_CLINIC_ROLES);
const platformOnlyRoleSet = new Set<string>(PLATFORM_ONLY_ROLES);

/** True when a clinic admin may assign this role. */
export function isAssignableClinicRole(role: string | null | undefined) {
  return assignableRoleSet.has(roleSlug(role));
}

/** True when the role is retired but still honoured for accounts that hold it. */
export function isLegacyClinicRole(role: string | null | undefined) {
  return legacyRoleSet.has(roleSlug(role));
}

/** True when the role belongs to the platform console and must never be assigned. */
export function isPlatformOnlyRole(role: string | null | undefined) {
  return platformOnlyRoleSet.has(roleSlug(role));
}

/**
 * The roles to offer in a picker: the current set, plus whatever the record being
 * edited already holds so that editing a legacy-role account does not silently
 * change their role to something else.
 */
export function assignableRolesFor(currentRoles: Array<string | null | undefined> = []) {
  const roles = [...ASSIGNABLE_CLINIC_ROLES] as string[];

  currentRoles.forEach((role) => {
    const slug = roleSlug(role);

    if (slug && !roles.includes(slug) && !isPlatformOnlyRole(slug)) {
      roles.push(slug);
    }
  });

  return roles;
}

/**
 * Defaults for a brand-new clinic.
 *
 * {@link PATIENT_PAYMENTS_PERMISSION} is on for the roles that actually handle
 * money at the chair or the front desk — dentist, receptionist, cashier — because
 * a receptionist who cannot see what a patient owes cannot take the payment. A
 * clinic admin can revoke it per role.
 *
 * {@link CLINIC_FINANCES_PERMISSION} is NOT on for anyone but the clinic admin.
 * Turnover, the expense ledger, and per-doctor revenue stay the owner's business
 * until the admin grants them, which is what the accountant grant is for.
 */
export function defaultFeaturesForRole(role: string | null | undefined): string[] {
  const slug = roleSlug(role);

  if (isSuperAdminRole(slug) || isClinicAdminRole(slug)) {
    return [...WORKSPACE_FEATURES, ...MONEY_PERMISSIONS];
  }

  switch (slug) {
    case 'dentist':
      return ['dashboard', 'patients', 'appointments', 'doctors', 'dental_charting', 'prescriptions', 'sick_leave', 'billing', 'ai_assistant', 'settings', PATIENT_PAYMENTS_PERMISSION];
    case 'receptionist':
      return ['dashboard', 'patients', 'appointments', 'doctors', 'sick_leave', 'billing', 'settings', PATIENT_PAYMENTS_PERMISSION];
    case 'cashier':
      return ['dashboard', 'patients', 'billing', 'settings', PATIENT_PAYMENTS_PERMISSION];
    case 'accountant':
      // Sections but no scopes: an accountant sees nothing until the clinic admin
      // grants clinic finances, which is the deliberate opt-in.
      return ['dashboard', 'finance', 'billing', 'reports', 'settings'];
    case 'pharmacist':
    case 'prescription_assistant':
      return ['dashboard', 'patients', 'prescriptions', 'settings'];
    case 'nurse_assistant':
    case 'nurse':
      return ['dashboard', 'patients', 'appointments', 'dental_charting', 'sick_leave', 'settings'];
    case 'branch_manager':
      return ['dashboard', 'patients', 'appointments', 'doctors', 'dental_charting', 'prescriptions', 'sick_leave', 'billing', 'reports', 'ai_assistant', 'settings', PATIENT_PAYMENTS_PERMISSION];
    default:
      return ['dashboard', 'settings'];
  }
}

export type RoleGrant = {
  features?: unknown;
  role?: unknown;
};

/**
 * What one account may do.
 *
 * There is deliberately no single `canViewFinancials` flag. A receptionist who
 * may take a payment must not thereby see clinic turnover, so every call site has
 * to say which kind of money it is showing.
 */
export type WorkspaceAccess = {
  /** Clinic admin or platform super admin: manages staff, roles, and grants. */
  canManageClinic: boolean;
  /** The clinic's own money: ledger, revenue analytics, owner reports. */
  canViewClinicFinances: boolean;
  /** One patient's money: balance, treatment price, invoices, taking payment. */
  canViewPatientPayments: boolean;
  /** Effective sidebar sections, in {@link WORKSPACE_FEATURES} order. */
  features: WorkspaceFeature[];
  /** True for the platform console account. */
  isPlatformAdmin: boolean;
  role: string;
};

/**
 * The effective access for one account.
 *
 * `role` must come from the account row (the API's `request.actor.role`, the
 * browser's session account) — never from the clinic workspace snapshot, which
 * the browser itself writes and a clinic admin can edit freely.
 */
export function resolveWorkspaceAccess({
  role,
  rolePermissions,
}: {
  role: string | null | undefined;
  rolePermissions?: RoleGrant[] | null;
}): WorkspaceAccess {
  const slug = roleSlug(role);
  const isPlatformAdmin = isSuperAdminRole(slug);
  const canManageClinic = isPlatformAdmin || isClinicAdminRole(slug);

  if (canManageClinic) {
    return {
      canManageClinic: true,
      canViewClinicFinances: true,
      canViewPatientPayments: true,
      features: [...WORKSPACE_FEATURES],
      isPlatformAdmin,
      role: slug,
    };
  }

  const grant = (rolePermissions || []).find((entry) => roleSlug(
    typeof entry?.role === 'string' ? entry.role : ''
  ) === slug);
  // A role with no stored grant falls back to its role default rather than to
  // "everything" — an unconfigured clinic must not be an open one.
  const granted = new Set(
    grant ? normalizeFeatureList(grant.features) : defaultFeaturesForRole(slug)
  );

  BASELINE_FEATURES.forEach((feature) => granted.add(feature));
  ADMIN_ONLY_FEATURES.forEach((feature) => granted.delete(feature));

  return {
    canManageClinic: false,
    canViewClinicFinances: granted.has(CLINIC_FINANCES_PERMISSION),
    canViewPatientPayments: granted.has(PATIENT_PAYMENTS_PERMISSION),
    features: WORKSPACE_FEATURES.filter((feature) => granted.has(feature)),
    isPlatformAdmin: false,
    role: slug,
  };
}

/** True when this access holds the given money scope. */
export function hasMoneyScope(access: WorkspaceAccess, scope: MoneyPermission) {
  return scope === CLINIC_FINANCES_PERMISSION
    ? access.canViewClinicFinances
    : access.canViewPatientPayments;
}

/** True when the access allows opening this sidebar section. */
export function hasFeature(access: WorkspaceAccess, feature: WorkspaceFeature) {
  return access.features.includes(feature);
}

/**
 * True when the section is both granted and actually useful — a money-only
 * section whose scope is missing would render nothing but redacted zeros, so it is
 * hidden rather than shown empty.
 */
export function canOpenFeature(access: WorkspaceAccess, feature: WorkspaceFeature) {
  if (!hasFeature(access, feature)) {
    return false;
  }

  const scope = FEATURE_MONEY_SCOPE[feature];

  return scope ? hasMoneyScope(access, scope) : true;
}

/** Sidebar sections to draw, in order. */
export function visibleFeatures(access: WorkspaceAccess) {
  return access.features.filter((feature) => canOpenFeature(access, feature));
}

/**
 * Where to send someone who lands on a route they cannot open. Falls back to
 * `/settings`, which {@link BASELINE_FEATURES} guarantees is always reachable.
 */
export function landingPathForAccess(access: WorkspaceAccess) {
  const first = visibleFeatures(access)[0];
  return first ? FEATURE_PATHS[first] : FEATURE_PATHS.settings;
}
