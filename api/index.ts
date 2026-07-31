import '../src/env';
import app from '../src/app';
import { assertTwoFactorConfiguration } from '../src/auth/twoFactor';

/**
 * Vercel entry point. The platform loads this module once per cold start and
 * requires its default export to be a request handler — an Express app is
 * exactly that, so the app itself is what gets exported.
 *
 * `src/server.ts` stays the entry for long-lived hosts. It owns the port bind
 * and the care handoff LISTEN connection, neither of which outlives a
 * serverless invocation, so neither belongs here.
 */
assertTwoFactorConfiguration();

export default app;
