import type { Response } from 'express';

/**
 * An authentication failure with both a safe browser-facing message and a
 * stable machine-readable code.
 */
export class AuthError extends Error {
  code: string;
  status: number;

  constructor(status: number, code: string, message: string) {
    super(message);
    this.name = 'AuthError';
    this.code = code;
    this.status = status;
  }
}

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
