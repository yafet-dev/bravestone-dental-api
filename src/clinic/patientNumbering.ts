type NumberedProfile = { patientId: string; directoryId: string };

export const maximumPatientNumber = 999_999_999;

export function patientNumber(value: string): number {
  const match = /^(?:PAT-)?(\d+)$/i.exec(value.trim());
  const number = match ? Number(match[1]) : 0;
  return Number.isSafeInteger(number) && number <= maximumPatientNumber ? number : 0;
}

export function lastPatientNumber(profiles: NumberedProfile[], lastUsed?: number): number {
  return profiles.reduce((highest, profile) => Math.max(highest, patientNumber(profile.directoryId)),
    Number.isSafeInteger(lastUsed) && lastUsed! >= 0 && lastUsed! <= maximumPatientNumber ? lastUsed! : 0);
}

export function formatPatientNumber(number: number): string {
  return `PAT-${String(number).padStart(4, '0')}`;
}

/** Call inside the workspace transaction, after acquiring the organization lock. */
export function assignPatientNumbers<T extends NumberedProfile>(
  incoming: T[], stored: NumberedProfile[], storedLastUsed?: number, requestedLastUsed?: number,
): { profiles: T[]; lastUsed: number } {
  let lastUsed = Math.max(lastPatientNumber(stored, storedLastUsed), lastPatientNumber([], requestedLastUsed));
  const existing = new Map(stored.map((profile) => [profile.patientId, profile.directoryId]));
  const profiles = incoming.map((profile) => {
    const previous = existing.get(profile.patientId);
    if (previous !== undefined) return { ...profile, directoryId: previous };
    if (lastUsed >= maximumPatientNumber) throw new Error('Patient numbering limit reached.');
    return { ...profile, directoryId: formatPatientNumber(++lastUsed) };
  });
  return { profiles, lastUsed };
}
