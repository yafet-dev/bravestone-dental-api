/**
 * True when the record holds only the year a patient was born.
 *
 * Reception is often told an age rather than a date, so the registration form
 * takes the age and stores the year it implies — a bare `YYYY` in the same
 * `dob` field, at the precision the fact was actually known. ISO 8601 and FHIR
 * both allow a birth date reduced to a year, so no second column is needed and
 * the age is derived fresh rather than ageing in place.
 *
 * Kept in step with `bravestone-dental/src/lib/patientAge.ts`.
 */
export function isBirthYearOnly(dob: string | null | undefined) {
  return /^\d{4}$/.test(typeof dob === 'string' ? dob.trim() : '');
}

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
  if (!birthYear) return 0;

  const today = new Date();

  // A year-only record came from a spoken age, so the year difference IS that
  // age: 34 in 2026 stores 1992 and reads back as 34 through 2026, 35 through
  // 2027. It can sit a year out either side of the birthday, which is the same
  // uncertainty the spoken age already carried.
  if (!birthMonth || !birthDay) {
    return Math.max(today.getFullYear() - birthYear, 0);
  }

  const todayMonth = today.getMonth() + 1;
  let age = today.getFullYear() - birthYear;

  if (todayMonth < birthMonth || (todayMonth === birthMonth && today.getDate() < birthDay)) {
    age -= 1;
  }

  return Math.max(age, 0);
}
