/**
 * Age from a date of birth, for whichever calendar the patient was registered in.
 *
 * The add-patient form offers a Gregorian and an Ethiopian calendar, but that is
 * an input method, not a second storage format: an Ethiopian entry is converted
 * before it is saved, so `dob` is always the one Gregorian ISO date the patient
 * was actually born on. Meskerem 1, 1992 EC and September 11, 1999 G are the
 * same instant and store as the same string, so the age is the same number
 * either way. Nothing here branches on the picker — and branching on it would be
 * wrong, because the profile does not record which one was used.
 *
 * The parts are compared directly rather than through `new Date(dob)`, which
 * parses a bare ISO date as UTC midnight; read back with local getters that
 * lands on the previous day for any server west of UTC.
 *
 * Kept in step with `bravestone-dental/src/lib/patientAge.ts`.
 */
export function calculatePatientAge(dob: string | null | undefined) {
  const normalized = typeof dob === 'string' ? dob.trim() : '';
  if (!normalized) return 0;

  const [birthYear, birthMonth, birthDay] = normalized.split('-').map(Number);
  if (!birthYear || !birthMonth || !birthDay) return 0;

  const today = new Date();
  const todayMonth = today.getMonth() + 1;
  let age = today.getFullYear() - birthYear;

  if (todayMonth < birthMonth || (todayMonth === birthMonth && today.getDate() < birthDay)) {
    age -= 1;
  }

  return Math.max(age, 0);
}
