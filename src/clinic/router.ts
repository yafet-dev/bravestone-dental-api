import { Router, type Request } from 'express';
import { resolveClinicOrganizationIdByAuthUserId } from '../auth/service';
import {
  generateClinicAssistantReply,
  generateClinicReportInsights,
  getClinicState,
  replaceClinicState,
} from './service';
import type { ClinicAssistantAttachment, ClinicWorkspaceState } from './types';

export const clinicRouter = Router();

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

async function resolveClinicRequestOrganizationId(request: Request) {
  const authUserId = typeof request.headers['x-clinic-auth-user-id'] === 'string'
    ? request.headers['x-clinic-auth-user-id'].trim()
    : '';
  const requestedOrganizationId = typeof request.headers['x-clinic-organization-id'] === 'string'
    ? request.headers['x-clinic-organization-id'].trim()
    : '';

  if (!authUserId) {
    return { error: 'Missing clinic session header.', organizationId: null as string | null, status: 401 };
  }

  const organizationId = await resolveClinicOrganizationIdByAuthUserId(authUserId);

  if (!organizationId) {
    return { error: 'Unable to resolve the clinic workspace for this session.', organizationId: null as string | null, status: 403 };
  }

  if (requestedOrganizationId && requestedOrganizationId !== organizationId) {
    return { error: 'Clinic workspace mismatch for this session.', organizationId: null as string | null, status: 403 };
  }

  return { error: null, organizationId, status: 200 };
}

clinicRouter.get('/bootstrap', async (request, response, next) => {
  try {
    const context = await resolveClinicRequestOrganizationId(request);

    if (!context.organizationId) {
      response.status(context.status).json({ message: context.error });
      return;
    }

    const state = await getClinicState(context.organizationId);
    response.json(state);
  } catch (error) {
    next(error);
  }
});

clinicRouter.put('/bootstrap', async (request, response, next) => {
  try {
    const context = await resolveClinicRequestOrganizationId(request);

    if (!context.organizationId) {
      response.status(context.status).json({ message: context.error });
      return;
    }

    const state = request.body as ClinicWorkspaceState;
    const nextState = await replaceClinicState(state, context.organizationId);
    response.json(nextState);
  } catch (error) {
    next(error);
  }
});

clinicRouter.post('/assistant/reply', async (request, response, next) => {
  try {
    const context = await resolveClinicRequestOrganizationId(request);

    if (!context.organizationId) {
      response.status(context.status).json({ message: context.error });
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

    const reply = await generateClinicAssistantReply(
      message || 'Please review the attached file(s).',
      context.organizationId,
      sessionId || undefined,
      parsedAttachments.length ? parsedAttachments : undefined
    );
    response.json(reply);
  } catch (error) {
    next(error);
  }
});

clinicRouter.post('/report-insights', async (request, response, next) => {
  try {
    const context = await resolveClinicRequestOrganizationId(request);

    if (!context.organizationId) {
      response.status(context.status).json({ message: context.error });
      return;
    }

    const insights = await generateClinicReportInsights(context.organizationId);
    response.json(insights);
  } catch (error) {
    next(error);
  }
});
