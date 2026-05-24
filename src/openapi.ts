export const openApiDocument = {
  openapi: '3.0.3',
  info: {
    title: 'Bravestone Dental API',
    version: '0.1.0',
    description: 'Backend API for Bravestone Dental.',
  },
  servers: [
    {
      url: process.env.APP_URL || `http://localhost:${process.env.PORT || 4000}`,
      description: 'Local API server',
    },
  ],
  tags: [
    {
      name: 'System',
      description: 'Service status and operational endpoints.',
    },
  ],
  paths: {
    '/health': {
      get: {
        tags: ['System'],
        summary: 'Check API health',
        operationId: 'getHealth',
        responses: {
          '200': {
            description: 'API is running.',
            content: {
              'application/json': {
                schema: {
                  $ref: '#/components/schemas/HealthResponse',
                },
                examples: {
                  ok: {
                    value: {
                      status: 'ok',
                      service: 'bravestone-dental-api',
                      uptime: 12.345,
                      timestamp: '2026-05-24T21:30:00.000Z',
                    },
                  },
                },
              },
            },
          },
        },
      },
    },
  },
  components: {
    schemas: {
      HealthResponse: {
        type: 'object',
        required: ['status', 'service', 'uptime', 'timestamp'],
        properties: {
          status: {
            type: 'string',
            enum: ['ok'],
          },
          service: {
            type: 'string',
            example: 'bravestone-dental-api',
          },
          uptime: {
            type: 'number',
            example: 12.345,
          },
          timestamp: {
            type: 'string',
            format: 'date-time',
          },
        },
      },
      ErrorResponse: {
        type: 'object',
        required: ['message'],
        properties: {
          message: {
            type: 'string',
          },
        },
      },
    },
  },
} as const;
