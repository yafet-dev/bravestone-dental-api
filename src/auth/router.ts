import { Router } from 'express';
import { syncSessionUser } from './service';

export const authRouter = Router();

authRouter.post('/session-user', async (request, response, next) => {
  try {
    const authUserId = typeof request.body?.authUserId === 'string' ? request.body.authUserId.trim() : '';
    const email = typeof request.body?.email === 'string' ? request.body.email.trim() : '';

    if (!authUserId || !email) {
      response.status(400).json({ message: 'authUserId and email are required.' });
      return;
    }

    const syncedUser = await syncSessionUser({
      authUserId,
      avatarUrl: typeof request.body?.avatarUrl === 'string' ? request.body.avatarUrl : undefined,
      email,
      fullName: typeof request.body?.fullName === 'string' ? request.body.fullName : undefined,
      isAdmin: Boolean(request.body?.isAdmin),
    });

    response.json({ user: syncedUser });
  } catch (error) {
    next(error);
  }
});
