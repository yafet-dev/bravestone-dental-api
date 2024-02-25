/**
 * Canonical staff/role identifiers (backend copy of the frontend lib/roles.ts).
 *
 * Roles are STORED as snake_case slugs (e.g. `clinic_admin`). The UI shows a
 * friendly label via {@link roleLabel}; {@link roleSlug} converts legacy display
 * strings into the canonical slug (used by seeds and the role migration).
 */

export const ROLE_LABELS: Record<string, string> = {
  super_admin: 'Super Admin',
  clinic_admin: 'Clinic Admin',
  dentist: 'Dentist',
  receptionist: 'Receptionist',
  cashier: 'Cashier',
  pharmacist: 'Pharmacist',
  prescription_assistant: 'Prescription Assistant',
  accountant: 'Accountant',
  nurse_assistant: 'Nurse / Assistant',
  owner: 'Owner',
  branch_manager: 'Branch Manager',
  nurse: 'Nurse',
  platform_admin: 'Platform Admin',
  clinic_staff: 'Clinic staff',
};

/** Convert any display string or slug into the canonical snake_case slug. */
export function roleSlug(value: string | null | undefined): string {
  const trimmed = (value || '').trim();
  if (!trimmed) {
    return '';
  }

  if (/^[a-z0-9]+(?:_[a-z0-9]+)*$/.test(trimmed)) {
    return trimmed;
  }

  return trimmed
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '');
}

/** True when the role grants platform Super Admin console access. */
export function isSuperAdminRole(role: string | null | undefined): boolean {
  return roleSlug(role) === 'super_admin' || roleSlug(role) === 'platform_admin';
}

/**
 * Roles that may administer their own clinic: staff, branches, and the role
 * grant grid — and which therefore always see financial detail.
 *
 * This is an explicit list rather than a substring test on the word "admin". It
 * used to be the latter, which meant a clinic admin who created a role called
 * "Records Admin" or "Admin Assistant" silently handed it full financial
 * visibility and the ability to rewrite every other role's permissions. Every
 * role the app actually issues is covered here; a custom role gets its access
 * from its grants, not from its name.
 */
const clinicAdminRoles = new Set([
  'clinic_admin',
  'clinic_owner',
  'owner',
  'platform_admin',
  'super_admin',
]);

/** True when the role may administer their own clinic (mirrors lib/roles.ts). */
export function isClinicAdminRole(role: string | null | undefined): boolean {
  return clinicAdminRoles.has(roleSlug(role));
}

/** Friendly label for a role slug. Falls back to Title Case for unknown slugs. */
export function roleLabel(role: string | null | undefined): string {
  const slug = roleSlug(role);
  if (!slug) {
    return '';
  }

  if (ROLE_LABELS[slug]) {
    return ROLE_LABELS[slug];
  }

  return slug
    .split('_')
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(' ');
}
