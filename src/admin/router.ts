import { Router } from 'express';
import { requireAuth, requireSuperAdmin } from '../auth/middleware';
import { getAdminState, replaceAdminState } from './service';
import type { AdminBootstrapState } from './types';

export const adminRouter = Router();

// The whole platform state lives behind these two routes — every clinic, owner
// email, and payment record — so both reads and writes require a signed session
// belonging to a super admin.
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
