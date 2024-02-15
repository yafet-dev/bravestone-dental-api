import { randomUUID } from 'node:crypto';
import type { User } from '@prisma/client';
import type { Request } from 'express';
import { prisma } from '../db';
import {
  createSessionToken,
  getSessionTtlSeconds,
  hashSessionToken,
} from './credentials';
import { AuthError } from './errors';
import { lockUserSecurityState } from './securityState';

const maximumActiveSessions = 20;
const sessionHistoryRetentionMs = 30 * 24 * 60 * 60 * 1000;
const maximumUserAgentLength = 512;
const maximumIpAddressLength = 64;

export type SessionClientMetadata = {
  browser: string;
  deviceLabel: string;
  deviceType: 'desktop' | 'mobile' | 'tablet' | 'unknown';
  ipAddress: string | null;
  os: string;
  userAgent: string | null;
};

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
  twoFactorEnabled: boolean;
};

function boundedText(value: unknown, maximumLength: number) {
  if (typeof value !== 'string') {
    return '';
  }

  return value.replace(/[\u0000-\u001f\u007f]/g, ' ').trim().slice(0, maximumLength);
}

function describeBrowser(userAgent: string) {
  const browserMatchers: Array<[RegExp, string]> = [
    [/\bEdgA?\/(\d+)/i, 'Edge'],
    [/\bOPR\/(\d+)/i, 'Opera'],
    [/\bCriOS\/(\d+)/i, 'Chrome'],
    [/\bChrome\/(\d+)/i, 'Chrome'],
    [/\bFxiOS\/(\d+)/i, 'Firefox'],
    [/\bFirefox\/(\d+)/i, 'Firefox'],
    [/\bVersion\/(\d+).*\bSafari\//i, 'Safari'],
  ];

  for (const [pattern, name] of browserMatchers) {
    const match = userAgent.match(pattern);

    if (match) {
      return `${name} ${match[1]}`;
    }
  }

  return userAgent ? 'Unknown browser' : 'Unknown browser';
}

function describeOperatingSystem(userAgent: string) {
  const android = userAgent.match(/\bAndroid\s+([\d.]+)/i);

  if (android) {
    return `Android ${android[1]}`;
  }

  const ios = userAgent.match(/\b(?:CPU (?:iPhone )?OS|iPhone OS)\s+([\d_]+)/i);

  if (ios) {
    return `iOS ${ios[1].replace(/_/g, '.')}`;
  }

  const windows = userAgent.match(/\bWindows NT\s+([\d.]+)/i);

  if (windows) {
    const version = ({
      '10.0': '10/11',
      '6.3': '8.1',
      '6.2': '8',
      '6.1': '7',
    } as Record<string, string>)[windows[1]] || windows[1];

    return `Windows ${version}`;
  }

  const macOs = userAgent.match(/\bMac OS X\s+([\d_]+)/i);

  if (macOs) {
    return `macOS ${macOs[1].replace(/_/g, '.')}`;
  }

  if (/\bLinux\b/i.test(userAgent)) {
    return 'Linux';
  }

  return 'Unknown OS';
}

function describeDeviceType(userAgent: string): SessionClientMetadata['deviceType'] {
  if (/\b(iPad|Tablet|Nexus 7|Nexus 9|SM-T)\b/i.test(userAgent)) {
    return 'tablet';
  }

  if (/\b(Mobi|iPhone|Android)\b/i.test(userAgent)) {
    return 'mobile';
  }

  return userAgent ? 'desktop' : 'unknown';
}

function normalizeIpAddress(value: unknown) {
  const address = boundedText(value, maximumIpAddressLength);

  if (!address) {
    return null;
  }

  return address.startsWith('::ffff:') ? address.slice(7) : address;
}

/**
 * User agent and address are display-only hints. Neither value participates in
 * authentication because both can change and may be controlled by the client.
 * `request.ip` deliberately ignores X-Forwarded-For until a known proxy topology
 * is configured by the deployment.
 */
export function readSessionClientMetadata(request: Request): SessionClientMetadata {
  const userAgent = boundedText(request.get('user-agent'), maximumUserAgentLength);
  const browser = describeBrowser(userAgent);
  const os = describeOperatingSystem(userAgent);
  const deviceType = describeDeviceType(userAgent);

  return {
    browser,
    deviceLabel: `${browser} on ${os}`,
    deviceType,
    ipAddress: normalizeIpAddress(request.ip || request.socket.remoteAddress),
    os,
    userAgent: userAgent || null,
  };
}

export function toPublicUser(user: User, twoFactorEnabled = false): PublicUser {
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
    twoFactorEnabled,
  };
}

export async function buildSession(user: User, metadata: SessionClientMetadata) {
  const now = new Date();
  const expiresIn = getSessionTtlSeconds();
  const expiresAt = new Date(now.getTime() + expiresIn * 1000);
  const sessionId = randomUUID();
  const token = createSessionToken({
    authVersion: user.authVersion,
    email: user.email,
    role: user.role,
    sessionId,
    userId: user.id,
  });

  await prisma.$transaction(async (transaction) => {
    await transaction.authSession.create({
      data: {
        authVersion: user.authVersion,
        browser: metadata.browser,
        deviceLabel: metadata.deviceLabel,
        deviceType: metadata.deviceType,
        expiresAt,
        id: sessionId,
        ipAddress: metadata.ipAddress,
        lastSeenAt: now,
        os: metadata.os,
        tokenHash: hashSessionToken(token),
        userAgent: metadata.userAgent,
        userId: user.id,
      },
    });

    const overflow = await transaction.authSession.findMany({
      where: {
        authVersion: user.authVersion,
        expiresAt: { gt: now },
        revokedAt: null,
        userId: user.id,
      },
      orderBy: [
        { lastSeenAt: 'desc' },
        { createdAt: 'desc' },
      ],
      skip: maximumActiveSessions,
      select: { id: true },
    });

    if (overflow.length) {
      await transaction.authSession.updateMany({
        where: { id: { in: overflow.map(({ id }) => id) }, revokedAt: null },
        data: { revokedAt: now },
      });
    }

    const retentionCutoff = new Date(now.getTime() - sessionHistoryRetentionMs);
    await transaction.authSession.deleteMany({
      where: {
        userId: user.id,
        OR: [
          { expiresAt: { lt: retentionCutoff } },
          { revokedAt: { lt: retentionCutoff } },
        ],
      },
    });
  });

  return { expiresIn, token };
}

export async function buildAuthenticatedResponse(
  user: User,
  twoFactorEnabled = false,
  metadata: SessionClientMetadata,
) {
  return {
    session: await buildSession(user, metadata),
    user: toPublicUser(user, twoFactorEnabled),
  };
}

export async function listActiveSessions(input: {
  authVersion: number;
  currentSessionId: string;
  userId: string;
}) {
  const now = new Date();
  const sessions = await prisma.authSession.findMany({
    where: {
      authVersion: input.authVersion,
      expiresAt: { gt: now },
      revokedAt: null,
      userId: input.userId,
    },
    orderBy: [
      { lastSeenAt: 'desc' },
      { createdAt: 'desc' },
    ],
    take: maximumActiveSessions,
  });

  return sessions
    .sort((left, right) => Number(right.id === input.currentSessionId) - Number(left.id === input.currentSessionId))
    .map((session) => ({
      browser: session.browser,
      createdAt: session.createdAt.toISOString(),
      current: session.id === input.currentSessionId,
      deviceLabel: session.deviceLabel,
      deviceType: session.deviceType,
      expiresAt: session.expiresAt.toISOString(),
      id: session.id,
      ipAddress: session.ipAddress,
      lastSeenAt: session.lastSeenAt.toISOString(),
      os: session.os,
    }));
}

export async function revokeActiveSession(input: {
  authVersion: number;
  currentSessionId: string;
  sessionId: string;
  userId: string;
}) {
  const now = new Date();
  const revoked = await prisma.authSession.updateMany({
    where: {
      authVersion: input.authVersion,
      expiresAt: { gt: now },
      id: input.sessionId,
      revokedAt: null,
      userId: input.userId,
    },
    data: { revokedAt: now },
  });

  if (revoked.count !== 1) {
    throw new AuthError(404, 'session_not_found', 'That active session no longer exists.');
  }

  return {
    revoked: true as const,
    revokedCurrent: input.sessionId === input.currentSessionId,
  };
}

export async function revokeOtherSessions(input: {
  authVersion: number;
  currentSessionId: string;
  metadata: SessionClientMetadata;
  userId: string;
}) {
  const now = new Date();
  const outcome = await prisma.$transaction(async (transaction) => {
    if (!(await lockUserSecurityState(transaction, input.userId))) {
      throw new AuthError(404, 'user_not_found', 'This account no longer exists.');
    }

    const currentUser = await transaction.user.findUnique({ where: { id: input.userId } });
    const currentSession = await transaction.authSession.findFirst({
      where: {
        authVersion: input.authVersion,
        expiresAt: { gt: now },
        id: input.currentSessionId,
        revokedAt: null,
        userId: input.userId,
      },
    });

    if (
      !currentUser
      || currentUser.status === 'banned'
      || currentUser.authVersion !== input.authVersion
      || !currentSession
    ) {
      throw new AuthError(401, 'session_expired', 'This session is no longer active. Sign in again.');
    }

    const revokedCount = await transaction.authSession.count({
      where: {
        authVersion: input.authVersion,
        expiresAt: { gt: now },
        id: { not: input.currentSessionId },
        revokedAt: null,
        userId: input.userId,
      },
    });

    await transaction.authSession.updateMany({
      where: {
        authVersion: input.authVersion,
        revokedAt: null,
        userId: input.userId,
      },
      data: { revokedAt: now },
    });
    await transaction.twoFactorLoginChallenge.deleteMany({ where: { userId: input.userId } });

    const user = await transaction.user.update({
      where: { id: input.userId },
      data: { authVersion: { increment: 1 } },
    });
    const credential = await transaction.userTwoFactorCredential.findUnique({
      where: { userId: input.userId },
      select: { enabledAt: true },
    });

    return {
      revokedCount,
      twoFactorEnabled: Boolean(credential?.enabledAt),
      user,
    };
  });

  return {
    ...await buildAuthenticatedResponse(outcome.user, outcome.twoFactorEnabled, input.metadata),
    revokedCount: outcome.revokedCount,
  };
}
