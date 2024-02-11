import type { NextFunction, Request, Response } from 'express';
import { isSuperAdminRole } from '../clinic/roles';
import { prisma } from '../db';
import { readSessionToken } from './credentials';

export type RequestActor = {
  email: string;
  fullName: string;
  id: string;
  organizationId: string | null;
  role: string;
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

  const user = await prisma.user.findUnique({ where: { id: session.userId } });

  if (!user || user.status === 'banned') {
    return null;
  }

  return {
    email: user.email,
    fullName: user.fullName,
    id: user.id,
    organizationId: user.organizationId,
    role: user.role,
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
