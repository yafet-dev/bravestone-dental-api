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
 *     desk needs this to take the money; a dentist needs it to discuss a
 *     treatment plan.
 *   - {@link CLINIC_FINANCES_PERMISSION} — how the business is doing: the
 *     income and expense ledger, revenue analytics, per-doctor revenue, owner
 *     reports, and the AI insight cards.
 *
 * The two stay separate scopes even though the receptionist now holds both by
 * default, because the dentist holds only the first: pricing a treatment must
 * not carry a view of the clinic's turnover with it. Both are ordinary grants a
 * clinic admin can revoke per role in the roles grid.
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
  'prices',
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
  prices: 'Prices',
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
  prices: '/prices',
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
 * Always available, to every role, and not revocable: the clinic's non-sensitive
 * price list plus personal profile and preferences. Locking someone out of
 * `/settings` would leave them unable to change their own password or notification
 * choices, while Prices is shared clinic reference data every role may maintain.
 */
export const BASELINE_FEATURES: WorkspaceFeature[] = ['prices', 'settings'];

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
  price_list: 'prices',
  pricing: 'prices',
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
 * Accounting stays separate from reception so access to the books and patient
 * accounts does not also grant appointment-desk access.
 *
 * `super_admin` has never been here and must never be: it is the platform
 * console role, and a clinic admin handing it out would be handing out the SaaS.
 */
export const ASSIGNABLE_CLINIC_ROLES = [
  'clinic_admin',
  'dentist',
  'receptionist',
  'accountant',
] as const;

/**
 * Roles not offered in the clinic picker but still honoured where they appear.
 *
 * Only `owner` remains, and it is not a retired clinic role at all — it is the
 * company owner the platform console creates, which {@link isClinicAdminRole}
 * already treats as a clinic admin. It is listed so that editing an owner's
 * account through the clinic UI offers their own role back rather than silently
 * demoting them to whichever role happens to be first in the picker.
 *
 * The roles this list used to hold — pharmacist, prescription assistant, branch
 * manager, nurse, and cashier — were removed outright because no account held
 * any of them.
 */
export const LEGACY_CLINIC_ROLES = [
  'owner',
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
 * {@link PATIENT_PAYMENTS_PERMISSION} is on for both roles that touch a
 * patient's money — the dentist, who prices the treatment after examining, and
 * the receptionist, who takes the payment for it. Neither can do their job
 * without seeing what a patient owes. A clinic admin can revoke it per role.
 *
 * {@link CLINIC_FINANCES_PERMISSION} — turnover, the expense ledger, per-doctor
 * revenue — is on for Accountant and Receptionist. Both scopes remain ordinary
 * grants that a clinic admin can narrow in the roles grid.
 *
 * The dentist keeps patient payments and nothing else: pricing a treatment is
 * their call, the clinic's turnover is not their business.
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
      // The front desk, the till and the books, which here is one person.
      // Everything except the clinical record and staff administration.
      return ['dashboard', 'patients', 'appointments', 'doctors', 'sick_leave', 'finance', 'billing', 'prices', 'reports', 'settings', PATIENT_PAYMENTS_PERMISSION, CLINIC_FINANCES_PERMISSION];
    case 'accountant':
      // Patient identity and account standing, plus every financial surface.
      // Clinical charting, prescriptions, appointments, AI, and staff
      // administration remain outside the accounting role.
      return ['dashboard', 'patients', 'finance', 'billing', 'prices', 'reports', 'settings', PATIENT_PAYMENTS_PERMISSION, CLINIC_FINANCES_PERMISSION];
    default:
      // Every role this clinic no longer issues lands here. An account somehow
      // still holding one gets the dashboard and its own settings, never an
      // accidental grant.
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
