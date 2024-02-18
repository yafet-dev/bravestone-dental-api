import type { Invitation } from '@prisma/client';
import { AuthError, toPublicUser, type PublicUser } from '../auth/accounts';
import {
  createEmailToken,
  createSessionToken,
  describePasswordIssue,
  getSessionTtlSeconds,
  hashEmailToken,
  hashPassword,
  invitationTtlMs,
  isValidEmail,
  normalizeEmail,
} from '../auth/credentials';
import {
  isAssignableClinicRole,
  isLegacyClinicRole,
  isPlatformOnlyRole,
} from '../clinic/permissions';
import { roleLabel, roleSlug } from '../clinic/roles';
import { prisma } from '../db';
import { sendMail } from '../mail/mailer';
import { buildInvitationEmail } from '../mail/templates';

export type InvitationDelivery = {
  error?: string;
  sent: boolean;
};

export type InvitationRecord = {
  branchId: string | null;
  branchName: string;
  email: string;
  expiresAt: string;
  fullName: string;
  id: string;
  invitedByName: string;
  organizationId: string;
  organizationName: string;
  role: string;
  roleLabel: string;
  sentAt: string;
  status: string;
};

type InvitationWithRelations = Invitation & {
  branch?: { name: string } | null;
  invitedByUser?: { fullName: string } | null;
  organization?: { name: string } | null;
};

const invitationInclude = {
  branch: { select: { name: true } },
  invitedByUser: { select: { fullName: true } },
  organization: { select: { name: true } },
} as const;

function toInvitationRecord(invitation: InvitationWithRelations): InvitationRecord {
  return {
    branchId: invitation.branchId,
    branchName: invitation.branch?.name || '',
    email: invitation.email,
    expiresAt: invitation.expiresAt.toISOString(),
    fullName: invitation.fullName || '',
    id: invitation.id,
    invitedByName: invitation.invitedByUser?.fullName || '',
    organizationId: invitation.organizationId,
    organizationName: invitation.organization?.name || '',
    role: invitation.role,
    roleLabel: roleLabel(invitation.role),
    sentAt: invitation.sentAt.toISOString(),
    status: invitation.status,
  };
}

/** An invitation past its expiry is reported as expired even before any sweep runs. */
function resolveStatus(invitation: Invitation) {
  if (invitation.status === 'accepted') {
    return 'accepted';
  }

  return invitation.expiresAt.getTime() <= Date.now() ? 'expired' : invitation.status;
}

async function resolveBranch(organizationId: string, branchId: unknown) {
  const requestedBranchId = typeof branchId === 'string' ? branchId.trim() : '';

  if (requestedBranchId) {
    const branch = await prisma.branch.findFirst({
      where: { id: requestedBranchId, organizationId },
      select: { id: true },
    });

    if (!branch) {
      throw new AuthError(400, 'invalid_branch', 'That branch does not belong to this clinic.');
    }

    return branch.id;
  }

  const fallbackBranch = await prisma.branch.findFirst({
    where: { organizationId },
    orderBy: { createdAt: 'asc' },
    select: { id: true },
  });

  return fallbackBranch?.id || null;
}

export async function createInvitation(input: {
  branchId?: unknown;
  email: unknown;
  fullName?: unknown;
  invitedByUserId?: string | null;
  organizationId: string;
  role?: unknown;
}) {
  const email = normalizeEmail(input.email);
  const requestedRole = roleSlug(typeof input.role === 'string' ? input.role : '') || 'clinic_staff';
  const fullName = typeof input.fullName === 'string' ? input.fullName.trim().replace(/\s+/g, ' ') : '';

  if (!email || !isValidEmail(email)) {
    throw new AuthError(400, 'invalid_email', 'Enter a valid email address for the invitation.');
  }

  // The role on the invitation becomes the role on the account, and the role on
  // the account is what grants the platform console. Without this check an
  // invitation naming `super_admin` handed a clinic admin the whole platform —
  // and the picker in the UI actually offered it. Platform roles are granted out
  // of band with `npm run grant:super-admin -- <email>`.
  if (isPlatformOnlyRole(requestedRole)) {
    throw new AuthError(
      403,
      'role_not_assignable',
      'Platform roles cannot be granted by invitation. Invite this person as clinic staff instead.'
    );
  }

  // An unrecognised role would land on an account with no grants at all, leaving
  // the invitee locked out of everything, so it is refused rather than stored.
  if (!isAssignableClinicRole(requestedRole) && !isLegacyClinicRole(requestedRole)) {
    throw new AuthError(400, 'invalid_role', 'Choose one of the clinic roles for this invitation.');
  }

  const role = requestedRole;

  const organization = await prisma.organization.findUnique({
    where: { id: input.organizationId },
    select: { id: true, name: true },
  });

  if (!organization) {
    throw new AuthError(404, 'organization_not_found', 'That clinic no longer exists.');
  }

  const branchId = await resolveBranch(organization.id, input.branchId);
  const existingUser = await prisma.user.findUnique({ where: { email } });

  if (existingUser?.status === 'banned') {
    throw new AuthError(409, 'user_banned', 'That email belongs to a suspended account.');
  }

  if (existingUser?.passwordHash && existingUser.organizationId === organization.id) {
    throw new AuthError(409, 'already_member', 'That person already has an active account in this clinic.');
  }

  if (existingUser?.passwordHash && existingUser.organizationId && existingUser.organizationId !== organization.id) {
    throw new AuthError(409, 'belongs_elsewhere', 'That email is already registered to a different clinic.');
  }

  const { token, tokenHash } = createEmailToken();
  const sentAt = new Date();
  const expiresAt = new Date(sentAt.getTime() + invitationTtlMs);

  // Persist the invited person as a real backend user right away — pending
  // invites are part of the clinic roster, not front-end-only rows.
  const created = await prisma.$transaction(async (transaction) => {
    const user = existingUser
      ? await transaction.user.update({
          where: { id: existingUser.id },
          data: {
            branchId,
            defaultBranchId: existingUser.defaultBranchId || branchId,
            fullName: fullName || existingUser.fullName,
            organizationId: organization.id,
            role,
            status: existingUser.passwordHash ? existingUser.status : 'invited',
          },
        })
      : await transaction.user.create({
          data: {
            branchId,
            defaultBranchId: branchId,
            email,
            fullName: fullName || email.split('@')[0] || 'Clinic User',
            organizationId: organization.id,
            role,
            status: 'invited',
          },
        });

    // One live invitation per address per clinic keeps the roster unambiguous.
    await transaction.invitation.deleteMany({
      where: { email, organizationId: organization.id, status: { not: 'accepted' } },
    });

    const invitation = await transaction.invitation.create({
      data: {
        branchId,
        email,
        expiresAt,
        fullName: fullName || null,
        invitedByUserId: input.invitedByUserId || null,
        organizationId: organization.id,
        role,
        sentAt,
        status: 'sent',
        tokenHash,
      },
      include: invitationInclude,
    });

    return { createdUser: !existingUser, invitation, userId: user.id };
  });

  const delivery = await sendMail({
    to: email,
    ...buildInvitationEmail({
      branchName: created.invitation.branch?.name || null,
      email,
      expiresAt,
      fullName: fullName || null,
      invitedByName: created.invitation.invitedByUser?.fullName || null,
      organizationName: organization.name,
      role,
      token,
    }),
  });

  if (!delivery.ok) {
    // The invite never reached anyone, so leave nothing behind that claims it
    // did. Only the rows this call created are removed.
    await prisma.$transaction(async (transaction) => {
      await transaction.invitation.delete({ where: { id: created.invitation.id } });

      if (created.createdUser) {
        await transaction.user.delete({ where: { id: created.userId } });
      }
    });

    return {
      delivery: { sent: false, error: delivery.error } satisfies InvitationDelivery,
      invitation: null,
    };
  }

  return {
    delivery: { sent: true } satisfies InvitationDelivery,
    invitation: toInvitationRecord(created.invitation),
  };
}

export async function resendInvitation(input: { invitationId: string; organizationId?: string | null }) {
  const invitation = await prisma.invitation.findUnique({
    where: { id: input.invitationId },
    include: invitationInclude,
  });

  if (!invitation || (input.organizationId && invitation.organizationId !== input.organizationId)) {
    throw new AuthError(404, 'invitation_not_found', 'That invitation no longer exists.');
  }

  if (invitation.status === 'accepted') {
    throw new AuthError(409, 'already_accepted', 'That invitation has already been accepted.');
  }

  const { token, tokenHash } = createEmailToken();
  const sentAt = new Date();
  const expiresAt = new Date(sentAt.getTime() + invitationTtlMs);
  const refreshed = await prisma.invitation.update({
    where: { id: invitation.id },
    data: { expiresAt, sentAt, status: 'sent', tokenHash },
    include: invitationInclude,
  });
  const delivery = await sendMail({
    to: refreshed.email,
    ...buildInvitationEmail({
      branchName: refreshed.branch?.name || null,
      email: refreshed.email,
      expiresAt,
      fullName: refreshed.fullName,
      invitedByName: refreshed.invitedByUser?.fullName || null,
      organizationName: refreshed.organization?.name || 'your clinic',
      role: refreshed.role,
      token,
    }),
  });

  return {
    delivery: {
      sent: delivery.ok,
      ...(delivery.error ? { error: delivery.error } : {}),
    } satisfies InvitationDelivery,
    invitation: toInvitationRecord(refreshed),
  };
}

export async function listInvitations(organizationId?: string | null) {
  const invitations = await prisma.invitation.findMany({
    where: organizationId ? { organizationId } : {},
    include: invitationInclude,
    orderBy: { sentAt: 'desc' },
  });

  return invitations.map((invitation) => ({
    ...toInvitationRecord(invitation),
    status: resolveStatus(invitation),
  }));
}

export async function revokeInvitation(input: { invitationId: string; organizationId?: string | null }) {
  const invitation = await prisma.invitation.findUnique({ where: { id: input.invitationId } });

  if (!invitation || (input.organizationId && invitation.organizationId !== input.organizationId)) {
    throw new AuthError(404, 'invitation_not_found', 'That invitation no longer exists.');
  }

  if (invitation.status === 'accepted') {
    throw new AuthError(409, 'already_accepted', 'That invitation has already been accepted.');
  }

  await prisma.$transaction(async (transaction) => {
    await transaction.invitation.delete({ where: { id: invitation.id } });
    // Drop the placeholder roster row too, but never an account that already works.
    await transaction.user.deleteMany({
      where: { email: invitation.email, organizationId: invitation.organizationId, passwordHash: null, status: 'invited' },
    });
  });

  return { revoked: true };
}

async function findInvitationByToken(token: unknown) {
  const trimmedToken = typeof token === 'string' ? token.trim() : '';

  if (!trimmedToken) {
    return null;
  }

  return prisma.invitation.findUnique({
    where: { tokenHash: hashEmailToken(trimmedToken) },
    include: invitationInclude,
  });
}

/** Unauthenticated preview for the accept-invite screen. */
export async function describeInvitationToken(token: unknown) {
  const invitation = await findInvitationByToken(token);

  if (!invitation || invitation.status === 'accepted') {
    throw new AuthError(404, 'invalid_invitation', 'This invitation link is not valid. Ask your clinic admin to resend it.');
  }

  if (invitation.expiresAt.getTime() <= Date.now()) {
    throw new AuthError(410, 'expired_invitation', 'This invitation has expired. Ask your clinic admin to resend it.');
  }

  return {
    branchName: invitation.branch?.name || '',
    email: invitation.email,
    expiresAt: invitation.expiresAt.toISOString(),
    fullName: invitation.fullName || '',
    organizationName: invitation.organization?.name || '',
    role: invitation.role,
    roleLabel: roleLabel(invitation.role),
  };
}

export async function acceptInvitation(input: { fullName?: unknown; password: unknown; token: unknown }): Promise<{
  session: { expiresIn: number; token: string };
  user: PublicUser;
}> {
  const password = typeof input.password === 'string' ? input.password : '';
  const passwordIssue = describePasswordIssue(password);

  if (passwordIssue) {
    throw new AuthError(400, 'weak_password', passwordIssue);
  }

  const invitation = await findInvitationByToken(input.token);

  if (!invitation || invitation.status === 'accepted') {
    throw new AuthError(404, 'invalid_invitation', 'This invitation link is not valid. Ask your clinic admin to resend it.');
  }

  if (invitation.expiresAt.getTime() <= Date.now()) {
    throw new AuthError(410, 'expired_invitation', 'This invitation has expired. Ask your clinic admin to resend it.');
  }

  const requestedName = typeof input.fullName === 'string' ? input.fullName.trim().replace(/\s+/g, ' ') : '';
  const now = new Date();
  const passwordHash = await hashPassword(password);
  const existingUser = await prisma.user.findUnique({ where: { email: invitation.email } });

  if (existingUser?.status === 'banned') {
    throw new AuthError(403, 'account_banned', 'This account has been suspended. Contact your clinic administrator.');
  }

  const user = await prisma.$transaction(async (transaction) => {
    const fullName = requestedName || invitation.fullName || existingUser?.fullName || invitation.email.split('@')[0] || 'Clinic User';
    const acceptedUser = existingUser
      ? await transaction.user.update({
          where: { id: existingUser.id },
          data: {
            authUserId: existingUser.authUserId || existingUser.id,
            branchId: invitation.branchId || existingUser.branchId,
            defaultBranchId: invitation.branchId || existingUser.defaultBranchId,
            // Accepting through the emailed link proves the address is real.
            emailVerifiedAt: existingUser.emailVerifiedAt || now,
            fullName,
            lastActiveAt: now,
            mustChangePassword: false,
            organizationId: invitation.organizationId,
            passwordHash,
            role: invitation.role,
            status: 'active',
          },
        })
      : await transaction.user.create({
          data: {
            branchId: invitation.branchId,
            defaultBranchId: invitation.branchId,
            email: invitation.email,
            emailVerifiedAt: now,
            fullName,
            lastActiveAt: now,
            organizationId: invitation.organizationId,
            passwordHash,
            role: invitation.role,
            status: 'active',
          },
        });

    await transaction.invitation.update({
      where: { id: invitation.id },
      data: {
        acceptedAt: now,
        acceptedByUserId: acceptedUser.id,
        status: 'accepted',
        // Burn the token so the emailed link cannot be replayed.
        tokenHash: null,
      },
    });

    return acceptedUser.authUserId
      ? acceptedUser
      : transaction.user.update({ where: { id: acceptedUser.id }, data: { authUserId: acceptedUser.id } });
  });

  return {
    session: {
      expiresIn: getSessionTtlSeconds(),
      token: createSessionToken({ email: user.email, role: user.role, userId: user.id }),
    },
    user: toPublicUser(user),
  };
}
