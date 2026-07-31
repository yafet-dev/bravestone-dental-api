import {
  createCipheriv,
  createDecipheriv,
  createHash,
  createHmac,
  randomBytes,
  timingSafeEqual,
} from 'node:crypto';
import type { Prisma, User, UserTwoFactorCredential } from '@prisma/client';
import QRCode from 'qrcode';
import { prisma } from '../db';
import { verifyPassword } from './credentials';
import { AuthError } from './errors';
import { lockUserSecurityState } from './securityState';
import { buildAuthenticatedResponse, type SessionClientMetadata } from './sessions';

const issuer = 'Bravestone Dental';
const encryptionKeyVersion = 1;
const setupTtlMs = 10 * 60 * 1000;
const loginChallengeTtlMs = 5 * 60 * 1000;
const loginChallengeMaxAttempts = 5;
const maxOpenLoginChallenges = 5;
const accountAttemptWindowMs = 5 * 60 * 1000;
const accountAttemptLimit = 10;
const recoveryCodeCount = 10;
const recoveryCodeBytes = 16;

const importOtpLibrary = () => import('otplib');

let otpLibraryPromise: ReturnType<typeof importOtpLibrary> | undefined;

// Otplib 13 publishes an ESM implementation alongside a CommonJS wrapper. The
// wrapper reaches an ESM-only Base32 dependency through require(), which older
// serverless Node loaders reject. A native dynamic import selects the ESM graph
// directly and is cached after the first two-factor request.
function loadOtpLibrary() {
  if (!otpLibraryPromise) {
    otpLibraryPromise = importOtpLibrary();
  }

  return otpLibraryPromise;
}

type Transaction = Prisma.TransactionClient;

function getKeySeed() {
  const dedicatedKey = process.env.TWO_FACTOR_ENCRYPTION_KEY?.trim();

  if (dedicatedKey) {
    return dedicatedKey;
  }

  if (process.env.NODE_ENV === 'production') {
    throw new Error('Set TWO_FACTOR_ENCRYPTION_KEY before enabling two-factor authentication in production.');
  }

  const developmentFallback = process.env.AUTH_JWT_SECRET?.trim()
    || process.env.DATABASE_URL?.trim()
    || process.env.DIRECT_URL?.trim();

  if (!developmentFallback) {
    throw new Error('Set TWO_FACTOR_ENCRYPTION_KEY to encrypt authenticator secrets.');
  }

  return developmentFallback;
}

export function assertTwoFactorConfiguration() {
  // Resolve this at boot so a production deployment cannot appear healthy and
  // only discover a missing encryption key when an MFA user tries to sign in.
  getKeySeed();
}

function deriveKey(purpose: 'encryption' | 'recovery') {
  return createHash('sha256')
    .update(`bravestone-two-factor:${encryptionKeyVersion}:${purpose}:`)
    .update(getKeySeed())
    .digest();
}

function secretAad(userId: string) {
  return Buffer.from(`bravestone:totp-secret:v${encryptionKeyVersion}:user:${userId}`, 'utf8');
}

function encryptSecret(userId: string, secret: string) {
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', deriveKey('encryption'), iv);
  cipher.setAAD(secretAad(userId));
  const ciphertext = Buffer.concat([cipher.update(secret, 'utf8'), cipher.final()]);
  const authenticationTag = cipher.getAuthTag();

  return [
    `v${encryptionKeyVersion}`,
    iv.toString('base64url'),
    authenticationTag.toString('base64url'),
    ciphertext.toString('base64url'),
  ].join('.');
}

function decryptSecret(credential: UserTwoFactorCredential) {
  const [version, encodedIv, encodedTag, encodedCiphertext] = credential.encryptedSecret.split('.');

  if (
    credential.keyVersion !== encryptionKeyVersion
    || version !== `v${encryptionKeyVersion}`
    || !encodedIv
    || !encodedTag
    || !encodedCiphertext
  ) {
    throw new Error('Unsupported or malformed two-factor secret.');
  }

  const decipher = createDecipheriv(
    'aes-256-gcm',
    deriveKey('encryption'),
    Buffer.from(encodedIv, 'base64url'),
  );
  decipher.setAAD(secretAad(credential.userId));
  decipher.setAuthTag(Buffer.from(encodedTag, 'base64url'));

  return Buffer.concat([
    decipher.update(Buffer.from(encodedCiphertext, 'base64url')),
    decipher.final(),
  ]).toString('utf8');
}

function hashOpaqueToken(token: string) {
  return createHash('sha256').update(token).digest('hex');
}

function normalizeTotpCode(value: unknown) {
  if (typeof value !== 'string') {
    return '';
  }

  const code = value.trim().replace(/\s+/g, '');
  return /^\d{6}$/.test(code) ? code : '';
}

function normalizeRecoveryCode(value: unknown) {
  if (typeof value !== 'string') {
    return '';
  }

  const code = value.toUpperCase().replace(/[^A-F0-9]/g, '');
  return /^\d{2}[A-F0-9]{32}$/.test(code) ? code : '';
}

function recoveryCodeHash(userId: string, normalizedCode: string) {
  return createHmac('sha256', deriveKey('recovery'))
    .update(userId)
    .update('\0')
    .update(normalizedCode)
    .digest('hex');
}

function secureStringsEqual(left: string, right: string) {
  const leftBuffer = Buffer.from(left, 'utf8');
  const rightBuffer = Buffer.from(right, 'utf8');

  return leftBuffer.length === rightBuffer.length && timingSafeEqual(leftBuffer, rightBuffer);
}

function createRecoveryCodes(userId: string) {
  return Array.from({ length: recoveryCodeCount }, (_, offset) => {
    const codeIndex = offset + 1;
    const payload = randomBytes(recoveryCodeBytes).toString('hex').toUpperCase();
    const prefix = codeIndex.toString().padStart(2, '0');
    const visibleCode = `${prefix}-${payload.match(/.{1,4}/g)!.join('-')}`;
    const normalizedCode = `${prefix}${payload}`;

    return {
      codeHash: recoveryCodeHash(userId, normalizedCode),
      codeIndex,
      visibleCode,
    };
  });
}

async function verifyTotpCode(credential: UserTwoFactorCredential, rawCode: unknown) {
  const token = normalizeTotpCode(rawCode);

  if (!token) {
    return null;
  }

  const { verify } = await loadOtpLibrary();
  const result = await verify({
    algorithm: 'sha1',
    digits: 6,
    epochTolerance: [30, 0],
    period: 30,
    secret: decryptSecret(credential),
    token,
    ...(credential.lastUsedTimeStep === null
      ? {}
      : { afterTimeStep: credential.lastUsedTimeStep }),
  });

  return result.valid && 'timeStep' in result ? result.timeStep : null;
}

async function consumeSecondFactor(
  transaction: Transaction,
  credential: UserTwoFactorCredential,
  rawCode: unknown,
) {
  const totpCode = normalizeTotpCode(rawCode);

  if (totpCode) {
    const timeStep = await verifyTotpCode(credential, totpCode);

    if (timeStep === null) {
      return false;
    }

    // Otplib prevents old steps logically; this conditional write closes the
    // concurrency race where two requests validate the same code at once.
    const claimed = await transaction.userTwoFactorCredential.updateMany({
      where: {
        userId: credential.userId,
        OR: [
          { lastUsedTimeStep: null },
          { lastUsedTimeStep: { lt: timeStep } },
        ],
      },
      data: { lastUsedTimeStep: timeStep },
    });

    return claimed.count === 1;
  }

  const normalizedRecoveryCode = normalizeRecoveryCode(rawCode);

  if (!normalizedRecoveryCode) {
    return false;
  }

  const codeIndex = Number(normalizedRecoveryCode.slice(0, 2));

  if (codeIndex < 1 || codeIndex > recoveryCodeCount) {
    return false;
  }

  const recoveryCode = await transaction.twoFactorRecoveryCode.findUnique({
    where: {
      userId_codeIndex: {
        codeIndex,
        userId: credential.userId,
      },
    },
  });

  if (
    !recoveryCode
    || recoveryCode.usedAt
    || !secureStringsEqual(
      recoveryCode.codeHash,
      recoveryCodeHash(credential.userId, normalizedRecoveryCode),
    )
  ) {
    return false;
  }

  const consumed = await transaction.twoFactorRecoveryCode.updateMany({
    where: { id: recoveryCode.id, usedAt: null },
    data: { usedAt: new Date() },
  });

  return consumed.count === 1;
}

async function requirePassword(userId: string, rawPassword: unknown) {
  const password = typeof rawPassword === 'string' ? rawPassword : '';
  const user = await prisma.user.findUnique({ where: { id: userId } });

  if (!user) {
    throw new AuthError(404, 'user_not_found', 'This account no longer exists.');
  }

  if (!(await verifyPassword(password, user.passwordHash))) {
    throw new AuthError(400, 'invalid_credentials', 'Your current password is not correct.');
  }

  return user;
}

async function requireCurrentSecurityState(
  transaction: Transaction,
  userId: string,
  expectedAuthVersion: number,
) {
  if (!(await lockUserSecurityState(transaction, userId))) {
    throw new AuthError(404, 'user_not_found', 'This account no longer exists.');
  }

  const user = await transaction.user.findUnique({ where: { id: userId } });

  if (!user) {
    throw new AuthError(404, 'user_not_found', 'This account no longer exists.');
  }

  if (user.status === 'banned') {
    throw new AuthError(403, 'account_banned', 'This account has been suspended. Contact your clinic administrator.');
  }

  if (user.authVersion !== expectedAuthVersion) {
    throw new AuthError(
      409,
      'authentication_state_changed',
      'Your account security changed. Sign in again before continuing.',
    );
  }

  return user;
}

export async function getTwoFactorStatus(userId: string) {
  const credential = await prisma.userTwoFactorCredential.findUnique({
    where: { userId },
    include: {
      _count: {
        select: {
          recoveryCodes: { where: { usedAt: null } },
        },
      },
    },
  });

  return {
    enabled: Boolean(credential?.enabledAt),
    enabledAt: credential?.enabledAt?.toISOString() || null,
    recoveryCodesRemaining: credential?.enabledAt ? credential._count.recoveryCodes : 0,
  };
}

export async function beginTwoFactorSetup(input: {
  authVersion: number;
  currentPassword: unknown;
  userId: string;
}) {
  const user = await requirePassword(input.userId, input.currentPassword);
  const { generateSecret, generateURI } = await loadOtpLibrary();
  const secret = generateSecret({ length: 20 });
  const setupExpiresAt = new Date(Date.now() + setupTtlMs);
  const provisioningUri = generateURI({
    algorithm: 'sha1',
    digits: 6,
    issuer,
    label: user.email,
    period: 30,
    secret,
  });
  const qrCodeDataUrl = await QRCode.toDataURL(provisioningUri, {
    errorCorrectionLevel: 'M',
    margin: 2,
    type: 'image/png',
    width: 240,
  });

  await prisma.$transaction(async (transaction) => {
    await requireCurrentSecurityState(transaction, user.id, input.authVersion);
    const existingCredential = await transaction.userTwoFactorCredential.findUnique({
      where: { userId: user.id },
    });

    if (existingCredential?.enabledAt) {
      throw new AuthError(409, 'two_factor_already_enabled', 'Two-factor authentication is already enabled.');
    }

    await transaction.twoFactorRecoveryCode.deleteMany({ where: { userId: user.id } });
    await transaction.userTwoFactorCredential.upsert({
      where: { userId: user.id },
      create: {
        encryptedSecret: encryptSecret(user.id, secret),
        keyVersion: encryptionKeyVersion,
        setupExpiresAt,
        userId: user.id,
      },
      update: {
        encryptedSecret: encryptSecret(user.id, secret),
        keyVersion: encryptionKeyVersion,
        lastUsedTimeStep: null,
        setupExpiresAt,
      },
    });
  });

  return {
    manualKey: secret.match(/.{1,4}/g)!.join(' '),
    qrCodeDataUrl,
    setupExpiresAt: setupExpiresAt.toISOString(),
  };
}

export async function confirmTwoFactorSetup(input: {
  authVersion: number;
  code: unknown;
  sessionMetadata: SessionClientMetadata;
  userId: string;
}) {
  const credential = await prisma.userTwoFactorCredential.findUnique({ where: { userId: input.userId } });

  if (!credential || credential.enabledAt) {
    throw new AuthError(409, 'two_factor_setup_missing', 'Start authenticator setup again before entering a code.');
  }

  if (!credential.setupExpiresAt || credential.setupExpiresAt.getTime() <= Date.now()) {
    throw new AuthError(410, 'two_factor_setup_expired', 'This setup session expired. Start again for a new QR code.');
  }

  const timeStep = await verifyTotpCode(credential, input.code);

  if (timeStep === null) {
    throw new AuthError(400, 'invalid_two_factor_code', 'That authenticator code is not valid. Try the current code.');
  }

  const recoveryCodes = createRecoveryCodes(input.userId);
  const now = new Date();
  const user = await prisma.$transaction(async (transaction) => {
    await requireCurrentSecurityState(transaction, input.userId, input.authVersion);
    const activated = await transaction.userTwoFactorCredential.updateMany({
      where: {
        encryptedSecret: credential.encryptedSecret,
        enabledAt: null,
        keyVersion: credential.keyVersion,
        setupExpiresAt: {
          equals: credential.setupExpiresAt,
          gt: now,
        },
        userId: input.userId,
      },
      data: {
        enabledAt: now,
        lastUsedTimeStep: timeStep,
        setupExpiresAt: null,
      },
    });

    if (activated.count !== 1) {
      throw new AuthError(409, 'two_factor_setup_changed', 'Authenticator setup changed. Start again.');
    }

    await transaction.twoFactorRecoveryCode.deleteMany({ where: { userId: input.userId } });
    await transaction.twoFactorRecoveryCode.createMany({
      data: recoveryCodes.map(({ codeHash, codeIndex }) => ({
        codeHash,
        codeIndex,
        userId: input.userId,
      })),
    });
    await transaction.authToken.deleteMany({
      where: { consumedAt: null, userId: input.userId },
    });
    await transaction.twoFactorLoginChallenge.deleteMany({
      where: { userId: input.userId },
    });
    await transaction.authSession.updateMany({
      where: { userId: input.userId, revokedAt: null },
      data: { revokedAt: now },
    });

    return transaction.user.update({
      where: { id: input.userId },
      data: { authVersion: { increment: 1 } },
    });
  });

  return {
    ...await buildAuthenticatedResponse(user, true, input.sessionMetadata),
    recoveryCodes: recoveryCodes.map(({ visibleCode }) => visibleCode),
  };
}

export async function disableTwoFactor(input: {
  authVersion: number;
  code: unknown;
  currentPassword: unknown;
  sessionMetadata: SessionClientMetadata;
  userId: string;
}) {
  await requirePassword(input.userId, input.currentPassword);

  const now = new Date();
  const user = await prisma.$transaction(async (transaction) => {
    await requireCurrentSecurityState(transaction, input.userId, input.authVersion);
    const credential = await transaction.userTwoFactorCredential.findUnique({
      where: { userId: input.userId },
    });

    if (!credential?.enabledAt) {
      throw new AuthError(409, 'two_factor_not_enabled', 'Two-factor authentication is not enabled.');
    }

    if (!(await consumeSecondFactor(transaction, credential, input.code))) {
      throw new AuthError(400, 'invalid_two_factor_code', 'That authenticator or recovery code is not valid.');
    }

    await transaction.userTwoFactorCredential.delete({ where: { userId: input.userId } });
    await transaction.twoFactorLoginChallenge.deleteMany({ where: { userId: input.userId } });
    await transaction.authSession.updateMany({
      where: { userId: input.userId, revokedAt: null },
      data: { revokedAt: now },
    });

    return transaction.user.update({
      where: { id: input.userId },
      data: { authVersion: { increment: 1 } },
    });
  });

  return buildAuthenticatedResponse(user, false, input.sessionMetadata);
}

export async function regenerateRecoveryCodes(input: {
  authVersion: number;
  code: unknown;
  currentPassword: unknown;
  sessionMetadata: SessionClientMetadata;
  userId: string;
}) {
  await requirePassword(input.userId, input.currentPassword);

  const recoveryCodes = createRecoveryCodes(input.userId);
  const now = new Date();
  const user = await prisma.$transaction(async (transaction) => {
    await requireCurrentSecurityState(transaction, input.userId, input.authVersion);
    const credential = await transaction.userTwoFactorCredential.findUnique({
      where: { userId: input.userId },
    });

    if (!credential?.enabledAt) {
      throw new AuthError(409, 'two_factor_not_enabled', 'Enable two-factor authentication first.');
    }

    if (!(await consumeSecondFactor(transaction, credential, input.code))) {
      throw new AuthError(400, 'invalid_two_factor_code', 'That authenticator or recovery code is not valid.');
    }

    await transaction.twoFactorRecoveryCode.deleteMany({ where: { userId: input.userId } });
    await transaction.twoFactorRecoveryCode.createMany({
      data: recoveryCodes.map(({ codeHash, codeIndex }) => ({
        codeHash,
        codeIndex,
        userId: input.userId,
      })),
    });
    await transaction.twoFactorLoginChallenge.deleteMany({
      where: { userId: input.userId },
    });
    await transaction.authSession.updateMany({
      where: { userId: input.userId, revokedAt: null },
      data: { revokedAt: now },
    });

    return transaction.user.update({
      where: { id: input.userId },
      data: { authVersion: { increment: 1 } },
    });
  });

  return {
    ...await buildAuthenticatedResponse(user, true, input.sessionMetadata),
    recoveryCodes: recoveryCodes.map(({ visibleCode }) => visibleCode),
  };
}

export async function completePrimaryAuthentication(
  user: User,
  sessionMetadata: SessionClientMetadata,
) {
  const challengeToken = randomBytes(32).toString('base64url');
  const now = new Date();
  const expiresAt = new Date(now.getTime() + loginChallengeTtlMs);
  const attemptWindowStart = new Date(now.getTime() - accountAttemptWindowMs);
  const staleBefore = new Date(now.getTime() - 24 * 60 * 60 * 1000);

  const outcome = await prisma.$transaction(async (transaction) => {
    const currentUser = await requireCurrentSecurityState(
      transaction,
      user.id,
      user.authVersion,
    );
    const credential = await transaction.userTwoFactorCredential.findUnique({
      where: { userId: user.id },
    });

    if (!credential?.enabledAt) {
      const signedInUser = await transaction.user.update({
        where: { id: user.id },
        data: {
          authUserId: currentUser.authUserId || currentUser.id,
          lastActiveAt: now,
          status: 'active',
        },
      });

      return {
        status: 'authenticated' as const,
        user: signedInUser,
      };
    }

    await transaction.twoFactorLoginChallenge.deleteMany({
      where: {
        OR: [
          { createdAt: { lt: staleBefore } },
          { expiresAt: { lte: now }, lastFailedAt: null },
          { lastFailedAt: { lt: attemptWindowStart } },
        ],
        userId: user.id,
      },
    });

    const recentAttempts = await transaction.twoFactorLoginChallenge.aggregate({
      where: {
        lastFailedAt: { gte: attemptWindowStart },
        userId: user.id,
      },
      _sum: { attempts: true },
    });

    if ((recentAttempts._sum.attempts || 0) >= accountAttemptLimit) {
      throw new AuthError(429, 'two_factor_rate_limited', 'Too many incorrect login codes. Try again in a few minutes.');
    }

    const openChallenges = await transaction.twoFactorLoginChallenge.count({
      where: {
        consumedAt: null,
        expiresAt: { gt: now },
        userId: user.id,
      },
    });

    if (openChallenges >= maxOpenLoginChallenges) {
      throw new AuthError(
        429,
        'two_factor_challenge_limited',
        'Too many login challenges are already open. Use the latest one or try again in a few minutes.',
      );
    }

    await transaction.twoFactorLoginChallenge.create({
      data: {
        expiresAt,
        tokenHash: hashOpaqueToken(challengeToken),
        userId: user.id,
      },
    });

    return {
      challengeToken,
      expiresIn: Math.floor(loginChallengeTtlMs / 1000),
      status: 'two_factor_required' as const,
    };
  });

  if (outcome.status === 'authenticated') {
    return {
      ...await buildAuthenticatedResponse(outcome.user, false, sessionMetadata),
      status: outcome.status,
    };
  }

  return outcome;
}

export async function verifyTwoFactorLogin(input: {
  challengeToken: unknown;
  code: unknown;
  sessionMetadata: SessionClientMetadata;
}) {
  const challengeToken = typeof input.challengeToken === 'string' ? input.challengeToken.trim() : '';

  if (!challengeToken) {
    throw new AuthError(400, 'invalid_two_factor_challenge', 'Start sign-in again to request a new code challenge.');
  }

  const now = new Date();
  const attemptWindowStart = new Date(now.getTime() - accountAttemptWindowMs);
  const outcome = await prisma.$transaction(async (transaction) => {
    const challengeLookup = await transaction.twoFactorLoginChallenge.findUnique({
      where: { tokenHash: hashOpaqueToken(challengeToken) },
      select: { userId: true },
    });

    if (
      !challengeLookup
      || !(await lockUserSecurityState(transaction, challengeLookup.userId))
    ) {
      return { kind: 'expired' as const };
    }

    // Re-read after taking the account lock. Another request may have consumed
    // or deleted this challenge while this transaction was waiting.
    const challenge = await transaction.twoFactorLoginChallenge.findUnique({
      where: { tokenHash: hashOpaqueToken(challengeToken) },
      include: { user: true },
    });

    if (
      !challenge
      || challenge.consumedAt
      || challenge.expiresAt.getTime() <= now.getTime()
      || challenge.attempts >= loginChallengeMaxAttempts
    ) {
      return { kind: 'expired' as const };
    }

    const recentAttempts = await transaction.twoFactorLoginChallenge.aggregate({
      where: {
        lastFailedAt: { gte: attemptWindowStart },
        userId: challenge.userId,
      },
      _sum: { attempts: true },
    });

    if ((recentAttempts._sum.attempts || 0) >= accountAttemptLimit) {
      await transaction.twoFactorLoginChallenge.updateMany({
        where: { id: challenge.id, consumedAt: null },
        data: { consumedAt: now },
      });
      return { kind: 'rate_limited' as const };
    }

    const credential = await transaction.userTwoFactorCredential.findUnique({
      where: { userId: challenge.userId },
    });

    if (!credential?.enabledAt || challenge.user.status === 'banned') {
      await transaction.twoFactorLoginChallenge.update({
        where: { id: challenge.id },
        data: { consumedAt: now },
      });
      return { kind: 'expired' as const };
    }

    if (!(await consumeSecondFactor(transaction, credential, input.code))) {
      const failedAttempt = await transaction.twoFactorLoginChallenge.updateMany({
        where: {
          attempts: { lt: loginChallengeMaxAttempts },
          consumedAt: null,
          expiresAt: { gt: now },
          id: challenge.id,
        },
        data: {
          attempts: { increment: 1 },
          lastFailedAt: now,
        },
      });

      if (failedAttempt.count !== 1) {
        return { kind: 'expired' as const };
      }

      if (challenge.attempts + 1 >= loginChallengeMaxAttempts) {
        await transaction.twoFactorLoginChallenge.update({
          where: { id: challenge.id },
          data: { consumedAt: now },
        });
      }

      return { kind: 'invalid' as const };
    }

    const consumed = await transaction.twoFactorLoginChallenge.updateMany({
      where: { id: challenge.id, consumedAt: null },
      data: { consumedAt: now },
    });

    if (consumed.count !== 1) {
      throw new AuthError(410, 'two_factor_challenge_expired', 'This login challenge expired. Start sign-in again.');
    }

    // A completed authentication resets the short-lived failure budget while
    // also invalidating every other outstanding challenge for this account.
    await transaction.twoFactorLoginChallenge.deleteMany({
      where: { userId: challenge.userId },
    });

    const user = await transaction.user.update({
      where: { id: challenge.userId },
      data: {
        authUserId: challenge.user.authUserId || challenge.user.id,
        lastActiveAt: now,
        status: 'active',
      },
    });

    return { kind: 'authenticated' as const, user };
  });

  if (outcome.kind === 'expired') {
    throw new AuthError(410, 'two_factor_challenge_expired', 'This login challenge expired. Start sign-in again.');
  }

  if (outcome.kind === 'rate_limited') {
    throw new AuthError(429, 'two_factor_rate_limited', 'Too many incorrect login codes. Try again in a few minutes.');
  }

  if (outcome.kind === 'invalid') {
    throw new AuthError(400, 'invalid_two_factor_code', 'That authenticator or recovery code is not valid.');
  }

  return buildAuthenticatedResponse(outcome.user, true, input.sessionMetadata);
}
