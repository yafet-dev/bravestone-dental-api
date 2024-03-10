import { Router, type Request, type Response } from 'express';
import { requireAuth } from '../auth/middleware';
import { mergeClinicStateForAccess, scopeClinicStateForAccess } from './access';
import { careHandoffsRouter } from './handoffs/router';
import {
  canOpenFeature,
  resolveWorkspaceAccess,
  type WorkspaceAccess,
  type WorkspaceFeature,
} from './permissions';
import {
  generateClinicAssistantReply,
  generateClinicReportInsights,
  getClinicState,
  replaceClinicState,
} from './service';
import type { ClinicAssistantAttachment, ClinicWorkspaceState } from './types';

export const clinicRouter = Router();

// Every clinic route reads or writes patient data, so all of them need a signed
// session before the handler runs.
clinicRouter.use(requireAuth);

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

    response.json(scopeClinicStateForAccess(context.state, context.access, context.actorId));
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
    const nextState = mergeClinicStateForAccess({
      access: context.access,
      actorId: context.actorId,
      current: context.state,
      incoming: request.body as ClinicWorkspaceState,
    });
    const savedState = await replaceClinicState(nextState, context.organizationId);

    response.json(scopeClinicStateForAccess(savedState, context.access, context.actorId));
  } catch (error) {
    next(error);
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
