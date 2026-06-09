import { Router } from 'express';
import { getAdminState, replaceAdminState } from './service';
import type { AdminBootstrapState } from './types';

export const adminRouter = Router();

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
