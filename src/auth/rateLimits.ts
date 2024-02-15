import { createHash } from 'node:crypto';
import type { Request, Response } from 'express';
import rateLimit, { ipKeyGenerator, type AugmentedRequest, type Options } from 'express-rate-limit';

/**
 * Throttles the endpoints an attacker would hammer, without getting in the way of
 * people using the app normally.
 *
 * Credential endpoints count FAILURES ONLY, and are limited on two keys at once:
 *
 *   - per account (client address + the email being tried) — a tight budget, so
 *     guessing one specific account is slow
 *   - per client address — a looser budget, so an attacker cannot sidestep the
 *     per-account limit by rotating through email addresses
 *
 * Signing in successfully never consumes any budget, so a normal session (or a
 * page reload, or one mistyped password) can't lock anyone out.
 *
 * Counting is in-process, which suits a single API instance. Running several
 * instances behind a load balancer needs a shared store (Redis) plus
 * `app.set('trust proxy', …)`, so the client address is read from the forwarded
 * header rather than the balancer's own address.
 */

const fiveMinutes = 5 * 60 * 1000;
const fifteenMinutes = 15 * 60 * 1000;
const oneHour = 60 * 60 * 1000;

function describeWait(resetTime: Date | undefined) {
  if (!resetTime) {
    return 'in a few minutes';
  }

  const seconds = Math.max(0, Math.ceil((resetTime.getTime() - Date.now()) / 1000));

  if (seconds <= 90) {
    return `in about ${Math.max(1, seconds)} seconds`;
  }

  const minutes = Math.ceil(seconds / 60);
  return `in about ${minutes} minute${minutes === 1 ? '' : 's'}`;
}

/** Says what tripped and when it clears, rather than a bare "too many attempts". */
function buildHandler(reason: string) {
  return (request: Request, response: Response) => {
    const { rateLimit: limitInfo } = request as AugmentedRequest;

    response.status(429).json({
      code: 'rate_limited',
      message: `${reason} Try again ${describeWait(limitInfo?.resetTime)}.`,
    });
  };
}

const sharedOptions: Partial<Options> = {
  standardHeaders: 'draft-7',
  legacyHeaders: false,
};

function readSubmittedEmail(request: Request) {
  const email = (request.body as { email?: unknown } | undefined)?.email;
  return typeof email === 'string' ? email.trim().toLowerCase() : '';
}

/**
 * Tight per-account budget for credential guessing. `ipKeyGenerator` normalises
 * the address (IPv6 included) so the key is stable.
 *
 * Once this trips, the cooldown applies even to the correct password — the limiter
 * runs before the password is ever checked, which is the point. The window is
 * deliberately short so somebody who simply mistyped is not locked out for long,
 * while the coarse limit below still caps sustained guessing. Note the key
 * includes the client address, so someone else failing against your email cannot
 * lock you out of your own account.
 */
export const accountCredentialRateLimit = rateLimit({
  ...sharedOptions,
  windowMs: fiveMinutes,
  limit: 10,
  // Only wrong answers count.
  skipSuccessfulRequests: true,
  keyGenerator: (request) => `${ipKeyGenerator(request.ip || '')}::${readSubmittedEmail(request)}`,
  handler: buildHandler('Too many failed sign-in attempts for this account.'),
});

/** Looser whole-address budget so rotating emails does not bypass the above. */
export const credentialRateLimit = rateLimit({
  ...sharedOptions,
  windowMs: fifteenMinutes,
  limit: 50,
  skipSuccessfulRequests: true,
  handler: buildHandler('Too many failed attempts from this device.'),
});

/**
 * Endpoints that cause an email to be sent. This protects the SMTP quota and stops
 * the app being used to spray mail at third parties. Rejected requests are not
 * counted, because those never sent anything.
 */
export const emailDispatchRateLimit = rateLimit({
  ...sharedOptions,
  windowMs: oneHour,
  limit: 15,
  skipFailedRequests: true,
  handler: buildHandler('Too many emails requested from this device.'),
});

/**
 * Authenticated MFA changes require the account password and are keyed by both
 * actor and client address. Successful setup/status actions do not consume the
 * guessing budget.
 */
export const twoFactorSecurityRateLimit = rateLimit({
  ...sharedOptions,
  windowMs: fiveMinutes,
  limit: 10,
  skipSuccessfulRequests: true,
  keyGenerator: (request) => `${request.actor?.id || 'anonymous'}::${ipKeyGenerator(request.ip || '')}`,
  handler: buildHandler('Too many incorrect security-code attempts.'),
});

/**
 * The database challenge also has a five-attempt hard cap. This coarser limiter
 * slows distributed guessing at the HTTP edge without retaining the opaque
 * challenge itself in the rate-limit store.
 */
export const twoFactorLoginRateLimit = rateLimit({
  ...sharedOptions,
  windowMs: fiveMinutes,
  limit: 20,
  skipSuccessfulRequests: true,
  keyGenerator: (request) => {
    const challengeToken = (request.body as { challengeToken?: unknown } | undefined)?.challengeToken;
    const challengeKey = typeof challengeToken === 'string' && challengeToken
      ? createHash('sha256').update(challengeToken).digest('hex')
      : 'missing';

    return `${ipKeyGenerator(request.ip || '')}::${challengeKey}`;
  },
  handler: buildHandler('Too many incorrect login-code attempts.'),
});

/**
 * Invitation sends are operator actions, so this is keyed on the signed-in account
 * rather than the address — a whole clinic behind one office connection should not
 * share a single budget. Must be mounted AFTER requireAuth so the actor exists.
 */
export const invitationRateLimit = rateLimit({
  ...sharedOptions,
  windowMs: oneHour,
  limit: 60,
  skipFailedRequests: true,
  keyGenerator: (request) => request.actor?.id || ipKeyGenerator(request.ip || ''),
  handler: buildHandler('Too many invitations sent from this account.'),
});
