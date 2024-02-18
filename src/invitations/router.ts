import { Router } from 'express';
import { AuthError } from '../auth/accounts';
import { sendAuthError } from '../auth/errors';
import { requireAuth } from '../auth/middleware';
import { credentialRateLimit, invitationRateLimit } from '../auth/rateLimits';
import { isClinicAdminRole, isSuperAdminRole } from '../clinic/roles';
import {
  acceptInvitation,
  createInvitation,
  describeInvitationToken,
  listInvitations,
  resendInvitation,
  revokeInvitation,
} from './service';

export const invitationsRouter = Router();

/**
 * Who a caller may invite: super admins act across every clinic (and must name
 * the target organization), clinic admins act only inside their own.
 */
function resolveInviteScope(actor: { organizationId: string | null; role: string }, requestedOrganizationId: unknown) {
  const requested = typeof requestedOrganizationId === 'string' ? requestedOrganizationId.trim() : '';

  if (isSuperAdminRole(actor.role)) {
    const organizationId = requested || actor.organizationId;

    if (!organizationId) {
      throw new AuthError(400, 'organization_required', 'Choose which clinic this invitation is for.');
    }

    return { organizationId, scopeToOrganization: null as string | null };
  }

  if (!isClinicAdminRole(actor.role)) {
    throw new AuthError(403, 'forbidden', 'Only clinic admins can manage invitations.');
  }

  if (!actor.organizationId) {
    throw new AuthError(403, 'no_organization', 'Your account is not attached to a clinic yet.');
  }

  if (requested && requested !== actor.organizationId) {
    throw new AuthError(403, 'forbidden', 'You can only invite people into your own clinic.');
  }

  return { organizationId: actor.organizationId, scopeToOrganization: actor.organizationId };
}

invitationsRouter.get('/', requireAuth, async (request, response, next) => {
  try {
    const actor = request.actor!;
    const requestedOrganizationId = typeof request.query.organizationId === 'string'
      ? request.query.organizationId.trim()
      : '';

    if (isSuperAdminRole(actor.role)) {
      response.json({ invitations: await listInvitations(requestedOrganizationId || null) });
      return;
    }

    if (!actor.organizationId) {
      response.json({ invitations: [] });
      return;
    }

    response.json({ invitations: await listInvitations(actor.organizationId) });
  } catch (error) {
    if (!sendAuthError(error, response)) {
      next(error);
    }
  }
});

invitationsRouter.post('/', requireAuth, invitationRateLimit, async (request, response, next) => {
  try {
    const actor = request.actor!;
    const scope = resolveInviteScope(actor, request.body?.organizationId);
    const result = await createInvitation({
      branchId: request.body?.branchId,
      email: request.body?.email,
      fullName: request.body?.fullName,
      invitedByUserId: actor.id,
      organizationId: scope.organizationId,
      role: request.body?.role,
    });

    // A delivery failure is a real failure: report it as one so the UI can say so.
    response.status(result.delivery.sent ? 201 : 502).json(result);
  } catch (error) {
    if (!sendAuthError(error, response)) {
      next(error);
    }
  }
});

invitationsRouter.post('/:invitationId/resend', requireAuth, invitationRateLimit, async (request, response, next) => {
  try {
    const actor = request.actor!;
    const scope = resolveInviteScope(actor, request.body?.organizationId);
    const result = await resendInvitation({
      invitationId: request.params.invitationId,
      organizationId: scope.scopeToOrganization,
    });

    response.status(result.delivery.sent ? 200 : 502).json(result);
  } catch (error) {
    if (!sendAuthError(error, response)) {
      next(error);
    }
  }
});

invitationsRouter.delete('/:invitationId', requireAuth, async (request, response, next) => {
  try {
    const actor = request.actor!;
    const scope = resolveInviteScope(actor, request.body?.organizationId);

    response.json(await revokeInvitation({
      invitationId: request.params.invitationId,
      organizationId: scope.scopeToOrganization,
    }));
  } catch (error) {
    if (!sendAuthError(error, response)) {
      next(error);
    }
  }
});

// The accept screen runs before the invitee has any session, so these two are public.
invitationsRouter.get('/token/:token', credentialRateLimit, async (request, response, next) => {
  try {
    response.json({ invitation: await describeInvitationToken(request.params.token) });
  } catch (error) {
    if (!sendAuthError(error, response)) {
      next(error);
    }
  }
});

invitationsRouter.post('/accept', credentialRateLimit, async (request, response, next) => {
  try {
    response.json(await acceptInvitation({
      fullName: request.body?.fullName,
      password: request.body?.password,
      token: request.body?.token,
    }));
  } catch (error) {
    if (!sendAuthError(error, response)) {
      next(error);
    }
  }
});
