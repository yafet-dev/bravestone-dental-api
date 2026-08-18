import cors from 'cors';
import express, { NextFunction, Request, Response } from 'express';
import swaggerUi from 'swagger-ui-express';
import { adminRouter } from './admin/router';
import { authRouter } from './auth/router';
import { describeAttachmentStorage } from './clinic/patientAttachments';
import { clinicRouter } from './clinic/router';
import { discoveryRouter } from './discovery/router';
import { invitationsRouter } from './invitations/router';
import { getSmtpConfigIssue, getSmtpSettings } from './mail/mailer';
import { openApiDocument } from './openapi';
import { publicPriceBoardRouter } from './priceBoard/router';
import { avatarsRoot } from './users/avatars';
import { usersRouter } from './users/router';

const serviceName = 'bravestone-dental-api';

export function createApp() {
  const app = express();
  const corsOrigin = process.env.CORS_ORIGIN || true;
  const smallJsonParser = express.json({ limit: '1mb' });

  app.disable('x-powered-by');
  app.use(cors({ origin: corsOrigin }));
  app.use((request, response, next) => {
    // Large JSON is needed only for authenticated clinic/admin state and profile
    // image routes. Their routers run requireAuth *before* their larger parsers,
    // preventing an anonymous client from making the server allocate tens of MB.
    const path = request.path;
    const authenticatedLargeBodyRoute = (
      path.startsWith('/api/clinic')
      || path.startsWith('/api/admin')
      || path === '/api/users/me/avatar'
    );

    if (authenticatedLargeBodyRoute) {
      next();
      return;
    }

    smallJsonParser(request, response, next);
  });

  app.get('/', (_request, response) => {
    response.redirect('/docs');
  });

  app.get('/health', (_request, response) => {
    const smtpSettings = getSmtpSettings();
    const smtpIssue = getSmtpConfigIssue(smtpSettings);

    response.json({
      status: 'ok',
      service: serviceName,
      uptime: Number(process.uptime().toFixed(3)),
      timestamp: new Date().toISOString(),
      attachmentStorage: describeAttachmentStorage(),
      mail: {
        configured: smtpIssue === null,
        host: smtpSettings.host || null,
        port: smtpSettings.port,
        // Never echo SMTP_PASS; the sender address is enough to confirm the wiring.
        from: smtpSettings.from || null,
        issue: smtpIssue,
      },
    });
  });

  app.get('/openapi.json', (_request, response) => {
    response.json(openApiDocument);
  });

  app.use('/api/admin', adminRouter);
  app.use('/api/auth', authRouter);
  app.use('/api/clinic', clinicRouter);
  app.use('/api/discovery', discoveryRouter);
  app.use('/api/invitations', invitationsRouter);
  // Deliberately prefixed: everything under /api/public is readable without a
  // session, so the trust boundary is visible at the mount rather than buried in
  // whichever router happens to skip requireAuth.
  app.use('/api/public', publicPriceBoardRouter);
  app.use('/api/users', usersRouter);

  // Uploaded profile pictures are public by design, the same as the Storage
  // bucket they replaced.
  app.use('/uploads/avatars', express.static(avatarsRoot, { fallthrough: true, maxAge: '1h' }));

  app.use(
    '/docs',
    swaggerUi.serve,
    swaggerUi.setup(openApiDocument, {
      customSiteTitle: 'Bravestone Dental API Docs',
      swaggerOptions: {
        persistAuthorization: true,
      },
    }),
  );

  app.use((_request, response) => {
    response.status(404).json({ message: 'Route not found.' });
  });

  app.use((error: unknown, request: Request, response: Response, _next: NextFunction) => {
    const message = error instanceof Error ? error.message : 'Internal server error.';

    // Always log the cause. Without this, a failure on a response that has
    // already started streaming surfaced only as ERR_HTTP_HEADERS_SENT from the
    // line below, which reports that the reply was too late and says nothing
    // about what actually broke.
    console.error(`${request.method} ${request.originalUrl} failed:`, error);

    // A streaming response (Server-Sent Events) has its headers on the wire from
    // its first frame, so there is no status left to set. Ending the socket lets
    // the client notice the drop and reconnect.
    if (response.headersSent) {
      response.end();
      return;
    }

    const parserError = error as { status?: unknown; type?: unknown };
    const payloadTooLarge = parserError?.status === 413 || parserError?.type === 'entity.too.large';

    response.status(payloadTooLarge ? 413 : 500).json({
      message: payloadTooLarge ? 'That request is too large.' : message,
    });
  });

  return app;
}

/**
 * Vercel's Node detection can select this file as the function entry, and it
 * requires the default export to be a request handler — an Express app is one.
 * Exporting the instance rather than `createApp` matters: the platform would
 * call the factory with (request, response), build an app, and answer nothing.
 *
 * `api/index.ts` is the entry this project declares; this export only keeps the
 * deployment working if the platform resolves to `src/app.ts` instead. Building
 * the app here is just route registration — nothing binds a port or opens a
 * connection until `src/server.ts` calls listen.
 */
export default createApp();
