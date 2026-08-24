import type { User } from '@prisma/client';
import { prisma } from '../db';
import { sendMail, type MailResult } from '../mail/mailer';
import { buildPasswordResetEmail, buildSignupOtpEmail, buildVerificationEmail } from '../mail/templates';
import {
  createEmailToken,
  createSignupOtp,
  describePasswordIssue,
  emailVerificationTtlMs,
  emailTokensMatch,
  hashEmailToken,
  hashPassword,
  hashSignupOtp,
  isValidEmail,
  isFourDigitSignupOtp,
  normalizeEmail,
  passwordResetTtlMs,
  signupOtpTtlMs,
  verifyPassword,
} from './credentials';
import { AuthError } from './errors';
import { lockUserSecurityState } from './securityState';
import {
  buildAuthenticatedResponse,
  toPublicUser,
  type SessionClientMetadata,
} from './sessions';
import { completePrimaryAuthentication } from './twoFactor';

export { AuthError } from './errors';
export { toPublicUser, type PublicUser } from './sessions';

export const emailVerificationTokenType = 'email_verify';
export const passwordResetTokenType = 'password_reset';
const maximumSignupOtpAttempts = 5;
const maximumSignupOtpEmailsPerHour = 5;
const signupOtpResendCooldownMs = 60 * 1000;

function normalizeFullName(fullName: unknown, email: string) {
  const trimmed = typeof fullName === 'string' ? fullName.trim().replace(/\s+/g, ' ') : '';

  if (trimmed) {
    return trimmed;
  }

  return email.split('@')[0] || 'Clinic User';
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

async function sendSignupOtp(user: User) {
  const now = new Date();
  const oneHourAgo = new Date(now.getTime() - 60 * 60 * 1000);
  const { challengeId, code, codeHash } = createSignupOtp();
  const expiresAt = new Date(now.getTime() + signupOtpTtlMs);

  await prisma.$transaction(async (transaction) => {
    if (!(await lockUserSecurityState(transaction, user.id))) {
      throw new AuthError(404, 'user_not_found', 'This account no longer exists.');
    }

    const latestChallenge = await transaction.signupOtpChallenge.findFirst({
      where: { userId: user.id },
      orderBy: { createdAt: 'desc' },
      select: { createdAt: true },
    });
    const sentInLastHour = await transaction.signupOtpChallenge.count({
      where: { userId: user.id, createdAt: { gte: oneHourAgo } },
    });

    if (
      latestChallenge
      && now.getTime() - latestChallenge.createdAt.getTime() < signupOtpResendCooldownMs
    ) {
      const seconds = Math.ceil(
        (signupOtpResendCooldownMs - (now.getTime() - latestChallenge.createdAt.getTime())) / 1000,
      );
      throw new AuthError(429, 'signup_otp_resend_wait', `Please wait ${seconds} seconds before asking for another code.`);
    }

    if (sentInLastHour >= maximumSignupOtpEmailsPerHour) {
      throw new AuthError(429, 'signup_otp_email_limit', 'Too many signup codes were requested. Try again in about one hour.');
    }

    await transaction.signupOtpChallenge.updateMany({
      where: { userId: user.id, consumedAt: null },
      data: { consumedAt: now },
    });
    await transaction.signupOtpChallenge.create({
      data: { id: challengeId, userId: user.id, codeHash, expiresAt },
    });
  });

  const delivery = await sendMail({
    to: user.email,
    ...buildSignupOtpEmail({ code, email: user.email, fullName: user.fullName }),
  });

  return {
    challengeId,
    expiresIn: Math.round(signupOtpTtlMs / 1000),
    retryAfterSeconds: Math.round(signupOtpResendCooldownMs / 1000),
    sent: delivery.ok,
    ...(delivery.error ? { error: delivery.error } : {}),
  };
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

  const signupOtp = await sendSignupOtp(linkedUser);

  return {
    user: toPublicUser(linkedUser),
    signupOtp,
  };
}

export async function resendSignupOtp(rawEmail: unknown) {
  const email = normalizeEmail(rawEmail);

  if (!email || !isValidEmail(email)) {
    throw new AuthError(400, 'invalid_email', 'Enter a valid email address.');
  }

  const user = await prisma.user.findUnique({ where: { email } });

  if (!user || user.emailVerifiedAt || user.status === 'banned' || !user.passwordHash) {
    // Keep account existence private while returning the same shape the browser
    // expects. This challenge is deliberately not stored and can never verify.
    return {
      challengeId: createSignupOtp().challengeId,
      delivered: true,
      expiresIn: Math.round(signupOtpTtlMs / 1000),
      retryAfterSeconds: Math.round(signupOtpResendCooldownMs / 1000),
      sent: true,
    };
  }

  const result = await sendSignupOtp(user);

  return {
    ...result,
    delivered: result.sent,
  };
}

export async function verifySignupOtp(input: {
  challengeId: unknown;
  code: unknown;
  sessionMetadata: SessionClientMetadata;
}) {
  const challengeId = typeof input.challengeId === 'string' ? input.challengeId.trim() : '';
  const code = isFourDigitSignupOtp(input.code) ? input.code.trim() : '';

  if (!challengeId || !code) {
    throw new AuthError(400, 'invalid_signup_code', 'Enter the four-digit code from your email.');
  }

  const challenge = await prisma.signupOtpChallenge.findUnique({
    where: { id: challengeId },
    select: { userId: true },
  });

  if (!challenge) {
    throw new AuthError(400, 'invalid_signup_code', 'That code is not correct. Check the email and try again.');
  }

  const now = new Date();
  const presentedCodeHash = hashSignupOtp(challengeId, code);
  const verification = await prisma.$transaction(async (transaction) => {
    if (!(await lockUserSecurityState(transaction, challenge.userId))) {
      return { kind: 'expired' as const };
    }

    const currentChallenge = await transaction.signupOtpChallenge.findUnique({
      where: { id: challengeId },
      include: { user: true },
    });

    if (
      !currentChallenge
      || currentChallenge.consumedAt
      || currentChallenge.expiresAt.getTime() <= now.getTime()
      || currentChallenge.attemptCount >= maximumSignupOtpAttempts
    ) {
      return { kind: 'expired' as const };
    }

    if (!emailTokensMatch(currentChallenge.codeHash, presentedCodeHash)) {
      const attemptCount = currentChallenge.attemptCount + 1;
      await transaction.signupOtpChallenge.update({
        where: { id: currentChallenge.id },
        data: {
          attemptCount,
          ...(attemptCount >= maximumSignupOtpAttempts ? { consumedAt: now } : {}),
        },
      });

      return {
        kind: 'incorrect' as const,
        attemptsRemaining: Math.max(0, maximumSignupOtpAttempts - attemptCount),
      };
    }

    if (currentChallenge.user.status === 'banned') {
      return { kind: 'banned' as const };
    }

    await transaction.signupOtpChallenge.updateMany({
      where: { userId: currentChallenge.userId, consumedAt: null },
      data: { consumedAt: now },
    });
    const updatedUser = await transaction.user.update({
      where: { id: currentChallenge.userId },
      data: {
        authUserId: currentChallenge.user.authUserId || currentChallenge.user.id,
        emailVerifiedAt: currentChallenge.user.emailVerifiedAt || now,
        status: 'active',
      },
    });

    return { kind: 'verified' as const, user: updatedUser };
  });

  if (verification.kind === 'expired') {
    throw new AuthError(400, 'signup_otp_expired', 'This code has expired or has already been used. Ask for a new code.');
  }

  if (verification.kind === 'incorrect') {
    const suffix = verification.attemptsRemaining === 1 ? 'try' : 'tries';
    throw new AuthError(
      400,
      'invalid_signup_code',
      verification.attemptsRemaining
        ? `That code is not correct. You have ${verification.attemptsRemaining} ${suffix} left.`
        : 'That code is not correct. Ask for a new code.',
    );
  }

  if (verification.kind === 'banned') {
    throw new AuthError(403, 'account_banned', 'This account has been suspended. Contact your clinic administrator.');
  }

  return buildAuthenticatedResponse(verification.user, false, input.sessionMetadata);
}

export async function verifyEmailAddress(token: unknown, sessionMetadata: SessionClientMetadata) {
  const record = await consumeEmailToken(typeof token === 'string' ? token : '', emailVerificationTokenType);

  if (!record) {
    throw new AuthError(400, 'invalid_token', 'This verification link is invalid or has expired. Request a new one.');
  }

  const now = new Date();
  const { twoFactorEnabled, user } = await prisma.$transaction(async (transaction) => {
    if (!(await lockUserSecurityState(transaction, record.userId))) {
      throw new AuthError(400, 'invalid_token', 'This verification link is invalid or has expired. Request a new one.');
    }
    const currentUser = await transaction.user.findUnique({ where: { id: record.userId } });

    if (!currentUser) {
      throw new AuthError(400, 'invalid_token', 'This verification link is invalid or has expired. Request a new one.');
    }

    const consumed = await transaction.authToken.updateMany({
      where: {
        consumedAt: null,
        expiresAt: { gt: now },
        id: record.id,
        type: emailVerificationTokenType,
      },
      data: { consumedAt: now },
    });

    if (consumed.count !== 1) {
      throw new AuthError(400, 'invalid_token', 'This verification link is invalid or has expired. Request a new one.');
    }

    const updatedUser = await transaction.user.update({
      where: { id: record.userId },
      data: {
        authUserId: currentUser.authUserId || currentUser.id,
        emailVerifiedAt: currentUser.emailVerifiedAt || now,
        status: currentUser.status === 'banned' ? 'banned' : 'active',
      },
    });
    const credential = await transaction.userTwoFactorCredential.findUnique({
      where: { userId: record.userId },
      select: { enabledAt: true },
    });

    return {
      twoFactorEnabled: Boolean(credential?.enabledAt),
      user: updatedUser,
    };
  });

  if (user.status === 'banned') {
    throw new AuthError(403, 'account_banned', 'This account has been suspended. Contact your clinic administrator.');
  }

  if (twoFactorEnabled) {
    return {
      loginRequired: true as const,
      user: toPublicUser(user, true),
    };
  }

  return {
    ...await buildAuthenticatedResponse(user, false, sessionMetadata),
    loginRequired: false as const,
  };
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

export async function loginWithPassword(input: {
  email: unknown;
  password: unknown;
  sessionMetadata: SessionClientMetadata;
}) {
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

  // Do not mutate account activity or lifecycle state until every required
  // authentication factor has succeeded.
  return completePrimaryAuthentication(user, input.sessionMetadata);
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
  await prisma.$transaction(async (transaction) => {
    if (!(await lockUserSecurityState(transaction, record.userId))) {
      throw new AuthError(400, 'invalid_token', 'This reset link is invalid or has expired. Request a new one.');
    }
    const currentUser = await transaction.user.findUnique({ where: { id: record.userId } });

    if (!currentUser) {
      throw new AuthError(400, 'invalid_token', 'This reset link is invalid or has expired. Request a new one.');
    }

    if (currentUser.status === 'banned') {
      throw new AuthError(403, 'account_banned', 'This account has been suspended. Contact your clinic administrator.');
    }

    const consumed = await transaction.authToken.updateMany({
      where: {
        consumedAt: null,
        expiresAt: { gt: now },
        id: record.id,
        type: passwordResetTokenType,
      },
      data: { consumedAt: now },
    });

    if (consumed.count !== 1) {
      throw new AuthError(400, 'invalid_token', 'This reset link is invalid or has expired. Request a new one.');
    }

    // Any outstanding session-independent tokens and pre-auth challenges are
    // void once the password moves.
    await transaction.authToken.deleteMany({ where: { userId: record.userId, consumedAt: null } });
    await transaction.twoFactorLoginChallenge.deleteMany({ where: { userId: record.userId } });
    await transaction.authSession.updateMany({
      where: { userId: record.userId, revokedAt: null },
      data: { revokedAt: now },
    });
    await transaction.user.update({
      where: { id: record.userId },
      data: {
        authVersion: { increment: 1 },
        authUserId: currentUser.authUserId || currentUser.id,
        // Completing a reset proves control of the mailbox, so it doubles as
        // verification for accounts that never confirmed their address.
        emailVerifiedAt: currentUser.emailVerifiedAt || now,
        mustChangePassword: false,
        passwordHash,
        status: 'active',
      },
    });
  });

  // A password-reset email must never become a path around an enabled second
  // factor. The browser returns to login, where MFA is enforced normally.
  return { completed: true };
}

export async function changeOwnPassword(input: {
  authVersion: number;
  currentPassword: unknown;
  newPassword: unknown;
  sessionMetadata: SessionClientMetadata;
  userId: string;
}) {
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

  const passwordHash = await hashPassword(newPassword);
  const now = new Date();
  const updatedUser = await prisma.$transaction(async (transaction) => {
    if (!(await lockUserSecurityState(transaction, user.id))) {
      throw new AuthError(404, 'user_not_found', 'This account no longer exists.');
    }
    const currentUser = await transaction.user.findUnique({ where: { id: user.id } });

    if (!currentUser) {
      throw new AuthError(404, 'user_not_found', 'This account no longer exists.');
    }

    if (currentUser.status === 'banned') {
      throw new AuthError(403, 'account_banned', 'This account has been suspended. Contact your clinic administrator.');
    }

    if (
      currentUser.authVersion !== input.authVersion
      || currentUser.passwordHash !== user.passwordHash
    ) {
      throw new AuthError(
        409,
        'authentication_state_changed',
        'Your account security changed. Sign in again before continuing.',
      );
    }

    // Password changes revoke existing sessions through authVersion and must
    // also burn any session-independent login or email challenges issued under
    // the previous password.
    await transaction.twoFactorLoginChallenge.deleteMany({ where: { userId: user.id } });
    await transaction.authToken.deleteMany({ where: { userId: user.id, consumedAt: null } });
    await transaction.authSession.updateMany({
      where: { userId: user.id, revokedAt: null },
      data: { revokedAt: now },
    });

    return transaction.user.update({
      where: { id: user.id },
      data: {
        authVersion: { increment: 1 },
        mustChangePassword: false,
        passwordHash,
      },
    });
  });
  const twoFactorEnabled = Boolean((await prisma.userTwoFactorCredential.findUnique({
    where: { userId: user.id },
    select: { enabledAt: true },
  }))?.enabledAt);

  return buildAuthenticatedResponse(updatedUser, twoFactorEnabled, input.sessionMetadata);
}

export async function getAccountById(userId: string) {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    include: { twoFactorCredential: { select: { enabledAt: true } } },
  });

  if (!user) {
    throw new AuthError(404, 'user_not_found', 'This account no longer exists.');
  }

  if (user.status === 'banned') {
    throw new AuthError(403, 'account_banned', 'This account has been suspended. Contact your clinic administrator.');
  }

  return toPublicUser(user, Boolean(user.twoFactorCredential?.enabledAt));
}
