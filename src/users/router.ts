import express, { Router } from 'express';
import { sendAuthError } from '../auth/errors';
import { requireAuth } from '../auth/middleware';
import { saveUserAvatar } from './avatars';

export const usersRouter = Router();

usersRouter.post('/me/avatar', requireAuth, express.json({ limit: '8mb' }), async (request, response, next) => {
  try {
    response.json(await saveUserAvatar({
      dataUrl: request.body?.dataUrl,
      userId: request.actor!.id,
    }));
  } catch (error) {
    if (!sendAuthError(error, response)) {
      next(error);
    }
  }
});
