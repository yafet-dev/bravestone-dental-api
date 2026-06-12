import cors from 'cors';
import express, { NextFunction, Request, Response } from 'express';
import swaggerUi from 'swagger-ui-express';
import { adminRouter } from './admin/router';
import { authRouter } from './auth/router';
import { clinicRouter } from './clinic/router';
import { openApiDocument } from './openapi';

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
    response.json({
      status: 'ok',
      service: serviceName,
      uptime: Number(process.uptime().toFixed(3)),
      timestamp: new Date().toISOString(),
    });
  });

  app.get('/openapi.json', (_request, response) => {
    response.json(openApiDocument);
  });

  app.use('/api/admin', adminRouter);
  app.use('/api/auth', authRouter);
  app.use('/api/clinic', clinicRouter);

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

  app.use((error: unknown, _request: Request, response: Response, _next: NextFunction) => {
    const message = error instanceof Error ? error.message : 'Internal server error.';
    response.status(500).json({ message });
  });

  return app;
}
