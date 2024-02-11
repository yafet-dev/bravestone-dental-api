import type { User } from '@prisma/client';
import { prisma } from '../db';
import { sendMail, type MailResult } from '../mail/mailer';
import { buildPasswordResetEmail, buildVerificationEmail } from '../mail/templates';
import {
  createEmailToken,
  createSessionToken,
  describePasswordIssue,
  emailVerificationTtlMs,
  getSessionTtlSeconds,
  hashEmailToken,
  hashPassword,
  isValidEmail,
  normalizeEmail,
  passwordResetTtlMs,
  verifyPassword,
} from './credentials';

export const emailVerificationTokenType = 'email_verify';
export const passwordResetTokenType = 'password_reset';

/**
 * Errors that map onto a specific HTTP status and a machine-readable code the
 * browser app switches on (for example to show the "resend verification" panel).
 */
export class AuthError extends Error {
  code: string;
  status: number;

  constructor(status: number, code: string, message: string) {
    super(message);
    this.name = 'AuthError';
    this.code = code;
    this.status = status;
  }
}

export type PublicUser = {
  avatarUrl: string | null;
  email: string;
  emailVerified: boolean;
  fullName: string;
  id: string;
  mustChangePassword: boolean;
  organizationId: string | null;
  role: string;
  status: string;
};

export function toPublicUser(user: User): PublicUser {
  return {
    avatarUrl: user.avatarUrl,
    email: user.email,
    emailVerified: Boolean(user.emailVerifiedAt),
    fullName: user.fullName,
    id: user.id,
    mustChangePassword: user.mustChangePassword,
    organizationId: user.organizationId,
    role: user.role,
    status: user.status,
  };
}

function normalizeFullName(fullName: unknown, email: string) {
  const trimmed = typeof fullName === 'string' ? fullName.trim().replace(/\s+/g, ' ') : '';

  if (trimmed) {
    return trimmed;
  }

  return email.split('@')[0] || 'Clinic User';
}

function buildSession(user: User) {
  return {
    expiresIn: getSessionTtlSeconds(),
    token: createSessionToken({ email: user.email, role: user.role, userId: user.id }),
  };
}

/**
 * Replaces any outstanding token of the same kind so only the newest emailed
 * link works, then returns the raw token for the email body.
 */
async function issueEmailToken(userId: string, type: string, ttlMs: number) {
  const { token, tokenHash } = createEmailToken();
  const expiresAt = new Date(Date.now() + ttlMs);

  await prisma.$transaction([
    prisma.authToken.deleteMany({ where: { userId, type, consumedAt: null } }),
    prisma.authToken.create({ data: { userId, type, tokenHash, expiresAt } }),
  ]);

  return { expiresAt, token };
}

async function consumeEmailToken(token: string, type: string) {
  const trimmedToken = token.trim();

  if (!trimmedToken) {
    return null;
  }

  const record = await prisma.authToken.findUnique({
    where: { tokenHash: hashEmailToken(trimmedToken) },
    include: { user: true },
  });

  if (!record || record.type !== type || record.consumedAt || record.expiresAt.getTime() <= Date.now()) {
    return null;
  }

  return record;
}

export async function sendVerificationEmail(user: User): Promise<MailResult> {
  const { expiresAt, token } = await issueEmailToken(user.id, emailVerificationTokenType, emailVerificationTtlMs);
  const email = buildVerificationEmail({
    email: user.email,
    expiresAt,
    fullName: user.fullName,
    token,
  });

  return sendMail({ to: user.email, ...email });
}

export async function registerAccount(input: { email: unknown; fullName: unknown; password: unknown }) {
  const email = normalizeEmail(input.email);
  const password = typeof input.password === 'string' ? input.password : '';

  if (!email || !isValidEmail(email)) {
    throw new AuthError(400, 'invalid_email', 'Enter a valid email address.');
  }

  const passwordIssue = describePasswordIssue(password);

  if (passwordIssue) {
    throw new AuthError(400, 'weak_password', passwordIssue);
  }

  const fullName = normalizeFullName(input.fullName, email);
  const existingUser = await prisma.user.findUnique({ where: { email } });

  if (existingUser?.passwordHash) {
    throw new AuthError(409, 'email_taken', 'An account already exists for this email. Log in instead.');
  }

  const passwordHash = await hashPassword(password);
  // A row can already exist from an invitation or from the legacy Supabase sync;
  // in that case registration claims it by setting the first password rather
  // than failing on the unique email constraint.
  const user = existingUser
    ? await prisma.user.update({
        where: { id: existingUser.id },
        data: {
          authUserId: existingUser.authUserId || existingUser.id,
          fullName,
          mustChangePassword: false,
          passwordHash,
          status: existingUser.status === 'banned' ? 'banned' : 'active',
        },
      })
    : await prisma.user.create({
        data: {
          email,
          fullName,
          passwordHash,
          role: 'clinic_admin',
          status: 'active',
        },
      });

  const linkedUser = user.authUserId
    ? user
    : await prisma.user.update({ where: { id: user.id }, data: { authUserId: user.id } });

  if (linkedUser.status === 'banned') {
    throw new AuthError(403, 'account_banned', 'This account has been suspended. Contact your clinic administrator.');
  }

  const verification = await sendVerificationEmail(linkedUser);

  return {
    user: toPublicUser(linkedUser),
    verification: {
      sent: verification.ok,
      ...(verification.error ? { error: verification.error } : {}),
    },
  };
}

export async function verifyEmailAddress(token: unknown) {
  const record = await consumeEmailToken(typeof token === 'string' ? token : '', emailVerificationTokenType);

  if (!record) {
    throw new AuthError(400, 'invalid_token', 'This verification link is invalid or has expired. Request a new one.');
  }

  const now = new Date();
  const [, user] = await prisma.$transaction([
    prisma.authToken.update({ where: { id: record.id }, data: { consumedAt: now } }),
    prisma.user.update({
      where: { id: record.userId },
      data: {
        authUserId: record.user.authUserId || record.user.id,
        emailVerifiedAt: record.user.emailVerifiedAt || now,
        status: record.user.status === 'banned' ? 'banned' : 'active',
      },
    }),
  ]);

  if (user.status === 'banned') {
    throw new AuthError(403, 'account_banned', 'This account has been suspended. Contact your clinic administrator.');
  }

  return { session: buildSession(user), user: toPublicUser(user) };
}

/**
 * Never reveals whether an address is registered — the caller always sees the
 * same "check your inbox" response.
 */
export async function resendVerificationEmail(rawEmail: unknown) {
  const email = normalizeEmail(rawEmail);

  if (!email || !isValidEmail(email)) {
    throw new AuthError(400, 'invalid_email', 'Enter a valid email address.');
  }

  const user = await prisma.user.findUnique({ where: { email } });

  if (!user || user.emailVerifiedAt || user.status === 'banned' || !user.passwordHash) {
    return { sent: false, delivered: true };
  }

  const result = await sendVerificationEmail(user);

  return {
    sent: result.ok,
    delivered: result.ok,
    ...(result.error ? { error: result.error } : {}),
  };
}

export async function loginWithPassword(input: { email: unknown; password: unknown }) {
  const email = normalizeEmail(input.email);
  const password = typeof input.password === 'string' ? input.password : '';

  if (!email || !password) {
    throw new AuthError(400, 'missing_credentials', 'Enter your email and password.');
  }

  const user = await prisma.user.findUnique({ where: { email } });
  const passwordMatches = await verifyPassword(password, user?.passwordHash);

  if (!user || !passwordMatches) {
    // Accounts carried over from the previous Supabase-hosted sign-in have no
    // backend password yet, so point them at recovery instead of a dead end.
    if (user && !user.passwordHash) {
      throw new AuthError(
        403,
        'password_setup_required',
        'This account does not have a password yet. Use "Forgot password?" to set one.',
      );
    }

    throw new AuthError(401, 'invalid_credentials', 'That email and password combination is not correct.');
  }

  if (user.status === 'banned') {
    throw new AuthError(403, 'account_banned', 'This account has been suspended. Contact your clinic administrator.');
  }

  if (!user.emailVerifiedAt) {
    throw new AuthError(403, 'email_not_verified', 'Verify your email address before signing in. We can send a new link.');
  }

  const signedInUser = await prisma.user.update({
    where: { id: user.id },
    data: {
      authUserId: user.authUserId || user.id,
      lastActiveAt: new Date(),
      status: 'active',
    },
  });

  return { session: buildSession(signedInUser), user: toPublicUser(signedInUser) };
}

export async function requestPasswordReset(rawEmail: unknown) {
  const email = normalizeEmail(rawEmail);

  if (!email || !isValidEmail(email)) {
    throw new AuthError(400, 'invalid_email', 'Enter a valid email address.');
  }

  const user = await prisma.user.findUnique({ where: { email } });

  if (!user || user.status === 'banned') {
    return { sent: false, delivered: true };
  }

  const { expiresAt, token } = await issueEmailToken(user.id, passwordResetTokenType, passwordResetTtlMs);
  const result = await sendMail({
    to: user.email,
    ...buildPasswordResetEmail({ email: user.email, expiresAt, fullName: user.fullName, token }),
  });

  return {
    sent: result.ok,
    delivered: result.ok,
    ...(result.error ? { error: result.error } : {}),
  };
}

export async function resetPasswordWithToken(input: { password: unknown; token: unknown }) {
  const password = typeof input.password === 'string' ? input.password : '';
  const passwordIssue = describePasswordIssue(password);

  if (passwordIssue) {
    throw new AuthError(400, 'weak_password', passwordIssue);
  }

  const record = await consumeEmailToken(typeof input.token === 'string' ? input.token : '', passwordResetTokenType);

  if (!record) {
    throw new AuthError(400, 'invalid_token', 'This reset link is invalid or has expired. Request a new one.');
  }

  if (record.user.status === 'banned') {
    throw new AuthError(403, 'account_banned', 'This account has been suspended. Contact your clinic administrator.');
  }

  const now = new Date();
  const passwordHash = await hashPassword(password);
  const [, , user] = await prisma.$transaction([
    prisma.authToken.update({ where: { id: record.id }, data: { consumedAt: now } }),
    // Any outstanding session-independent tokens are void once the password moves.
    prisma.authToken.deleteMany({ where: { userId: record.userId, consumedAt: null } }),
    prisma.user.update({
      where: { id: record.userId },
      data: {
        authUserId: record.user.authUserId || record.user.id,
        // Completing a reset proves control of the mailbox, so it doubles as
        // verification for accounts that never confirmed their address.
        emailVerifiedAt: record.user.emailVerifiedAt || now,
        mustChangePassword: false,
        passwordHash,
        status: 'active',
      },
    }),
  ]);

  return { session: buildSession(user), user: toPublicUser(user) };
}

export async function changeOwnPassword(input: { currentPassword: unknown; newPassword: unknown; userId: string }) {
  const currentPassword = typeof input.currentPassword === 'string' ? input.currentPassword : '';
  const newPassword = typeof input.newPassword === 'string' ? input.newPassword : '';
  const passwordIssue = describePasswordIssue(newPassword);

  if (passwordIssue) {
    throw new AuthError(400, 'weak_password', passwordIssue);
  }

  const user = await prisma.user.findUnique({ where: { id: input.userId } });

  if (!user) {
    throw new AuthError(404, 'user_not_found', 'This account no longer exists.');
  }

  if (!(await verifyPassword(currentPassword, user.passwordHash))) {
    throw new AuthError(400, 'invalid_credentials', 'Your current password is not correct.');
  }

  const updatedUser = await prisma.user.update({
    where: { id: user.id },
    data: {
      mustChangePassword: false,
      passwordHash: await hashPassword(newPassword),
    },
  });

  return { session: buildSession(updatedUser), user: toPublicUser(updatedUser) };
}

export async function getAccountById(userId: string) {
  const user = await prisma.user.findUnique({ where: { id: userId } });

  if (!user) {
    throw new AuthError(404, 'user_not_found', 'This account no longer exists.');
  }

  if (user.status === 'banned') {
    throw new AuthError(403, 'account_banned', 'This account has been suspended. Contact your clinic administrator.');
  }

  return toPublicUser(user);
}
