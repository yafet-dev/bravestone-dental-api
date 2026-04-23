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
