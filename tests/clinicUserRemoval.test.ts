import assert from 'node:assert/strict';
import test from 'node:test';
import { removeClinicStaffUser } from '../src/clinic/staffUsers';
import type { ClinicStaffUser } from '../src/clinic/types';

const staffUsers: ClinicStaffUser[] = [
  {
    id: 'owner-1',
    name: 'Clinic Owner',
    email: 'owner@example.com',
    role: 'clinic_admin',
    status: 'Active',
    lastActive: 'Now',
    branchId: 'branch-1',
  },
  {
    id: 'staff-2',
    name: 'Staff Member',
    email: 'Staff@Example.com',
    role: 'receptionist',
    status: 'Active',
    lastActive: 'Today',
    branchId: 'branch-1',
  },
];

test('removing a clinic user drops the matching database id from the roster snapshot', () => {
  const next = removeClinicStaffUser(staffUsers, { id: 'staff-2', email: 'different@example.com' });

  assert.deepEqual(next.map((user) => user.id), ['owner-1']);
});

test('email fallback removes an invited user whose browser id differs from the database id', () => {
  const next = removeClinicStaffUser(staffUsers, { id: 'temporary-browser-id', email: 'staff@example.com' });

  assert.deepEqual(next.map((user) => user.id), ['owner-1']);
});

test('removing one user never changes other staff records', () => {
  const next = removeClinicStaffUser(staffUsers, { id: 'missing', email: 'missing@example.com' });

  assert.deepEqual(next, staffUsers);
});
