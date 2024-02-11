import type { Response } from 'express';
import { AuthError } from './accounts';

/**
 * Turns an {@link AuthError} into its HTTP response and reports whether it was
 * handled, so route handlers can pass anything else to Express' error middleware.
 */
export function sendAuthError(error: unknown, response: Response) {
  if (error instanceof AuthError) {
    response.status(error.status).json({ code: error.code, message: error.message });
    return true;
  }

  return false;
}
