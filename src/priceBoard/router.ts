import { Router } from 'express';
import rateLimit, { ipKeyGenerator } from 'express-rate-limit';
import { loadPublicPriceBoard } from './service';

/**
 * The unauthenticated half of the price board. Read-only by construction: this
 * router has one GET and no writes, so mounting it outside the session middleware
 * cannot expose anything that changes clinic data.
 */
export const publicPriceBoardRouter = Router();

/**
 * A five-character code is short enough to be guessed by a machine, so guessing is
 * what gets throttled. A television reloads the board every minute or two and a
 * member of staff might open it a handful of times, so a real board never comes
 * close to this budget; a script walking the code space hits it in seconds.
 */
const priceBoardLookupRateLimit = rateLimit({
  windowMs: 10 * 60 * 1000,
  limit: 60,
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  // Per address and per clinic slug, so hammering one clinic cannot also lock the
  // waiting-room television of a different clinic sharing an office network.
  keyGenerator: (request) => (
    `${ipKeyGenerator(request.ip || '')}:${(request.params.slug || '').toLowerCase()}`
  ),
  handler: (_request, response) => {
    response.status(429).json({
      code: 'rate_limited',
      message: 'Too many price board requests. Try again in a few minutes.',
    });
  },
});

publicPriceBoardRouter.get(
  '/price-board/:slug/:code',
  priceBoardLookupRateLimit,
  async (request, response) => {
    try {
      const board = await loadPublicPriceBoard(request.params.slug, request.params.code);

      if (!board) {
        // One answer for a wrong code, a board that was turned off, and a clinic
        // that no longer publishes. Anything more specific would confirm which
        // clinics exist to whoever is guessing.
        response.status(404).json({
          code: 'price_board_not_found',
          message: 'This price board link is not available.',
        });
        return;
      }

      // Prices change rarely, but a television left running should not show
      // yesterday's list. A short shared cache keeps repeated polling cheap while
      // staying close to live.
      response.setHeader('Cache-Control', 'public, max-age=30, s-maxage=30');
      response.json({ board });
    } catch (error) {
      // Deliberately not passed to the shared error handler: that one replies with
      // `error.message`, which is right for a signed-in developer and wrong here —
      // a database failure would hand an anonymous caller the query, the schema
      // names and the server's file paths. The cause still goes to the log.
      console.error(`GET ${request.originalUrl} failed:`, error);
      response.status(503).json({
        code: 'price_board_unavailable',
        message: 'The price board cannot be loaded right now.',
      });
    }
  }
);
