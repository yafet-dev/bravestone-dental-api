import { createHash, createHmac, randomBytes, randomInt, timingSafeEqual } from 'node:crypto';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';

const bcryptRounds = 12;
const sessionTtlSeconds = 60 * 60 * 24 * 7; // 7 days
export const minimumPasswordLength = 8;

export const emailVerificationTtlMs = 24 * 60 * 60 * 1000;
export const signupOtpTtlMs = 10 * 60 * 1000;
export const passwordResetTtlMs = 60 * 60 * 1000;
export const invitationTtlMs = 7 * 24 * 60 * 60 * 1000;

export type SessionTokenPayload = {
  authVersion: number;
  email: string;
  role: string;
  sessionId: string;
  userId: string;
};

/**
 * The session secret must be stable across restarts, otherwise every deploy
 * signs everyone out. It is derived from AUTH_JWT_SECRET when present, and
 * otherwise from the database URL so local development works without extra
 * setup while still being unguessable.
 */
function getSessionSecret() {
  const configured = process.env.AUTH_JWT_SECRET?.trim();

  if (configured) {
    return configured;
  }

  const fallbackSeed = process.env.DATABASE_URL?.trim() || process.env.DIRECT_URL?.trim();

  if (!fallbackSeed) {
    throw new Error('Set AUTH_JWT_SECRET in backend.env to sign session tokens.');
  }

  return createHash('sha256').update(`bravestone-session::${fallbackSeed}`).digest('hex');
}

export function hashPassword(password: string) {
  return bcrypt.hash(password, bcryptRounds);
}

export async function verifyPassword(password: string, passwordHash: string | null | undefined) {
  if (!passwordHash) {
    return false;
  }

  try {
    return await bcrypt.compare(password, passwordHash);
  } catch {
    return false;
  }
}

export function describePasswordIssue(password: string) {
  if (password.length < minimumPasswordLength) {
    return `Use a password with at least ${minimumPasswordLength} characters.`;
  }

  return null;
}

export function createSessionToken(payload: SessionTokenPayload) {
  const { sessionId, ...claims } = payload;

  return jwt.sign(claims, getSessionSecret(), {
    algorithm: 'HS256',
    expiresIn: sessionTtlSeconds,
    jwtid: sessionId,
  });
}

export function readSessionToken(token: string): SessionTokenPayload | null {
  try {
    const decoded = jwt.verify(token, getSessionSecret(), { algorithms: ['HS256'] });

    if (!decoded || typeof decoded !== 'object') {
      return null;
    }

    const { authVersion, email, jti, role, userId } = decoded as Record<string, unknown>;

    if (
      typeof email !== 'string'
      || typeof jti !== 'string'
      || !jti
      || typeof role !== 'string'
      || typeof userId !== 'string'
      || !Number.isInteger(authVersion)
      || Number(authVersion) < 0
    ) {
      return null;
    }

    // A server-owned session id is required. Tokens issued before device-session
    // tracking intentionally require one fresh sign-in because they cannot be
    // enumerated or revoked individually.
    return { authVersion: Number(authVersion), email, role, sessionId: jti, userId };
  } catch {
    return null;
  }
}

export function hashSessionToken(token: string) {
  return createHash('sha256').update(token).digest('hex');
}

export function getSessionTtlSeconds() {
  return sessionTtlSeconds;
}

/**
 * Email tokens are random 32-byte secrets. Only their SHA-256 digest is stored,
 * so the raw value exists solely inside the email we send.
 */
export function createEmailToken() {
  const token = randomBytes(32).toString('base64url');

  return { token, tokenHash: hashEmailToken(token) };
}

export function hashEmailToken(token: string) {
  return createHash('sha256').update(token).digest('hex');
}

/**
 * Creates a human-readable signup code and a separate high-entropy challenge id.
 * Including the id in the keyed digest means equal four-digit codes never have
 * equal stored values, while the server-side key prevents offline guessing if
 * the challenge table is ever exposed.
 */
export function createSignupOtp() {
  const challengeId = randomBytes(24).toString('base64url');
  const code = randomInt(0, 10_000).toString().padStart(4, '0');

  return {
    challengeId,
    code,
    codeHash: hashSignupOtp(challengeId, code),
  };
}

export function hashSignupOtp(challengeId: string, code: string) {
  return createHmac('sha256', `bravestone-signup-otp::${getSessionSecret()}`)
    .update(`${challengeId}:${code}`)
    .digest('hex');
}

export function isFourDigitSignupOtp(value: unknown): value is string {
  return typeof value === 'string' && /^\d{4}$/.test(value.trim());
}

export function emailTokensMatch(left: string, right: string) {
  const leftBuffer = Buffer.from(left);
  const rightBuffer = Buffer.from(right);

  if (leftBuffer.length !== rightBuffer.length) {
    return false;
  }

  return timingSafeEqual(leftBuffer, rightBuffer);
}

export function normalizeEmail(email: unknown) {
  return typeof email === 'string' ? email.trim().toLowerCase() : '';
}

export function isValidEmail(email: string) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}
