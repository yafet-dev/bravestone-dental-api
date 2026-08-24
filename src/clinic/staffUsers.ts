import type { ClinicStaffUser } from './types';

export function removeClinicStaffUser(
  staffUsers: ClinicStaffUser[],
  target: { email: string; id: string },
) {
  const targetEmail = target.email.trim().toLowerCase();

  return staffUsers.filter((user) => (
    user.id !== target.id
    && user.email.trim().toLowerCase() !== targetEmail
  ));
}
