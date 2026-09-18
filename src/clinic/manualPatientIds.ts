import { AuthError } from '../auth/errors';

type PatientIdentity = { patientId: string; directoryId: string };

export function formatManualPatientId(value: string) {
  const trimmed = value.trim();
  const match = /^(?:PAT-)?(\d+)$/i.exec(trimmed);
  return match ? `PAT-${match[1].padStart(4, '0')}` : trimmed;
}

/** Validate under the organization lock, preserving unchanged legacy IDs. */
export function validateManualPatientIds<T extends PatientIdentity>(incoming: T[], stored: PatientIdentity[]): T[] {
  const previous = new Map(stored.map((profile) => [profile.patientId, profile.directoryId]));
  const profiles = incoming.map((profile) => ({
    ...profile,
    directoryId: previous.get(profile.patientId) === profile.directoryId.trim()
      ? profile.directoryId.trim() : formatManualPatientId(profile.directoryId),
  }));
  const owners = new Map<string, Set<string>>();
  for (const profile of profiles) {
    const key = formatManualPatientId(profile.directoryId).toLowerCase();
    const ids = owners.get(key) || new Set<string>();
    ids.add(profile.patientId);
    owners.set(key, ids);
  }
  for (const profile of profiles) {
    if (previous.get(profile.patientId) === profile.directoryId) continue;
    if (!profile.directoryId) {
      throw new AuthError(400, 'patient_id_required', 'Enter the patient ID.');
    }
    if ((owners.get(formatManualPatientId(profile.directoryId).toLowerCase())?.size || 0) > 1) {
      throw new AuthError(409, 'patient_id_duplicate', 'This patient ID is already in use.');
    }
  }
  return profiles;
}

export function isManualPatientIdInUse(value: string, profiles: PatientIdentity[], editingPatientId: string | null = null) {
  const normalized = formatManualPatientId(value).toLowerCase();
  return Boolean(normalized) && profiles.some(profile => profile.patientId !== editingPatientId
    && formatManualPatientId(profile.directoryId).toLowerCase() === normalized);
}

/** Resolve the owner as well as the conflict, excluding the patient being edited. */
export function findManualPatientIdOwner<T extends { patientId: string; directoryId: string }>(
  value: string, profiles: T[], editingPatientId: string | null = null,
): T | undefined {
  const normalized = formatManualPatientId(value).toLowerCase();
  return normalized ? profiles.find(profile => profile.patientId !== editingPatientId
    && formatManualPatientId(profile.directoryId).toLowerCase() === normalized) : undefined;
}
