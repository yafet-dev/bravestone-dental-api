import './env';

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
    {
      name: 'Admin',
      description: 'Bootstrap endpoints for the super admin workspace.',
    },
    {
      name: 'Auth',
      description: 'Session and identity sync endpoints.',
    },
    {
      name: 'Clinic',
      description: 'Bootstrap endpoints for the clinic workspace.',
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
    '/api/admin/bootstrap': {
      get: {
        tags: ['Admin'],
        summary: 'Get super admin bootstrap data',
        operationId: 'getAdminBootstrap',
        responses: {
          '200': {
            description: 'Current super admin state.',
            content: {
              'application/json': {
                schema: {
                  $ref: '#/components/schemas/AdminBootstrapState',
                },
              },
            },
          },
          '500': {
            description: 'Unexpected server error.',
            content: {
              'application/json': {
                schema: {
                  $ref: '#/components/schemas/ErrorResponse',
                },
              },
            },
          },
        },
      },
      put: {
        tags: ['Admin'],
        summary: 'Replace super admin bootstrap data',
        operationId: 'putAdminBootstrap',
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: {
                $ref: '#/components/schemas/AdminBootstrapState',
              },
            },
          },
        },
        responses: {
          '200': {
            description: 'Updated super admin state.',
            content: {
              'application/json': {
                schema: {
                  $ref: '#/components/schemas/AdminBootstrapState',
                },
              },
            },
          },
          '500': {
            description: 'Unexpected server error.',
            content: {
              'application/json': {
                schema: {
                  $ref: '#/components/schemas/ErrorResponse',
                },
              },
            },
          },
        },
      },
    },
    '/api/auth/session-user': {
      post: {
        tags: ['Auth'],
        summary: 'Sync the signed-in frontend user into the backend user store',
        operationId: 'postAuthSessionUser',
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: {
                type: 'object',
                required: ['authUserId', 'email'],
                properties: {
                  authUserId: { type: 'string' },
                  email: { type: 'string', format: 'email' },
                  fullName: { type: 'string' },
                  avatarUrl: { type: 'string' },
                  isAdmin: { type: 'boolean' },
                },
              },
            },
          },
        },
        responses: {
          '200': {
            description: 'Synced backend user record.',
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  properties: {
                    user: {
                      type: 'object',
                      properties: {
                        id: { type: 'string' },
                        authUserId: { type: 'string', nullable: true },
                        email: { type: 'string', format: 'email' },
                        fullName: { type: 'string' },
                        organizationId: { type: 'string', nullable: true },
                        role: { type: 'string' },
                        status: { type: 'string' },
                      },
                    },
                  },
                },
              },
            },
          },
          '400': {
            description: 'Missing required request fields.',
            content: {
              'application/json': {
                schema: {
                  $ref: '#/components/schemas/ErrorResponse',
                },
              },
            },
          },
          '500': {
            description: 'Unexpected server error.',
            content: {
              'application/json': {
                schema: {
                  $ref: '#/components/schemas/ErrorResponse',
                },
              },
            },
          },
        },
      },
    },
    '/api/clinic/bootstrap': {
      get: {
        tags: ['Clinic'],
        summary: 'Get clinic workspace bootstrap data',
        operationId: 'getClinicBootstrap',
        responses: {
          '200': {
            description: 'Current clinic workspace state.',
            content: {
              'application/json': {
                schema: {
                  $ref: '#/components/schemas/ClinicWorkspaceState',
                },
              },
            },
          },
          '500': {
            description: 'Unexpected server error.',
            content: {
              'application/json': {
                schema: {
                  $ref: '#/components/schemas/ErrorResponse',
                },
              },
            },
          },
        },
      },
      put: {
        tags: ['Clinic'],
        summary: 'Replace clinic workspace bootstrap data',
        operationId: 'putClinicBootstrap',
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: {
                $ref: '#/components/schemas/ClinicWorkspaceState',
              },
            },
          },
        },
        responses: {
          '200': {
            description: 'Updated clinic workspace state.',
            content: {
              'application/json': {
                schema: {
                  $ref: '#/components/schemas/ClinicWorkspaceState',
                },
              },
            },
          },
          '500': {
            description: 'Unexpected server error.',
            content: {
              'application/json': {
                schema: {
                  $ref: '#/components/schemas/ErrorResponse',
                },
              },
            },
          },
        },
      },
    },
    '/api/clinic/assistant/reply': {
      post: {
        tags: ['Clinic'],
        summary: 'Generate a clinic assistant reply',
        operationId: 'postClinicAssistantReply',
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: {
                $ref: '#/components/schemas/ClinicAssistantReplyRequest',
              },
            },
          },
        },
        responses: {
          '200': {
            description: 'Assistant reply generated from clinic workspace data.',
            content: {
              'application/json': {
                schema: {
                  $ref: '#/components/schemas/ClinicAssistantReplyResult',
                },
              },
            },
          },
          '400': {
            description: 'Missing prompt body.',
            content: {
              'application/json': {
                schema: {
                  $ref: '#/components/schemas/ErrorResponse',
                },
              },
            },
          },
          '500': {
            description: 'Unexpected server error.',
            content: {
              'application/json': {
                schema: {
                  $ref: '#/components/schemas/ErrorResponse',
                },
              },
            },
          },
        },
      },
    },
    '/api/clinic/report-insights': {
      post: {
        tags: ['Clinic'],
        summary: 'Generate clinic AI report insights',
        operationId: 'postClinicReportInsights',
        responses: {
          '200': {
            description: 'AI report insights generated from clinic workspace data.',
            content: {
              'application/json': {
                schema: {
                  $ref: '#/components/schemas/ClinicReportInsightsResult',
                },
              },
            },
          },
          '500': {
            description: 'Unexpected server error.',
            content: {
              'application/json': {
                schema: {
                  $ref: '#/components/schemas/ErrorResponse',
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
      PlanFeature: {
        type: 'object',
        required: ['id', 'label', 'enabled'],
        properties: {
          id: { type: 'string' },
          label: { type: 'string' },
          enabled: { type: 'boolean' },
        },
      },
      PricingPlan: {
        type: 'object',
        required: ['id', 'name', 'price', 'summary', 'features'],
        properties: {
          id: { type: 'string', enum: ['plus', 'pro', 'elite'] },
          name: { type: 'string' },
          price: { type: 'integer' },
          summary: { type: 'string' },
          features: {
            type: 'array',
            items: {
              $ref: '#/components/schemas/PlanFeature',
            },
          },
        },
      },
      Branch: {
        type: 'object',
        required: ['id', 'name', 'city', 'manager', 'users', 'patients', 'status'],
        properties: {
          id: { type: 'string' },
          name: { type: 'string' },
          city: { type: 'string' },
          manager: { type: 'string' },
          users: { type: 'integer' },
          patients: { type: 'integer' },
          status: { type: 'string', enum: ['active', 'trial', 'banned'] },
        },
      },
      ClinicUser: {
        type: 'object',
        required: ['id', 'name', 'email', 'role', 'branchId', 'branchName', 'status'],
        properties: {
          id: { type: 'string' },
          name: { type: 'string' },
          email: { type: 'string', format: 'email' },
          role: { type: 'string' },
          branchId: { type: 'string' },
          branchName: { type: 'string' },
          status: { type: 'string', enum: ['active', 'invited', 'banned'] },
        },
      },
      AIUsage: {
        type: 'object',
        required: ['monthlyLimit', 'usedThisMonth', 'totalChecks', 'checksToday', 'resetDate'],
        properties: {
          monthlyLimit: { type: 'integer' },
          usedThisMonth: { type: 'integer' },
          totalChecks: { type: 'integer' },
          checksToday: { type: 'integer' },
          resetDate: { type: 'string' },
          lastUsedAt: { type: 'string' },
        },
      },
      ClinicDashboardMetrics: {
        type: 'object',
        required: ['appointmentsToday', 'monthlyRevenue', 'lowStockItems', 'pendingForms'],
        properties: {
          appointmentsToday: { type: 'integer' },
          monthlyRevenue: { type: 'integer' },
          lowStockItems: { type: 'integer' },
          pendingForms: { type: 'integer' },
        },
      },
      PaymentRecord: {
        type: 'object',
        required: ['id', 'invoiceNumber', 'paidAt', 'method', 'amount', 'reference', 'note', 'planName', 'recordedAt', 'periodStart', 'periodEnd'],
        properties: {
          id: { type: 'string' },
          invoiceNumber: { type: 'string' },
          paidAt: { type: 'string' },
          method: { type: 'string', enum: ['Cash', 'Bank transfer', 'Card', 'Mobile money', 'Check'] },
          amount: { type: 'integer' },
          reference: { type: 'string' },
          note: { type: 'string' },
          planName: { type: 'string' },
          recordedAt: { type: 'string', format: 'date-time' },
          periodStart: { type: 'string' },
          periodEnd: { type: 'string' },
        },
      },
      Organization: {
        type: 'object',
        required: ['id', 'name', 'owner', 'ownerEmail', 'planId', 'status', 'paymentStatus', 'dueDate', 'lifetimePaid', 'featuresPaused', 'aiUsage', 'branches', 'dashboardMetrics', 'disabledFeatureIds', 'paymentHistory', 'users'],
        properties: {
          id: { type: 'string' },
          name: { type: 'string' },
          owner: { type: 'string' },
          ownerEmail: { type: 'string', format: 'email' },
          planId: { type: 'string', enum: ['plus', 'pro', 'elite'] },
          status: { type: 'string', enum: ['active', 'trial', 'banned'] },
          paymentStatus: { type: 'string', enum: ['paid', 'unpaid'] },
          dueDate: { type: 'string' },
          lifetimePaid: { type: 'integer' },
          lastPaidAt: { type: 'string' },
          lastUnpaidAt: { type: 'string' },
          unpaidReason: { type: 'string' },
          unpaidEmailSent: { type: 'boolean' },
          featuresPaused: { type: 'boolean' },
          aiUsage: {
            $ref: '#/components/schemas/AIUsage',
          },
          branches: {
            type: 'array',
            items: {
              $ref: '#/components/schemas/Branch',
            },
          },
          dashboardMetrics: {
            $ref: '#/components/schemas/ClinicDashboardMetrics',
          },
          disabledFeatureIds: {
            type: 'array',
            items: {
              type: 'string',
            },
          },
          paymentHistory: {
            type: 'array',
            items: {
              $ref: '#/components/schemas/PaymentRecord',
            },
          },
          users: {
            type: 'array',
            items: {
              $ref: '#/components/schemas/ClinicUser',
            },
          },
        },
      },
      Invitation: {
        type: 'object',
        required: ['id', 'organizationId', 'organizationName', 'branchName', 'email', 'role', 'sentAt', 'expiresAt', 'status'],
        properties: {
          id: { type: 'string' },
          organizationId: { type: 'string' },
          organizationName: { type: 'string' },
          branchName: { type: 'string' },
          email: { type: 'string', format: 'email' },
          role: { type: 'string' },
          sentAt: { type: 'string' },
          expiresAt: { type: 'string' },
          status: { type: 'string', enum: ['sent', 'accepted', 'expired'] },
        },
      },
      SuperAdminProfile: {
        type: 'object',
        required: ['name', 'email', 'recoveryEmail', 'twoFactorEnabled', 'lastPasswordChange'],
        properties: {
          name: { type: 'string' },
          email: { type: 'string', format: 'email' },
          recoveryEmail: { type: 'string', format: 'email' },
          twoFactorEnabled: { type: 'boolean' },
          lastPasswordChange: { type: 'string' },
        },
      },
      AuditLog: {
        type: 'object',
        required: ['id', 'event', 'detail', 'tone', 'createdAt'],
        properties: {
          id: { type: 'string' },
          event: { type: 'string' },
          detail: { type: 'string' },
          tone: { type: 'string', enum: ['success', 'error', 'warning', 'info'] },
          createdAt: { type: 'string', format: 'date-time' },
        },
      },
      AdminBootstrapState: {
        type: 'object',
        required: ['plans', 'organizations', 'invitations', 'superAdminProfile', 'auditLogs'],
        properties: {
          plans: {
            type: 'array',
            items: {
              $ref: '#/components/schemas/PricingPlan',
            },
          },
          organizations: {
            type: 'array',
            items: {
              $ref: '#/components/schemas/Organization',
            },
          },
          invitations: {
            type: 'array',
            items: {
              $ref: '#/components/schemas/Invitation',
            },
          },
          superAdminProfile: {
            $ref: '#/components/schemas/SuperAdminProfile',
          },
          auditLogs: {
            type: 'array',
            items: {
              $ref: '#/components/schemas/AuditLog',
            },
          },
        },
      },
      ClinicWorkspaceState: {
        type: 'object',
        required: [
          'patients',
          'patientProfiles',
          'patientPayments',
          'appointments',
          'revenueData',
          'doctors',
          'procedures',
          'diagnoses',
          'symptoms',
          'prescriptions',
          'invoices',
          'forms',
          'sickLeaves',
          'reports',
          'staffUsers',
          'roles',
          'financeEntries',
        ],
        properties: {
          patients: { type: 'array', items: { type: 'object' } },
          patientProfiles: { type: 'array', items: { type: 'object' } },
          patientPayments: { type: 'array', items: { type: 'object' } },
          appointments: { type: 'array', items: { type: 'object' } },
          revenueData: { type: 'array', items: { type: 'object' } },
          doctors: { type: 'array', items: { type: 'object' } },
          procedures: { type: 'array', items: { type: 'object' } },
          diagnoses: { type: 'array', items: { type: 'object' } },
          symptoms: { type: 'array', items: { type: 'object' } },
          prescriptions: { type: 'array', items: { type: 'object' } },
          invoices: { type: 'array', items: { type: 'object' } },
          forms: { type: 'array', items: { type: 'object' } },
          sickLeaves: { type: 'array', items: { type: 'object' } },
          reports: { type: 'array', items: { type: 'object' } },
          staffUsers: { type: 'array', items: { type: 'object' } },
          roles: { type: 'array', items: { type: 'object' } },
          financeEntries: { type: 'array', items: { type: 'object' } },
        },
      },
      ClinicAssistantMessage: {
        type: 'object',
        required: ['id', 'role', 'content', 'timestamp'],
        properties: {
          id: { type: 'string' },
          role: { type: 'string', enum: ['assistant', 'user'] },
          content: { type: 'string' },
          timestamp: { type: 'string', format: 'date-time' },
        },
      },
      ClinicAIInsightCard: {
        type: 'object',
        required: ['id', 'title', 'value', 'helper', 'tone'],
        properties: {
          id: { type: 'string' },
          title: { type: 'string' },
          value: { type: 'string' },
          helper: { type: 'string' },
          tone: {
            type: 'string',
            enum: ['brand', 'success', 'warning'],
          },
        },
      },
      ClinicAIReportInsightSet: {
        type: 'object',
        required: ['dashboard', 'executive', 'financial', 'performance', 'generatedAt', 'source'],
        properties: {
          dashboard: {
            type: 'array',
            items: {
              $ref: '#/components/schemas/ClinicAIInsightCard',
            },
          },
          executive: {
            type: 'array',
            items: {
              $ref: '#/components/schemas/ClinicAIInsightCard',
            },
          },
          financial: {
            type: 'array',
            items: {
              $ref: '#/components/schemas/ClinicAIInsightCard',
            },
          },
          performance: {
            type: 'array',
            items: {
              $ref: '#/components/schemas/ClinicAIInsightCard',
            },
          },
          generatedAt: {
            type: 'string',
            format: 'date-time',
          },
          model: {
            type: 'string',
          },
          source: {
            type: 'string',
            enum: ['deepseek', 'fallback'],
          },
        },
      },
      ClinicAIMemory: {
        type: 'object',
        required: ['summary', 'focusAreas', 'updatedAt'],
        properties: {
          summary: { type: 'string' },
          focusAreas: {
            type: 'array',
            items: { type: 'string' },
          },
          updatedAt: {
            type: 'string',
            format: 'date-time',
          },
          reportInsights: {
            $ref: '#/components/schemas/ClinicAIReportInsightSet',
          },
        },
      },
      ClinicAssistantReplyRequest: {
        type: 'object',
        required: ['message'],
        properties: {
          message: { type: 'string' },
        },
      },
      ClinicAssistantReplyResult: {
        type: 'object',
        required: ['message', 'memory', 'source'],
        properties: {
          message: {
            $ref: '#/components/schemas/ClinicAssistantMessage',
          },
          memory: {
            $ref: '#/components/schemas/ClinicAIMemory',
          },
          model: {
            type: 'string',
          },
          source: {
            type: 'string',
            enum: ['deepseek', 'fallback'],
          },
        },
      },
      ClinicReportInsightsResult: {
        type: 'object',
        required: ['insights', 'memory'],
        properties: {
          insights: {
            $ref: '#/components/schemas/ClinicAIReportInsightSet',
          },
          memory: {
            $ref: '#/components/schemas/ClinicAIMemory',
          },
        },
      },
    },
  },
} as const;
