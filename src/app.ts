import cors from 'cors';
import express, { NextFunction, Request, Response } from 'express';
import swaggerUi from 'swagger-ui-express';
import { adminRouter } from './admin/router';
import { authRouter } from './auth/router';
import { clinicRouter } from './clinic/router';
import { invitationsRouter } from './invitations/router';
import { getSmtpConfigIssue, getSmtpSettings } from './mail/mailer';
import { openApiDocument } from './openapi';
import { avatarsRoot } from './users/avatars';
import { usersRouter } from './users/router';

const serviceName = 'bravestone-dental-api';

export function createApp() {
  const app = express();
  const corsOrigin = process.env.CORS_ORIGIN || true;

  app.disable('x-powered-by');
  app.use(cors({ origin: corsOrigin }));
  app.use(express.json({ limit: '30mb' }));

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
  app.use('/api/invitations', invitationsRouter);
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

    response.status(500).json({ message });
  });

  return app;
}
