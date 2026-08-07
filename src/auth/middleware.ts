import type { NextFunction, Request, Response } from 'express';
import { isSuperAdminRole } from '../clinic/roles';
import { prisma } from '../db';
import { hashSessionToken, readSessionToken } from './credentials';
import { readSessionClientMetadata } from './sessions';

const lastSeenWriteIntervalMs = 5 * 60 * 1000;

export type RequestActor = {
  authVersion: number;
  email: string;
  fullName: string;
  id: string;
  organizationId: string | null;
  role: string;
  sessionId: string;
};

declare module 'express-serve-static-core' {
  interface Request {
    actor?: RequestActor;
  }
}

function readBearerToken(request: Request) {
  const header = request.headers.authorization;

  if (typeof header !== 'string') {
    return '';
  }

  const [scheme, value] = header.split(' ');

  if (!value || scheme?.toLowerCase() !== 'bearer') {
    return '';
  }

  return value.trim();
}

/**
 * Performs the synchronous, cryptographic part of session validation before a
 * request body is read. Body parsers must subscribe to the incoming stream
 * before any asynchronous database middleware yields; otherwise a short or
 * empty chunked request can finish first and body-parser sees an unreadable
 * stream. Full revocation, account, and organization checks still happen in
 * requireAuth after parsing.
 */
export function requireSignedSessionToken(request: Request, response: Response, next: NextFunction) {
  const token = readBearerToken(request);

  if (!token || !readSessionToken(token)) {
    response.status(401).json({ code: 'unauthenticated', message: 'Sign in to continue.' });
    return;
  }

  next();
}

/**
 * Resolves the caller from their signed session token, and only from that. A
 * bare user id in a request header is not proof of anything — it identifies an
 * account without demonstrating control of it — so it is never accepted.
 */
export async function resolveRequestActor(request: Request): Promise<RequestActor | null> {
  const token = readBearerToken(request);
  const session = token ? readSessionToken(token) : null;

  if (!session) {
    return null;
  }

  const storedSession = await prisma.authSession.findUnique({
    where: { id: session.sessionId },
    include: { user: true },
  });
  const now = new Date();
  const user = storedSession?.user;

  if (
    !storedSession
    || !user
    || storedSession.authVersion !== session.authVersion
    || storedSession.expiresAt.getTime() <= now.getTime()
    || storedSession.revokedAt
    || storedSession.tokenHash !== hashSessionToken(token)
    || storedSession.userId !== session.userId
    || user.status === 'banned'
    || user.authVersion !== session.authVersion
  ) {
    return null;
  }

  if (storedSession.lastSeenAt.getTime() <= now.getTime() - lastSeenWriteIntervalMs) {
    const metadata = readSessionClientMetadata(request);

    await prisma.authSession.updateMany({
      where: {
        id: storedSession.id,
        lastSeenAt: { lte: new Date(now.getTime() - lastSeenWriteIntervalMs) },
        revokedAt: null,
      },
      data: {
        ipAddress: metadata.ipAddress,
        lastSeenAt: now,
        userAgent: metadata.userAgent,
      },
    });
  }

  return {
    authVersion: user.authVersion,
    email: user.email,
    fullName: user.fullName,
    id: user.id,
    organizationId: user.organizationId,
    role: user.role,
    sessionId: storedSession.id,
  };
}

export async function requireAuth(request: Request, response: Response, next: NextFunction) {
  try {
    const actor = await resolveRequestActor(request);

    if (!actor) {
      response.status(401).json({ code: 'unauthenticated', message: 'Sign in to continue.' });
      return;
    }

    request.actor = actor;
    next();
  } catch (error) {
    next(error);
  }
}

/**
 * Platform console access. The role stored on the user row is the only accepted
 * signal — never a client-supplied value, an email pattern, or a role read out
 * of the clinic workspace snapshot (which clinic admins can edit themselves).
 */
export function requireSuperAdmin(request: Request, response: Response, next: NextFunction) {
  if (!request.actor) {
    response.status(401).json({ code: 'unauthenticated', message: 'Sign in to continue.' });
    return;
  }

  if (!isSuperAdminRole(request.actor.role)) {
    response.status(403).json({ code: 'forbidden', message: 'This area is restricted to platform super admins.' });
    return;
  }

  next();
}
