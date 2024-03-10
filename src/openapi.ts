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
    {
      name: 'Invitations',
      description: 'Staff invitations, emailed through the configured SMTP relay.',
    },
    {
      name: 'Users',
      description: 'Account-owned resources such as profile pictures.',
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
        security: [{ bearerAuth: [] }],
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
        security: [{ bearerAuth: [] }],
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
    '/api/auth/register': {
      post: {
        tags: ['Auth'],
        summary: 'Create an account and email a verification link',
        description: 'The account is created even when the email cannot be delivered; check `verification.sent`.',
        operationId: 'postAuthRegister',
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: {
                type: 'object',
                required: ['email', 'password'],
                properties: {
                  email: { type: 'string', format: 'email' },
                  fullName: { type: 'string' },
                  password: { type: 'string', minLength: 8 },
                },
              },
            },
          },
        },
        responses: {
          '201': {
            description: 'Account created. `verification.sent` reports whether the email left the relay.',
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  properties: {
                    user: { $ref: '#/components/schemas/PublicUser' },
                    verification: {
                      type: 'object',
                      properties: {
                        sent: { type: 'boolean' },
                        error: { type: 'string' },
                      },
                    },
                  },
                },
              },
            },
          },
          '400': { $ref: '#/components/responses/AuthError' },
          '409': { $ref: '#/components/responses/AuthError' },
        },
      },
    },
    '/api/auth/verify-email': {
      post: {
        tags: ['Auth'],
        summary: 'Consume an emailed verification token and open a session',
        operationId: 'postAuthVerifyEmail',
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: {
                type: 'object',
                required: ['token'],
                properties: { token: { type: 'string' } },
              },
            },
          },
        },
        responses: {
          '200': { $ref: '#/components/responses/SessionResponse' },
          '400': { $ref: '#/components/responses/AuthError' },
        },
      },
    },
    '/api/auth/resend-verification': {
      post: {
        tags: ['Auth'],
        summary: 'Email a fresh verification link',
        description: 'Always succeeds so the response cannot be used to discover which addresses are registered.',
        operationId: 'postAuthResendVerification',
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: {
                type: 'object',
                required: ['email'],
                properties: { email: { type: 'string', format: 'email' } },
              },
            },
          },
        },
        responses: {
          '200': {
            description: 'Request accepted.',
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  properties: {
                    sent: { type: 'boolean' },
                    delivered: { type: 'boolean' },
                    error: { type: 'string' },
                  },
                },
              },
            },
          },
          '400': { $ref: '#/components/responses/AuthError' },
        },
      },
    },
    '/api/auth/login': {
      post: {
        tags: ['Auth'],
        summary: 'Exchange an email and password for a session token',
        operationId: 'postAuthLogin',
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: {
                type: 'object',
                required: ['email', 'password'],
                properties: {
                  email: { type: 'string', format: 'email' },
                  password: { type: 'string' },
                },
              },
            },
          },
        },
        responses: {
          '200': { $ref: '#/components/responses/SessionResponse' },
          '401': { $ref: '#/components/responses/AuthError' },
          '403': {
            description: 'Unverified (`email_not_verified`), suspended, or password setup required.',
            content: {
              'application/json': {
                schema: { $ref: '#/components/schemas/AuthErrorResponse' },
              },
            },
          },
        },
      },
    },
    '/api/auth/forgot-password': {
      post: {
        tags: ['Auth'],
        summary: 'Email a single-use password reset link',
        operationId: 'postAuthForgotPassword',
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: {
                type: 'object',
                required: ['email'],
                properties: { email: { type: 'string', format: 'email' } },
              },
            },
          },
        },
        responses: {
          '200': {
            description: 'Request accepted, whether or not the address is registered.',
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  properties: {
                    sent: { type: 'boolean' },
                    delivered: { type: 'boolean' },
                    error: { type: 'string' },
                  },
                },
              },
            },
          },
          '400': { $ref: '#/components/responses/AuthError' },
        },
      },
    },
    '/api/auth/reset-password': {
      post: {
        tags: ['Auth'],
        summary: 'Set a new password using an emailed reset token',
        operationId: 'postAuthResetPassword',
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: {
                type: 'object',
                required: ['password', 'token'],
                properties: {
                  password: { type: 'string', minLength: 8 },
                  token: { type: 'string' },
                },
              },
            },
          },
        },
        responses: {
          '200': { $ref: '#/components/responses/SessionResponse' },
          '400': { $ref: '#/components/responses/AuthError' },
        },
      },
    },
    '/api/auth/me': {
      get: {
        tags: ['Auth'],
        summary: 'Read the signed-in account',
        operationId: 'getAuthMe',
        security: [{ bearerAuth: [] }],
        responses: {
          '200': {
            description: 'The signed-in account.',
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  properties: { user: { $ref: '#/components/schemas/PublicUser' } },
                },
              },
            },
          },
          '401': { $ref: '#/components/responses/AuthError' },
        },
      },
    },
    '/api/auth/change-password': {
      post: {
        tags: ['Auth'],
        summary: 'Change the signed-in account password',
        operationId: 'postAuthChangePassword',
        security: [{ bearerAuth: [] }],
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: {
                type: 'object',
                required: ['currentPassword', 'newPassword'],
                properties: {
                  currentPassword: { type: 'string' },
                  newPassword: { type: 'string', minLength: 8 },
                },
              },
            },
          },
        },
        responses: {
          '200': { $ref: '#/components/responses/SessionResponse' },
          '400': { $ref: '#/components/responses/AuthError' },
          '401': { $ref: '#/components/responses/AuthError' },
        },
      },
    },
    '/api/invitations': {
      get: {
        tags: ['Invitations'],
        summary: 'List invitations visible to the caller',
        description: 'Clinic admins see their own clinic; super admins may pass `organizationId` to scope the list.',
        operationId: 'getInvitations',
        security: [{ bearerAuth: [] }],
        parameters: [
          {
            name: 'organizationId',
            in: 'query',
            required: false,
            schema: { type: 'string' },
          },
        ],
        responses: {
          '200': {
            description: 'Invitations, newest first.',
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  properties: {
                    invitations: {
                      type: 'array',
                      items: { $ref: '#/components/schemas/Invitation' },
                    },
                  },
                },
              },
            },
          },
          '401': { $ref: '#/components/responses/AuthError' },
        },
      },
      post: {
        tags: ['Invitations'],
        summary: 'Create an invitation and email it',
        description: 'Answers 502 when the invitation was valid but the mail relay refused it; in that case nothing is persisted.',
        operationId: 'postInvitation',
        security: [{ bearerAuth: [] }],
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: {
                type: 'object',
                required: ['email'],
                properties: {
                  branchId: { type: 'string' },
                  email: { type: 'string', format: 'email' },
                  fullName: { type: 'string' },
                  organizationId: { type: 'string', description: 'Required for super admins.' },
                  role: { type: 'string' },
                },
              },
            },
          },
        },
        responses: {
          '201': { $ref: '#/components/responses/InvitationSendResult' },
          '400': { $ref: '#/components/responses/AuthError' },
          '401': { $ref: '#/components/responses/AuthError' },
          '403': { $ref: '#/components/responses/AuthError' },
          '409': { $ref: '#/components/responses/AuthError' },
          '502': { $ref: '#/components/responses/InvitationSendResult' },
        },
      },
    },
    '/api/invitations/{invitationId}/resend': {
      post: {
        tags: ['Invitations'],
        summary: 'Issue a fresh token and email the invitation again',
        description: 'The previous link stops working. Answers 502 when the relay refuses the message.',
        operationId: 'postInvitationResend',
        security: [{ bearerAuth: [] }],
        parameters: [
          {
            name: 'invitationId',
            in: 'path',
            required: true,
            schema: { type: 'string' },
          },
        ],
        responses: {
          '200': { $ref: '#/components/responses/InvitationSendResult' },
          '401': { $ref: '#/components/responses/AuthError' },
          '403': { $ref: '#/components/responses/AuthError' },
          '404': { $ref: '#/components/responses/AuthError' },
          '409': { $ref: '#/components/responses/AuthError' },
          '502': { $ref: '#/components/responses/InvitationSendResult' },
        },
      },
    },
    '/api/invitations/{invitationId}': {
      delete: {
        tags: ['Invitations'],
        summary: 'Revoke a pending invitation',
        operationId: 'deleteInvitation',
        security: [{ bearerAuth: [] }],
        parameters: [
          {
            name: 'invitationId',
            in: 'path',
            required: true,
            schema: { type: 'string' },
          },
        ],
        responses: {
          '200': {
            description: 'Invitation revoked.',
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  properties: { revoked: { type: 'boolean' } },
                },
              },
            },
          },
          '401': { $ref: '#/components/responses/AuthError' },
          '404': { $ref: '#/components/responses/AuthError' },
          '409': { $ref: '#/components/responses/AuthError' },
        },
      },
    },
    '/api/invitations/token/{token}': {
      get: {
        tags: ['Invitations'],
        summary: 'Preview an invitation from its emailed token',
        description: 'Public: the invitee has no session yet.',
        operationId: 'getInvitationByToken',
        parameters: [
          {
            name: 'token',
            in: 'path',
            required: true,
            schema: { type: 'string' },
          },
        ],
        responses: {
          '200': {
            description: 'Invitation details for the accept screen.',
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  properties: {
                    invitation: {
                      type: 'object',
                      properties: {
                        branchName: { type: 'string' },
                        email: { type: 'string', format: 'email' },
                        expiresAt: { type: 'string', format: 'date-time' },
                        fullName: { type: 'string' },
                        organizationName: { type: 'string' },
                        role: { type: 'string' },
                        roleLabel: { type: 'string' },
                      },
                    },
                  },
                },
              },
            },
          },
          '404': { $ref: '#/components/responses/AuthError' },
          '410': { $ref: '#/components/responses/AuthError' },
        },
      },
    },
    '/api/invitations/accept': {
      post: {
        tags: ['Invitations'],
        summary: 'Accept an invitation, set a password, and open a session',
        description: 'Public: consumes the emailed token, which cannot be replayed afterwards.',
        operationId: 'postInvitationAccept',
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: {
                type: 'object',
                required: ['password', 'token'],
                properties: {
                  fullName: { type: 'string' },
                  password: { type: 'string', minLength: 8 },
                  token: { type: 'string' },
                },
              },
            },
          },
        },
        responses: {
          '200': { $ref: '#/components/responses/SessionResponse' },
          '400': { $ref: '#/components/responses/AuthError' },
          '404': { $ref: '#/components/responses/AuthError' },
          '410': { $ref: '#/components/responses/AuthError' },
        },
      },
    },
    '/api/users/me/avatar': {
      post: {
        tags: ['Users'],
        summary: 'Upload the signed-in account profile picture',
        description: 'Accepts a base64 image data URL (PNG, JPG, WEBP, or GIF, up to 5 MB) and returns its public URL.',
        operationId: 'postOwnAvatar',
        security: [{ bearerAuth: [] }],
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: {
                type: 'object',
                required: ['dataUrl'],
                properties: {
                  dataUrl: { type: 'string', example: 'data:image/png;base64,iVBORw0KGgo...' },
                },
              },
            },
          },
        },
        responses: {
          '200': {
            description: 'Stored image URL.',
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  properties: { avatarUrl: { type: 'string' } },
                },
              },
            },
          },
          '400': { $ref: '#/components/responses/AuthError' },
          '401': { $ref: '#/components/responses/AuthError' },
          '413': { $ref: '#/components/responses/AuthError' },
        },
      },
    },
    '/api/auth/session-user': {
      post: {
        tags: ['Auth'],
        summary: 'Sync the signed-in frontend user into the backend user store',
        operationId: 'postAuthSessionUser',
        security: [{ bearerAuth: [] }],
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
    '/api/clinic/access': {
      get: {
        tags: ['Clinic'],
        summary: "Get the signed-in account's effective workspace access",
        description: 'Authoritative answer for which sidebar sections the caller may open and whether financial detail is visible to them. Clients mirror this calculation locally to draw navigation; where the two disagree, this response wins.',
        operationId: 'getClinicAccess',
        security: [{ bearerAuth: [] }],
        responses: {
          '200': {
            description: 'Effective access for the caller.',
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  properties: {
                    access: {
                      type: 'object',
                      properties: {
                        canManageClinic: { type: 'boolean', description: 'May administer staff, branches, roles, and grants.' },
                        canViewPatientPayments: { type: 'boolean', description: "May see one patient's balance, treatment price, invoices and payment history, and may record a payment." },
                        canViewClinicFinances: { type: 'boolean', description: "May see the clinic's own money: income and expense ledger, revenue analytics, per-doctor revenue, and owner reports." },
                        features: { type: 'array', items: { type: 'string' }, description: 'Sidebar sections this role may open.' },
                        isPlatformAdmin: { type: 'boolean' },
                        role: { type: 'string' },
                      },
                    },
                  },
                },
              },
            },
          },
          '403': {
            description: 'No clinic workspace is attached to this session.',
            content: {
              'application/json': {
                schema: { $ref: '#/components/schemas/ErrorResponse' },
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
        description: "Returns the workspace scoped to the caller's role. Sections their role cannot open come back empty, and financial figures — invoices, payments, the income/expense ledger, revenue analytics, patient balances, treatment prices, per-doctor revenue — are redacted unless a clinic admin has granted that role financial access.",
        operationId: 'getClinicBootstrap',
        security: [{ bearerAuth: [] }],
        responses: {
          '200': {
            description: 'Current clinic workspace state, scoped to the caller.',
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
        summary: 'Save clinic workspace bootstrap data',
        description: "Treated as proposed edits against the stored workspace, not a wholesale replacement. Slices the caller cannot read are preserved rather than overwritten, and slices only a clinic admin may manage — role grants, the role catalogue, branches, other people's staff records, the clinic's own details — are taken from storage whatever the request contains. A member may still update their own staff record, except its role, status, and email.",
        operationId: 'putClinicBootstrap',
        security: [{ bearerAuth: [] }],
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
        security: [{ bearerAuth: [] }],
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
        security: [{ bearerAuth: [] }],
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
    securitySchemes: {
      bearerAuth: {
        type: 'http',
        scheme: 'bearer',
        bearerFormat: 'JWT',
        description: 'Session token returned by the login, verify-email, reset-password, and invitation-accept endpoints.',
      },
    },
    responses: {
      AuthError: {
        description: 'The request was rejected. `code` identifies the reason.',
        content: {
          'application/json': {
            schema: {
              $ref: '#/components/schemas/AuthErrorResponse',
            },
          },
        },
      },
      SessionResponse: {
        description: 'A session token and the account it belongs to.',
        content: {
          'application/json': {
            schema: {
              type: 'object',
              properties: {
                session: {
                  type: 'object',
                  properties: {
                    expiresIn: { type: 'integer', description: 'Lifetime in seconds.' },
                    token: { type: 'string' },
                  },
                },
                user: { $ref: '#/components/schemas/PublicUser' },
              },
            },
          },
        },
      },
      InvitationSendResult: {
        description: 'Outcome of an invitation send. `delivery.sent` is the authoritative result.',
        content: {
          'application/json': {
            schema: {
              type: 'object',
              properties: {
                delivery: {
                  type: 'object',
                  properties: {
                    sent: { type: 'boolean' },
                    error: { type: 'string', description: 'Present when the relay refused the message.' },
                  },
                },
                invitation: {
                  nullable: true,
                  allOf: [{ $ref: '#/components/schemas/Invitation' }],
                },
              },
            },
          },
        },
      },
    },
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
          mail: {
            type: 'object',
            description: 'SMTP relay configuration used for every outbound email.',
            properties: {
              configured: { type: 'boolean' },
              host: { type: 'string', nullable: true },
              port: { type: 'integer' },
              from: { type: 'string', nullable: true },
              issue: { type: 'string', nullable: true },
            },
          },
        },
      },
      AuthErrorResponse: {
        type: 'object',
        required: ['code', 'message'],
        properties: {
          code: {
            type: 'string',
            example: 'email_not_verified',
          },
          message: { type: 'string' },
        },
      },
      PublicUser: {
        type: 'object',
        properties: {
          id: { type: 'string' },
          email: { type: 'string', format: 'email' },
          fullName: { type: 'string' },
          role: { type: 'string' },
          status: { type: 'string' },
          organizationId: { type: 'string', nullable: true },
          avatarUrl: { type: 'string', nullable: true },
          emailVerified: { type: 'boolean' },
          mustChangePassword: { type: 'boolean' },
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
          branchId: { type: 'string', nullable: true },
          branchName: { type: 'string' },
          email: { type: 'string', format: 'email' },
          fullName: { type: 'string' },
          role: { type: 'string' },
          roleLabel: { type: 'string' },
          invitedByName: { type: 'string' },
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
