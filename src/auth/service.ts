import { prisma } from '../db';
import {
  clinicOrganizationId,
  ensureClinicWorkspaceForMember,
  getClinicState,
  isSeedClinicStaffEmail,
} from '../clinic/service';

type SyncSessionUserInput = {
  authUserId: string;
  avatarUrl?: string;
  email: string;
  fullName?: string;
  isAdmin?: boolean;
};

function normalizeFullName(fullName: string | undefined, email: string) {
  const trimmedName = fullName?.trim();

  if (trimmedName) {
    return trimmedName;
  }

  return email.split('@')[0] || 'Clinic User';
}

function normalizePhone(phone: string | null | undefined) {
  const normalized = typeof phone === 'string' ? phone.trim() : '';

  if (!normalized) {
    return null;
  }

  if (normalized.includes('@') || normalized.includes('(555)')) {
    return null;
  }

  return normalized;
}

const legacySeedClinicRole = 'clinic_team';
const genericClinicOrganizationName = 'Your clinic';
const genericClinicRole = 'clinic_staff';

export async function syncSessionUser(input: SyncSessionUserInput) {
  const email = input.email.trim().toLowerCase();
  const authUserId = input.authUserId.trim();

  if (!email || !authUserId) {
    throw new Error('authUserId and email are required.');
  }

  const fullName = normalizeFullName(input.fullName, email);
  const now = new Date();
  const existingUser = await prisma.user.findFirst({
    where: {
      OR: [
        { authUserId },
        { email },
      ],
    },
  });
  const needsPersonalClinicWorkspace = Boolean(
    !input.isAdmin
    && (
      !existingUser?.organizationId
      || (
        existingUser.organizationId === clinicOrganizationId
        && !isSeedClinicStaffEmail(email)
      )
    )
  );
  const targetOrganizationId = input.isAdmin
    ? existingUser?.organizationId || null
    : needsPersonalClinicWorkspace
      ? (await ensureClinicWorkspaceForMember({ authUserId, email, fullName })).organizationId
      : existingUser?.organizationId || clinicOrganizationId;
  const clinicState = input.isAdmin || !targetOrganizationId
    ? null
    : await getClinicState(targetOrganizationId);
  const clinicOrganizationName = clinicState?.organizationProfile.name || genericClinicOrganizationName;
  const defaultClinicBranchId = clinicState?.branches[0]?.id || null;
  const reassigningFromSeedWorkspace = Boolean(
    !input.isAdmin
    && existingUser?.organizationId === clinicOrganizationId
    && targetOrganizationId !== clinicOrganizationId
  );
  const preferredClinicRole = input.isAdmin
    ? 'platform_admin'
    : targetOrganizationId === clinicOrganizationId
      ? genericClinicRole
      : 'clinic_admin';
  const resolvedRole = existingUser?.role && (!needsPersonalClinicWorkspace || existingUser.role !== legacySeedClinicRole)
    ? existingUser.role
    : preferredClinicRole;

  const syncedUser = existingUser
    ? await prisma.user.update({
        where: { id: existingUser.id },
        data: {
          authUserId,
          avatarUrl: input.avatarUrl?.trim() || existingUser.avatarUrl,
          branchId: input.isAdmin
            ? existingUser.branchId
            : (reassigningFromSeedWorkspace ? defaultClinicBranchId : (existingUser.branchId || defaultClinicBranchId)),
          defaultBranchId: input.isAdmin
            ? existingUser.defaultBranchId
            : (reassigningFromSeedWorkspace ? defaultClinicBranchId : (existingUser.defaultBranchId || existingUser.branchId || defaultClinicBranchId)),
          email,
          fullName,
          lastActiveAt: now,
          organizationId: targetOrganizationId,
          phone: normalizePhone(existingUser.phone),
          emailSignature: existingUser.emailSignature || `${fullName}\n${resolvedRole}\n${clinicOrganizationName}`,
          role: resolvedRole,
          status: existingUser.status === 'banned' ? 'banned' : 'active',
        },
      })
    : await prisma.user.create({
        data: {
          authUserId,
          avatarUrl: input.avatarUrl?.trim() || null,
          branchId: input.isAdmin ? null : defaultClinicBranchId,
          defaultBranchId: input.isAdmin ? null : defaultClinicBranchId,
          email,
          fullName,
          lastActiveAt: now,
          organizationId: targetOrganizationId,
          phone: null,
          emailSignature: input.isAdmin ? null : `${fullName}\n${resolvedRole}\n${clinicOrganizationName}`,
          role: resolvedRole,
          status: 'active',
        },
      });
  const normalizedClinicName = clinicState?.organizationProfile.name.trim().toLowerCase() || '';
  const legacyOnboardingIncomplete = Boolean(
    !input.isAdmin
    && targetOrganizationId
    && targetOrganizationId !== clinicOrganizationId
    && clinicState
    && (
      !normalizedClinicName
      || normalizedClinicName === 'your clinic'
      || normalizedClinicName === `${fullName.trim().toLowerCase()}'s clinic`
      || clinicState.branches.length === 0
      || (
        clinicState.branches.length === 1
        && clinicState.branches[0]?.name.trim().toLowerCase() === 'main branch'
        && !clinicState.branches[0]?.city.trim()
        && (
          !clinicState.branches[0]?.manager.trim()
          || clinicState.branches[0]?.manager.trim().toLowerCase() === fullName.trim().toLowerCase()
        )
      )
    )
  );

  if (legacyOnboardingIncomplete && targetOrganizationId) {
    await prisma.organization.updateMany({
      where: {
        id: targetOrganizationId,
        status: 'trial',
      },
      data: {
        status: 'onboarding',
      },
    });
  }

  const organizationStatus = targetOrganizationId
    ? (
        await prisma.organization.findUnique({
          where: { id: targetOrganizationId },
          select: { status: true },
        })
      )?.status || null
    : null;

  return {
    authUserId: syncedUser.authUserId,
    email: syncedUser.email,
    fullName: syncedUser.fullName,
    id: syncedUser.id,
    organizationId: syncedUser.organizationId,
    organizationStatus,
    role: syncedUser.role,
    status: syncedUser.status,
  };
}

// A `resolveClinicOrganizationIdByAuthUserId` helper used to live here so the
// clinic routes could resolve a workspace from an `X-Clinic-Auth-User-Id` header.
// It was removed along with that header: naming an account is not the same as
// proving you control it. Clinic routes now read the workspace from the verified
// session actor (see auth/middleware.ts and clinic/router.ts).
