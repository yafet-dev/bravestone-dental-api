import { Router, type Request } from 'express';
import { resolveClinicOrganizationIdByAuthUserId } from '../auth/service';
import {
  generateClinicAssistantReply,
  generateClinicReportInsights,
  getClinicState,
  replaceClinicState,
} from './service';
import type { ClinicWorkspaceState } from './types';

export const clinicRouter = Router();

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

    if (!message) {
      response.status(400).json({ message: 'A message is required.' });
      return;
    }

    const reply = await generateClinicAssistantReply(message, context.organizationId);
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
