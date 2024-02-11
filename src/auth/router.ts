import { Router } from 'express';
import { isSuperAdminRole } from '../clinic/roles';
import {
  changeOwnPassword,
  getAccountById,
  loginWithPassword,
  registerAccount,
  requestPasswordReset,
  resendVerificationEmail,
  resetPasswordWithToken,
  verifyEmailAddress,
} from './accounts';
import { sendAuthError } from './errors';
import { accountCredentialRateLimit, credentialRateLimit, emailDispatchRateLimit } from './rateLimits';
import { requireAuth } from './middleware';
import { syncSessionUser } from './service';

export const authRouter = Router();

authRouter.post('/register', emailDispatchRateLimit, credentialRateLimit, async (request, response, next) => {
  try {
    const result = await registerAccount({
      email: request.body?.email,
      fullName: request.body?.fullName,
      password: request.body?.password,
    });

    // The account exists either way; `verification.sent` tells the caller whether
    // the email actually left the building.
    response.status(201).json(result);
  } catch (error) {
    if (!sendAuthError(error, response)) {
      next(error);
    }
  }
});

authRouter.post('/verify-email', credentialRateLimit, async (request, response, next) => {
  try {
    response.json(await verifyEmailAddress(request.body?.token));
  } catch (error) {
    if (!sendAuthError(error, response)) {
      next(error);
    }
  }
});

authRouter.post('/resend-verification', emailDispatchRateLimit, async (request, response, next) => {
  try {
    response.json(await resendVerificationEmail(request.body?.email));
  } catch (error) {
    if (!sendAuthError(error, response)) {
      next(error);
    }
  }
});

authRouter.post('/login', accountCredentialRateLimit, credentialRateLimit, async (request, response, next) => {
  try {
    response.json(await loginWithPassword({
      email: request.body?.email,
      password: request.body?.password,
    }));
  } catch (error) {
    if (!sendAuthError(error, response)) {
      next(error);
    }
  }
});

authRouter.post('/forgot-password', emailDispatchRateLimit, async (request, response, next) => {
  try {
    response.json(await requestPasswordReset(request.body?.email));
  } catch (error) {
    if (!sendAuthError(error, response)) {
      next(error);
    }
  }
});

authRouter.post('/reset-password', credentialRateLimit, async (request, response, next) => {
  try {
    response.json(await resetPasswordWithToken({
      password: request.body?.password,
      token: request.body?.token,
    }));
  } catch (error) {
    if (!sendAuthError(error, response)) {
      next(error);
    }
  }
});

authRouter.get('/me', requireAuth, async (request, response, next) => {
  try {
    response.json({ user: await getAccountById(request.actor!.id) });
  } catch (error) {
    if (!sendAuthError(error, response)) {
      next(error);
    }
  }
});

authRouter.post('/change-password', credentialRateLimit, requireAuth, async (request, response, next) => {
  try {
    response.json(await changeOwnPassword({
      currentPassword: request.body?.currentPassword,
      newPassword: request.body?.newPassword,
      userId: request.actor!.id,
    }));
  } catch (error) {
    if (!sendAuthError(error, response)) {
      next(error);
    }
  }
});

/**
 * Provisions the signed-in account's clinic workspace on first use.
 *
 * The identity and the platform-admin flag are taken from the session, never from
 * the request body — a caller must not be able to name a different account or
 * claim admin standing by setting a field.
 */
authRouter.post('/session-user', requireAuth, async (request, response, next) => {
  try {
    const actor = request.actor!;
    const syncedUser = await syncSessionUser({
      authUserId: actor.id,
      avatarUrl: typeof request.body?.avatarUrl === 'string' ? request.body.avatarUrl : undefined,
      email: actor.email,
      fullName: typeof request.body?.fullName === 'string' ? request.body.fullName : undefined,
      isAdmin: isSuperAdminRole(actor.role),
    });

    response.json({ user: syncedUser });
  } catch (error) {
    next(error);
  }
});
