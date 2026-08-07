import express, { Router } from 'express';
import { sendAuthError } from '../auth/errors';
import { requireAuth, requireSignedSessionToken, requireSuperAdmin } from '../auth/middleware';
import {
  deleteOrganization,
  getAdminState,
  replaceAdminState,
  updateOrganizationStatus,
} from './service';
import type { AdminBootstrapState } from './types';

export const adminRouter = Router();

// The whole platform state lives behind these routes — every clinic, owner
// email, and payment record — so both reads and writes require a signed session
// belonging to a super admin.
adminRouter.use(requireSignedSessionToken);
adminRouter.use(express.json({ limit: '30mb' }));
adminRouter.use(requireAuth, requireSuperAdmin);

adminRouter.get('/bootstrap', async (_request, response, next) => {
  try {
    const state = await getAdminState();
    response.json(state);
  } catch (error) {
    next(error);
  }
});

adminRouter.put('/bootstrap', async (request, response, next) => {
  try {
    const state = request.body as AdminBootstrapState;
    const nextState = await replaceAdminState(state);
    response.json(nextState);
  } catch (error) {
    next(error);
  }
});

adminRouter.patch('/organizations/:organizationId/status', async (request, response, next) => {
  try {
    const organization = await updateOrganizationStatus({
      expectedStatus: request.body?.expectedStatus,
      organizationId: request.params.organizationId,
      status: request.body?.status,
    });

    response.json({ organization, state: await getAdminState() });
  } catch (error) {
    if (!sendAuthError(error, response)) {
      next(error);
    }
  }
});

// Deleting a company cascades through every clinic table it owns, so it is a
// separate call rather than an omission from the snapshot PUT above. The response
// carries the refreshed state so the console cannot keep showing what it deleted.
adminRouter.delete('/organizations/:organizationId', async (request, response, next) => {
  try {
    const organization = await deleteOrganization(request.params.organizationId);
    response.json({ deleted: organization, state: await getAdminState() });
  } catch (error) {
    if (!sendAuthError(error, response)) {
      next(error);
    }
  }
});
