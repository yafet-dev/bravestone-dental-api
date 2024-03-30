import express, { Router, type NextFunction, type Request, type Response } from 'express';
import { sendAuthError } from '../auth/errors';
import { requireAuth } from '../auth/middleware';
import { prisma } from '../db';
import {
  mergeClinicStateForAccess,
  mergeClinicStateForOnboarding,
  scopeClinicStateForAccess,
  scopeClinicStateForOnboarding,
} from './access';
import { loadAiBudget } from './aiBudget';
import { careHandoffsRouter } from './handoffs/router';
import {
  createPatientAttachment,
  deletePatientAttachment,
  describeAttachmentStorage,
  listPatientAttachments,
  reconcilePatientAttachmentReferences,
  resolvePatientAttachment,
  signedReadUrl,
  validatePatientAttachmentReferences,
} from './patientAttachments';
import {
  canOpenFeature,
  resolveWorkspaceAccess,
  type WorkspaceAccess,
  type WorkspaceFeature,
} from './permissions';
import { isClinicAdminRole } from './roles';
import {
  generateClinicAssistantReply,
  generateClinicReportInsights,
  getClinicState,
  replaceClinicState,
} from './service';
import type { ClinicAssistantAttachment, ClinicWorkspaceState } from './types';

export const clinicRouter = Router();

async function requireClinicOrganizationAccess(
  request: Request,
  response: Response,
  next: NextFunction,
) {
  try {
    const organizationId = request.actor?.organizationId;

    if (!organizationId) {
      response.status(403).json({
        code: 'organization_required',
        message: 'Unable to resolve the clinic workspace for this session.',
      });
      return;
    }

    const organization = await prisma.organization.findUnique({
      where: { id: organizationId },
      select: { status: true },
    });
    const organizationStatus = organization?.status.trim().toLowerCase() || '';
    response.locals.organizationStatus = organizationStatus;
    const onboardingBootstrapRequest = (
      organizationStatus === 'onboarding'
      && request.path === '/bootstrap'
      && (request.method === 'GET' || request.method === 'PUT')
    );

    if (
      !organization
      || (
        organizationStatus !== 'active'
        && !onboardingBootstrapRequest
      )
    ) {
      response.status(403).json({
        code: 'organization_access_blocked',
        message: organizationStatus === 'onboarding'
          ? 'Finish clinic onboarding before using the workspace.'
          : organizationStatus === 'trial'
            ? 'This clinic is waiting for approval.'
            : organizationStatus === 'denied'
              ? 'This clinic application was not approved.'
              : 'This clinic workspace is suspended.',
        organizationStatus: organization?.status || null,
      });
      return;
    }

    next();
  } catch (error) {
    next(error);
  }
}

// Every clinic route reads or writes patient data, so all of them need a signed
// session before the handler runs.
clinicRouter.use(requireAuth);
// Denial and suspension apply to every clinic capability, including live
// handoffs, AI, reports, and attachment reads. Enforce the organization state
// once at the router boundary so no individual endpoint can forget the check.
clinicRouter.use(requireClinicOrganizationAccess);
// A 25 MiB accepted image grows to about 33.4 MiB as base64 before JSON
// framing. This parser runs only after requireAuth above.
clinicRouter.use(express.json({ limit: '36mb' }));

// Care handoffs are the one live channel in the workspace, so they carry their
// own small routes instead of riding the whole-workspace bootstrap payload.
clinicRouter.use('/handoffs', careHandoffsRouter);

const assistantAttachmentLimits = {
  maxCount: 4,
  maxDataUrlLength: 6 * 1024 * 1024, // ~4.4MB binary as base64
  maxTextLength: 100_000,
};

function parseAssistantAttachments(value: unknown): ClinicAssistantAttachment[] | { error: string } {
  if (value === undefined || value === null) {
    return [];
  }

  if (!Array.isArray(value)) {
    return { error: 'Attachments must be an array.' };
  }

  if (value.length > assistantAttachmentLimits.maxCount) {
    return { error: `You can attach up to ${assistantAttachmentLimits.maxCount} files per message.` };
  }

  const attachments: ClinicAssistantAttachment[] = [];

  for (const item of value) {
    if (!item || typeof item !== 'object' || Array.isArray(item)) {
      return { error: 'Each attachment must be an object.' };
    }

    const candidate = item as Record<string, unknown>;
    const name = typeof candidate.name === 'string' ? candidate.name.trim().slice(0, 120) : '';
    const type = typeof candidate.type === 'string' ? candidate.type.trim().slice(0, 100) : '';
    const size = typeof candidate.size === 'number' && Number.isFinite(candidate.size)
      ? Math.max(0, Math.round(candidate.size))
      : 0;
    const kind = candidate.kind === 'image' ? 'image' : 'file';
    const dataUrl = typeof candidate.dataUrl === 'string' ? candidate.dataUrl : undefined;
    const textContent = typeof candidate.textContent === 'string' ? candidate.textContent : undefined;

    if (!name) {
      return { error: 'Each attachment needs a file name.' };
    }

    if (dataUrl && (!/^data:[a-z0-9.+/-]+;base64,/i.test(dataUrl) || dataUrl.length > assistantAttachmentLimits.maxDataUrlLength)) {
      return { error: `Attachment "${name}" is too large or not a valid file payload (max 4MB per file).` };
    }

    if (kind === 'image' && dataUrl && !dataUrl.startsWith('data:image/')) {
      return { error: `Attachment "${name}" is not a valid image.` };
    }

    attachments.push({
      id: typeof candidate.id === 'string' && candidate.id.trim() ? candidate.id.trim().slice(0, 80) : `attachment-${attachments.length + 1}`,
      name,
      type: type || 'application/octet-stream',
      size,
      kind,
      ...(dataUrl ? { dataUrl } : {}),
      ...(textContent ? { textContent: textContent.slice(0, assistantAttachmentLimits.maxTextLength) } : {}),
    });
  }

  return attachments;
}

/**
 * The workspace a request may touch comes from the signed-in account's own row,
 * never from a request header. `X-Clinic-Organization-Id` is still honoured, but
 * only as an assertion the server checks — it can never widen access.
 */
function resolveClinicRequestOrganizationId(request: Request) {
  const requestedOrganizationId = typeof request.headers['x-clinic-organization-id'] === 'string'
    ? request.headers['x-clinic-organization-id'].trim()
    : '';
  const organizationId = request.actor?.organizationId || null;

  if (!organizationId) {
    return { error: 'Unable to resolve the clinic workspace for this session.', organizationId: null as string | null, status: 403 };
  }

  if (requestedOrganizationId && requestedOrganizationId !== organizationId) {
    return { error: 'Clinic workspace mismatch for this session.', organizationId: null as string | null, status: 403 };
  }

  return { error: null, organizationId, status: 200 };
}

/**
 * Resolves the caller's workspace together with what their role may do inside
 * it. The role comes from the account row on `request.actor` — never from the
 * workspace snapshot, whose `staffUsers` list the browser writes and a clinic
 * admin can edit, and never from a request header.
 */
async function resolveClinicRequestContext(request: Request, response: Response) {
  const context = resolveClinicRequestOrganizationId(request);

  if (!context.organizationId) {
    response.status(context.status).json({ message: context.error });
    return null;
  }

  const state = await getClinicState(context.organizationId);
  const access = resolveWorkspaceAccess({
    role: request.actor?.role,
    rolePermissions: state.rolePermissions,
  });

  return { access, actorId: request.actor?.id, organizationId: context.organizationId, state };
}

function denyFeature(response: Response, feature: WorkspaceFeature) {
  response.status(403).json({
    code: 'forbidden',
    feature,
    message: 'Your role does not have access to this part of the workspace. Ask a clinic admin to grant it.',
  });
}

function requireFeature(access: WorkspaceAccess, feature: WorkspaceFeature, response: Response) {
  if (!canOpenFeature(access, feature)) {
    denyFeature(response, feature);
    return false;
  }

  return true;
}

/**
 * What the signed-in account may open. The browser mirrors this calculation to
 * draw its sidebar; this endpoint is the authoritative answer, and it is what a
 * client should trust when the two disagree.
 */
clinicRouter.get('/access', async (request, response, next) => {
  try {
    const context = await resolveClinicRequestContext(request, response);

    if (!context) {
      return;
    }

    response.json({ access: context.access });
  } catch (error) {
    next(error);
  }
});

clinicRouter.get('/bootstrap', async (request, response, next) => {
  try {
    const context = await resolveClinicRequestContext(request, response);

    if (!context) {
      return;
    }

    response.json(
      response.locals.organizationStatus === 'onboarding'
        ? scopeClinicStateForOnboarding(context.state, context.actorId)
        : scopeClinicStateForAccess(context.state, context.access, context.actorId),
    );
  } catch (error) {
    next(error);
  }
});

clinicRouter.put('/bootstrap', async (request, response, next) => {
  try {
    const context = await resolveClinicRequestContext(request, response);

    if (!context) {
      return;
    }

    // The caller holds a redacted copy of the workspace, so their payload is
    // treated as a set of proposed edits against the stored state rather than as
    // a replacement for it. Anything they cannot read survives untouched, and
    // anything they cannot manage — roles, grants, branches, other people's
    // accounts — is taken from storage regardless of what they sent.
    let nextState: ClinicWorkspaceState;

    if (response.locals.organizationStatus === 'onboarding') {
      if (!isClinicAdminRole(request.actor?.role || '')) {
        response.status(403).json({
          code: 'forbidden',
          message: 'Only the clinic owner can submit this application.',
        });
        return;
      }

      try {
        nextState = mergeClinicStateForOnboarding({
          actorId: context.actorId,
          current: context.state,
          incoming: request.body as ClinicWorkspaceState,
        });
      } catch (error) {
        response.status(400).json({
          code: 'invalid_onboarding_application',
          message: error instanceof Error
            ? error.message
            : 'The clinic application is incomplete.',
        });
        return;
      }
    } else {
      // The caller holds a redacted copy of the workspace, so their payload is
      // treated as a set of proposed edits against the stored state rather than as
      // a replacement for it. Anything they cannot read survives untouched, and
      // anything they cannot manage — roles, grants, branches, other people's
      // accounts — is taken from storage regardless of what they sent.
      nextState = mergeClinicStateForAccess({
        access: context.access,
        actorId: context.actorId,
        current: context.state,
        incoming: request.body as ClinicWorkspaceState,
      });
    }
    await validatePatientAttachmentReferences({
      diagnoses: nextState.diagnoses,
      organizationId: context.organizationId,
    });
    const savedState = await replaceClinicState(
      nextState,
      context.organizationId,
      response.locals.organizationStatus === 'onboarding'
        ? { expectedOrganizationStatus: 'onboarding' }
        : undefined,
    );
    await reconcilePatientAttachmentReferences({
      diagnoses: savedState.diagnoses,
      organizationId: context.organizationId,
    });

    response.json(
      response.locals.organizationStatus === 'onboarding'
        ? scopeClinicStateForOnboarding(savedState, context.actorId)
        : scopeClinicStateForAccess(savedState, context.access, context.actorId),
    );
  } catch (error) {
    if (!sendAuthError(error, response)) {
      next(error);
    }
  }
});

clinicRouter.post('/assistant/reply', async (request, response, next) => {
  try {
    const context = await resolveClinicRequestContext(request, response);

    if (!context) {
      return;
    }

    if (!requireFeature(context.access, 'ai_assistant', response)) {
      return;
    }

    const message = typeof request.body?.message === 'string' ? request.body.message.trim() : '';
    const sessionId = typeof request.body?.sessionId === 'string' ? request.body.sessionId.trim() : '';
    const parsedAttachments = parseAssistantAttachments(request.body?.attachments);

    if (!Array.isArray(parsedAttachments)) {
      response.status(400).json({ message: parsedAttachments.error });
      return;
    }

    if (!message && !parsedAttachments.length) {
      response.status(400).json({ message: 'A message or attachment is required.' });
      return;
    }

    // The assistant answers from the workspace, so it has to answer from the
    // caller's redacted view of it. Passing the caller's access here is what
    // stops "what did we collect this month?" from becoming a way around the
    // financial grant.
    const reply = await generateClinicAssistantReply(
      message || 'Please review the attached file(s).',
      context.organizationId,
      sessionId || undefined,
      parsedAttachments.length ? parsedAttachments : undefined,
      context.access,
      context.actorId
    );
    response.json(reply);
  } catch (error) {
    next(error);
  }
});

// Lets the assistant screen show the remaining allowance and its reset countdown
// without having to send a message first. Reading is deliberately not gated on
// the `ai_assistant` feature: a clinic whose AI is switched off still benefits
// from seeing why.
clinicRouter.get('/assistant/budget', async (request, response, next) => {
  try {
    const context = await resolveClinicRequestContext(request, response);

    if (!context) {
      return;
    }

    const budget = await loadAiBudget(context.organizationId);

    if (!budget) {
      response.status(404).json({ message: 'This clinic workspace does not exist yet.' });
      return;
    }

    response.json({
      budget: {
        budgetUsd: budget.budgetUsd,
        spentUsd: budget.spentUsd,
        remainingUsd: budget.remainingUsd,
        usedPercent: budget.usedPercent,
        inputTokens: budget.inputTokens,
        outputTokens: budget.outputTokens,
        remainingTokensEstimate: budget.remainingTokensEstimate,
        resetAt: budget.resetAt,
        resetInSeconds: budget.resetInSeconds,
        exhausted: budget.exhausted,
      },
    });
  } catch (error) {
    next(error);
  }
});

clinicRouter.post('/report-insights', async (request, response, next) => {
  try {
    const context = await resolveClinicRequestContext(request, response);

    if (!context) {
      return;
    }

    if (!requireFeature(context.access, 'reports', response)) {
      return;
    }

    // Every insight card quotes revenue, collection, or outstanding balances, so
    // the whole set follows the financial grant.
    if (!context.access.canViewClinicFinances) {
      denyFeature(response, 'reports');
      return;
    }

    const insights = await generateClinicReportInsights(context.organizationId);
    response.json(insights);
  } catch (error) {
    next(error);
  }
});

/**
 * Patient record images.
 *
 * The bytes live in a private bucket, not in the workspace snapshot, so these are
 * separate small routes rather than part of the bootstrap payload — a chart with
 * twenty photos should not make every page load carry twenty images.
 *
 * Reads are streamed through the API with the session token in an Authorization
 * header, so no credential ever appears in a URL and the storage path never reaches
 * the browser.
 */
clinicRouter.get('/patient-attachments', async (request, response, next) => {
  try {
    const context = await resolveClinicRequestContext(request, response);

    if (!context) {
      return;
    }

    const patientId = typeof request.query.patientId === 'string' ? request.query.patientId.trim() : '';
    const attachments = await listPatientAttachments({
      access: context.access,
      organizationId: context.organizationId,
      ...(patientId ? { patientId } : {}),
    });

    response.json({ attachments, storage: describeAttachmentStorage() });
  } catch (error) {
    if (!sendAuthError(error, response)) {
      next(error);
    }
  }
});

clinicRouter.post('/patient-attachments', async (request, response, next) => {
  try {
    const context = await resolveClinicRequestContext(request, response);

    if (!context) {
      return;
    }

    const attachment = await createPatientAttachment({
      access: context.access,
      actorId: context.actorId,
      actorName: request.actor?.fullName,
      body: (request.body ?? {}) as Record<string, unknown>,
      organizationId: context.organizationId,
    });

    response.status(201).json({ attachment });
  } catch (error) {
    if (!sendAuthError(error, response)) {
      next(error);
    }
  }
});

/**
 * Authorizes a direct bucket read and returns a URL that expires after two minutes.
 *
 * The local development driver cannot sign URLs, so it returns `url: null`; clients
 * then use the authenticated `/content` fallback below.
 */
clinicRouter.get('/patient-attachments/:attachmentId/signed-url', async (request, response, next) => {
  try {
    const context = await resolveClinicRequestContext(request, response);

    if (!context) {
      return;
    }

    const signed = await signedReadUrl({
      access: context.access,
      attachmentId: request.params.attachmentId!,
      organizationId: context.organizationId,
    });

    response.setHeader('Cache-Control', 'no-store');
    response.json(signed);
  } catch (error) {
    if (!sendAuthError(error, response)) {
      next(error);
    }
  }
});

clinicRouter.get('/patient-attachments/:attachmentId/content', async (request, response, next) => {
  try {
    const context = await resolveClinicRequestContext(request, response);

    if (!context) {
      return;
    }

    const resolved = await resolvePatientAttachment({
      access: context.access,
      attachmentId: request.params.attachmentId!,
      organizationId: context.organizationId,
    });

    // Clinical images must never sit in a shared cache. `private` keeps them out of
    // proxies while still letting the browser reuse them while the chart is open.
    response.setHeader('Cache-Control', 'private, max-age=300');
    response.setHeader('Content-Type', resolved.contentType);
    response.setHeader('Content-Disposition', `inline; filename="${resolved.fileName}"`);
    response.send(resolved.contents);
  } catch (error) {
    if (!sendAuthError(error, response)) {
      next(error);
    }
  }
});

clinicRouter.delete('/patient-attachments/:attachmentId', async (request, response, next) => {
  try {
    const context = await resolveClinicRequestContext(request, response);

    if (!context) {
      return;
    }

    response.json(await deletePatientAttachment({
      access: context.access,
      attachmentId: request.params.attachmentId!,
      organizationId: context.organizationId,
    }));
  } catch (error) {
    if (!sendAuthError(error, response)) {
      next(error);
    }
  }
});
