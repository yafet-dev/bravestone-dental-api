import express, { Router } from 'express';
import { sendAuthError } from '../auth/errors';
import { requireAuth, requireSignedSessionToken } from '../auth/middleware';
import { saveUserAvatar } from './avatars';

export const usersRouter = Router();

usersRouter.post(
  '/me/avatar',
  requireSignedSessionToken,
  express.json({ limit: '8mb' }),
  requireAuth,
  async (request, response, next) => {
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
  },
);
