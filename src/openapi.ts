import './env';
import { PATIENT_DIRECTORY_PAGE_SIZES } from './clinic/patientDirectory';

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
    '/api/admin/organizations/{organizationId}': {
      delete: {
        tags: ['Admin'],
        summary: 'Delete a clinic company',
        description: 'Cascades through every table the company owns — branches, staff accounts, patients, appointments, payment records, and pending invitations. There is no undo.',
        operationId: 'deleteAdminOrganization',
        security: [{ bearerAuth: [] }],
        parameters: [
          {
            name: 'organizationId',
            in: 'path',
            required: true,
            schema: { type: 'string' },
          },
        ],
        responses: {
          '200': {
            description: 'Company removed. Returns the refreshed super admin state.',
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  properties: {
                    deleted: {
                      type: 'object',
                      properties: {
                        id: { type: 'string' },
                        name: { type: 'string' },
                      },
                    },
                    state: {
                      $ref: '#/components/schemas/AdminBootstrapState',
                    },
                  },
                },
              },
            },
          },
          '403': {
            description: 'Reserved workspace, or the caller is not a super admin.',
            content: {
              'application/json': {
                schema: {
                  $ref: '#/components/schemas/ErrorResponse',
                },
              },
            },
          },
          '404': {
            description: 'No such company.',
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
    '/api/admin/organizations/{organizationId}/status': {
      patch: {
        tags: ['Admin'],
        summary: 'Make an atomic company lifecycle decision',
        description: 'Approves, denies, reopens, suspends, or reactivates a company only when its current status still matches expectedStatus.',
        operationId: 'updateAdminOrganizationStatus',
        security: [{ bearerAuth: [] }],
        parameters: [
          {
            name: 'organizationId',
            in: 'path',
            required: true,
            schema: { type: 'string' },
          },
        ],
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: {
                type: 'object',
                required: ['expectedStatus', 'status'],
                properties: {
                  expectedStatus: {
                    type: 'string',
                    enum: ['active', 'trial', 'denied', 'banned'],
                  },
                  status: {
                    type: 'string',
                    enum: ['active', 'trial', 'denied', 'banned'],
                  },
                },
              },
            },
          },
        },
        responses: {
          '200': {
            description: 'Status changed. Returns the refreshed super admin state.',
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  properties: {
                    organization: {
                      type: 'object',
                      properties: {
                        id: { type: 'string' },
                        name: { type: 'string' },
                        status: { type: 'string' },
                      },
                    },
                    state: { $ref: '#/components/schemas/AdminBootstrapState' },
                  },
                },
              },
            },
          },
          '400': {
            description: 'Invalid lifecycle transition.',
            content: {
              'application/json': {
                schema: { $ref: '#/components/schemas/ErrorResponse' },
              },
            },
          },
          '409': {
            description: 'The company status changed in another tab.',
            content: {
              'application/json': {
                schema: { $ref: '#/components/schemas/ErrorResponse' },
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
        summary: 'Create an account and email a four-digit signup code',
        description: 'The account remains unverified until `/api/auth/verify-signup-otp` succeeds. Check `signupOtp.sent` for mail delivery.',
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
            description: 'Account created and a short-lived OTP challenge issued.',
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  properties: {
                    user: { $ref: '#/components/schemas/PublicUser' },
                    signupOtp: { $ref: '#/components/schemas/SignupOtpChallenge' },
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
    '/api/auth/verify-signup-otp': {
      post: {
        tags: ['Auth'],
        summary: 'Finish signup with a four-digit email code',
        description: 'Consumes the single-use challenge, verifies the email, and opens a session. A challenge expires after 10 minutes or five incorrect guesses.',
        operationId: 'postAuthVerifySignupOtp',
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: {
                type: 'object',
                required: ['challengeId', 'code'],
                properties: {
                  challengeId: { type: 'string' },
                  code: { type: 'string', pattern: '^\\d{4}$' },
                },
              },
            },
          },
        },
        responses: {
          '200': { $ref: '#/components/responses/SessionResponse' },
          '400': { $ref: '#/components/responses/AuthError' },
          '429': { $ref: '#/components/responses/AuthError' },
        },
      },
    },
    '/api/auth/resend-signup-otp': {
      post: {
        tags: ['Auth'],
        summary: 'Email a fresh four-digit signup code',
        description: 'Issues a replacement challenge subject to a 60-second cooldown and five-email hourly account cap.',
        operationId: 'postAuthResendSignupOtp',
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
            description: 'Replacement challenge request accepted.',
            content: {
              'application/json': {
                schema: {
                  allOf: [
                    { $ref: '#/components/schemas/SignupOtpChallenge' },
                    {
                      type: 'object',
                      properties: { delivered: { type: 'boolean' } },
                    },
                  ],
                },
              },
            },
          },
          '400': { $ref: '#/components/responses/AuthError' },
          '429': { $ref: '#/components/responses/AuthError' },
        },
      },
    },
    '/api/auth/verify-email': {
      post: {
        tags: ['Auth'],
        summary: 'Consume an emailed verification token',
        description: 'Opens a session for a newly verified account. If the account already has 2FA enabled, verification succeeds but a normal password-plus-2FA login is required.',
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
          '200': {
            description: 'Email verified; either a session or a login-required result.',
            content: {
              'application/json': {
                schema: {
                  oneOf: [
                    {
                      allOf: [
                        { $ref: '#/components/schemas/SessionPayload' },
                        {
                          type: 'object',
                          required: ['loginRequired'],
                          properties: {
                            loginRequired: { type: 'boolean', enum: [false] },
                          },
                        },
                      ],
                    },
                    {
                      type: 'object',
                      required: ['loginRequired', 'user'],
                      properties: {
                        loginRequired: { type: 'boolean', enum: [true] },
                        user: { $ref: '#/components/schemas/PublicUser' },
                      },
                    },
                  ],
                },
              },
            },
          },
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
        summary: 'Verify primary credentials and start sign-in',
        description: 'Returns a session immediately when two-factor authentication is disabled. Accounts with two-factor authentication enabled receive a short-lived challenge instead and must complete `/api/auth/two-factor/verify-login` before a session is issued.',
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
          '200': {
            description: 'Primary credentials accepted. The `status` discriminator identifies whether sign-in is complete or a second factor is required.',
            content: {
              'application/json': {
                schema: {
                  oneOf: [
                    { $ref: '#/components/schemas/AuthenticatedLoginResponse' },
                    { $ref: '#/components/schemas/TwoFactorLoginChallengeResponse' },
                  ],
                  discriminator: {
                    propertyName: 'status',
                    mapping: {
                      authenticated: '#/components/schemas/AuthenticatedLoginResponse',
                      two_factor_required: '#/components/schemas/TwoFactorLoginChallengeResponse',
                    },
                  },
                },
              },
            },
          },
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
    '/api/auth/two-factor/verify-login': {
      post: {
        tags: ['Auth'],
        summary: 'Complete a two-factor sign-in challenge',
        description: 'Accepts a current authenticator code or an unused recovery code. A session is issued only after the short-lived challenge and second factor are both valid.',
        operationId: 'postAuthTwoFactorVerifyLogin',
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: {
                type: 'object',
                required: ['challengeToken', 'code'],
                properties: {
                  challengeToken: { type: 'string' },
                  code: { type: 'string', description: 'Current authenticator code or unused recovery code.' },
                },
              },
            },
          },
        },
        responses: {
          '200': { $ref: '#/components/responses/SessionResponse' },
          '400': { $ref: '#/components/responses/AuthError' },
          '410': {
            description: 'The challenge expired, was already consumed, or exhausted its allowed attempts.',
            content: {
              'application/json': {
                schema: { $ref: '#/components/schemas/AuthErrorResponse' },
              },
            },
          },
          '429': { $ref: '#/components/responses/AuthError' },
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
          '200': {
            description: 'Password reset completed. The user must sign in again, including a second factor when enabled.',
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  required: ['completed'],
                  properties: {
                    completed: { type: 'boolean', enum: [true] },
                  },
                },
              },
            },
          },
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
    '/api/auth/sessions': {
      get: {
        tags: ['Auth'],
        summary: 'List active account sessions',
        description: 'Returns unexpired, unrevoked sessions for the signed-in account. The current session is determined from the bearer token.',
        operationId: 'getAuthSessions',
        security: [{ bearerAuth: [] }],
        responses: {
          '200': {
            description: 'Active sessions, with the current device first.',
            content: {
              'application/json': {
                schema: { $ref: '#/components/schemas/ActiveSessionsResponse' },
              },
            },
          },
          '401': { $ref: '#/components/responses/AuthError' },
        },
      },
    },
    '/api/auth/sessions/{sessionId}': {
      delete: {
        tags: ['Auth'],
        summary: 'Revoke one active session',
        description: 'The target must belong to the signed-in account. Revocation takes effect on its next request.',
        operationId: 'deleteAuthSession',
        security: [{ bearerAuth: [] }],
        parameters: [
          {
            name: 'sessionId',
            in: 'path',
            required: true,
            schema: { type: 'string', format: 'uuid' },
          },
        ],
        responses: {
          '200': {
            description: 'Session revoked.',
            content: {
              'application/json': {
                schema: { $ref: '#/components/schemas/SessionRevocationResponse' },
              },
            },
          },
          '401': { $ref: '#/components/responses/AuthError' },
          '404': { $ref: '#/components/responses/AuthError' },
          '429': { $ref: '#/components/responses/AuthError' },
        },
      },
    },
    '/api/auth/sessions/revoke-others': {
      post: {
        tags: ['Auth'],
        summary: 'Revoke every other active session',
        description: 'Rotates the account session version, revokes all previous bearer sessions, and returns a replacement session for this device.',
        operationId: 'postAuthSessionsRevokeOthers',
        security: [{ bearerAuth: [] }],
        responses: {
          '200': {
            description: 'Other sessions revoked and this device reauthenticated.',
            content: {
              'application/json': {
                schema: { $ref: '#/components/schemas/RevokeOtherSessionsResponse' },
              },
            },
          },
          '401': { $ref: '#/components/responses/AuthError' },
          '429': { $ref: '#/components/responses/AuthError' },
        },
      },
    },
    '/api/auth/logout': {
      post: {
        tags: ['Auth'],
        summary: 'Revoke the current session',
        operationId: 'postAuthLogout',
        security: [{ bearerAuth: [] }],
        responses: {
          '200': {
            description: 'Current bearer session revoked.',
            content: {
              'application/json': {
                schema: { $ref: '#/components/schemas/SessionRevocationResponse' },
              },
            },
          },
          '401': { $ref: '#/components/responses/AuthError' },
          '429': { $ref: '#/components/responses/AuthError' },
        },
      },
    },
    '/api/auth/two-factor/status': {
      get: {
        tags: ['Auth'],
        summary: 'Read the signed-in account two-factor status',
        operationId: 'getAuthTwoFactorStatus',
        security: [{ bearerAuth: [] }],
        responses: {
          '200': {
            description: 'Current two-factor enrollment status and unused recovery-code count.',
            content: {
              'application/json': {
                schema: { $ref: '#/components/schemas/TwoFactorStatusResponse' },
              },
            },
          },
          '401': { $ref: '#/components/responses/AuthError' },
        },
      },
    },
    '/api/auth/two-factor/setup': {
      post: {
        tags: ['Auth'],
        summary: 'Start authenticator enrollment',
        description: 'Reauthenticates with the current password, creates a short-lived pending enrollment, and returns its QR code and manual key. The pending enrollment is not active until confirmed.',
        operationId: 'postAuthTwoFactorSetup',
        security: [{ bearerAuth: [] }],
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: {
                type: 'object',
                required: ['currentPassword'],
                properties: {
                  currentPassword: { type: 'string' },
                },
              },
            },
          },
        },
        responses: {
          '200': {
            description: 'Short-lived authenticator enrollment details. This response must not be cached or logged.',
            content: {
              'application/json': {
                schema: { $ref: '#/components/schemas/TwoFactorSetupResponse' },
              },
            },
          },
          '400': { $ref: '#/components/responses/AuthError' },
          '401': { $ref: '#/components/responses/AuthError' },
          '409': { $ref: '#/components/responses/AuthError' },
          '429': { $ref: '#/components/responses/AuthError' },
        },
      },
    },
    '/api/auth/two-factor/confirm': {
      post: {
        tags: ['Auth'],
        summary: 'Confirm and enable authenticator two-factor authentication',
        description: 'Verifies a code from the pending authenticator enrollment, enables two-factor authentication, revokes older sessions, and returns a replacement session plus recovery codes. Recovery codes are shown only in this response.',
        operationId: 'postAuthTwoFactorConfirm',
        security: [{ bearerAuth: [] }],
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: {
                type: 'object',
                required: ['code'],
                properties: {
                  code: { type: 'string', description: 'Current code from the authenticator enrolled during setup.' },
                },
              },
            },
          },
        },
        responses: {
          '200': {
            description: 'Two-factor authentication enabled. Store the one-time recovery codes securely before leaving this response.',
            content: {
              'application/json': {
                schema: { $ref: '#/components/schemas/SessionWithRecoveryCodesResponse' },
              },
            },
          },
          '400': { $ref: '#/components/responses/AuthError' },
          '401': { $ref: '#/components/responses/AuthError' },
          '409': { $ref: '#/components/responses/AuthError' },
          '410': { $ref: '#/components/responses/AuthError' },
          '429': { $ref: '#/components/responses/AuthError' },
        },
      },
    },
    '/api/auth/two-factor/disable': {
      post: {
        tags: ['Auth'],
        summary: 'Disable two-factor authentication',
        description: 'Requires the current password and either a current authenticator code or unused recovery code. Older sessions are revoked and a replacement session is returned.',
        operationId: 'postAuthTwoFactorDisable',
        security: [{ bearerAuth: [] }],
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: {
                type: 'object',
                required: ['currentPassword', 'code'],
                properties: {
                  currentPassword: { type: 'string' },
                  code: { type: 'string', description: 'Current authenticator code or unused recovery code.' },
                },
              },
            },
          },
        },
        responses: {
          '200': { $ref: '#/components/responses/SessionResponse' },
          '400': { $ref: '#/components/responses/AuthError' },
          '401': { $ref: '#/components/responses/AuthError' },
          '409': { $ref: '#/components/responses/AuthError' },
          '429': { $ref: '#/components/responses/AuthError' },
        },
      },
    },
    '/api/auth/two-factor/recovery-codes/regenerate': {
      post: {
        tags: ['Auth'],
        summary: 'Replace two-factor recovery codes',
        description: 'Requires the current password and either a current authenticator code or unused recovery code. All previous recovery codes are invalidated, older sessions are revoked, and a replacement session is returned.',
        operationId: 'postAuthTwoFactorRegenerateRecoveryCodes',
        security: [{ bearerAuth: [] }],
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: {
                type: 'object',
                required: ['currentPassword', 'code'],
                properties: {
                  currentPassword: { type: 'string' },
                  code: { type: 'string', description: 'Current authenticator code or unused recovery code.' },
                },
              },
            },
          },
        },
        responses: {
          '200': {
            description: 'Replacement session and newly generated one-time recovery codes.',
            content: {
              'application/json': {
                schema: { $ref: '#/components/schemas/SessionWithRecoveryCodesResponse' },
              },
            },
          },
          '400': { $ref: '#/components/responses/AuthError' },
          '401': { $ref: '#/components/responses/AuthError' },
          '409': { $ref: '#/components/responses/AuthError' },
          '429': { $ref: '#/components/responses/AuthError' },
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
                        organizationStatus: {
                          type: 'string',
                          enum: ['active', 'onboarding', 'trial', 'denied', 'banned'],
                          nullable: true,
                        },
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
          '401': { $ref: '#/components/responses/AuthError' },
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
          '401': { $ref: '#/components/responses/AuthError' },
          '403': { $ref: '#/components/responses/AuthError' },
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
          '401': { $ref: '#/components/responses/AuthError' },
          '403': { $ref: '#/components/responses/AuthError' },
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
    '/api/clinic/users/{userId}': {
      delete: {
        tags: ['Clinic'],
        summary: 'Permanently remove a user from the caller’s clinic',
        description: 'Clinic-admin only. Deletes the database user, revokes pending invitations, cascades authentication sessions and credentials, and removes the member from the workspace roster. The caller cannot delete their own account or a platform administrator.',
        operationId: 'deleteClinicUser',
        security: [{ bearerAuth: [] }],
        parameters: [
          {
            in: 'path',
            name: 'userId',
            required: true,
            schema: { type: 'string' },
          },
        ],
        requestBody: {
          content: {
            'application/json': {
              schema: {
                type: 'object',
                properties: {
                  email: { type: 'string', format: 'email', description: 'Safe fallback for a newly invited browser row whose temporary id differs from the database id.' },
                },
              },
            },
          },
        },
        responses: {
          '200': {
            description: 'The database user and clinic roster entry were deleted.',
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  properties: {
                    deleted: { type: 'boolean', enum: [true] },
                    user: { type: 'object', additionalProperties: true },
                  },
                },
              },
            },
          },
          '400': { $ref: '#/components/responses/AuthError' },
          '401': { $ref: '#/components/responses/AuthError' },
          '403': { $ref: '#/components/responses/AuthError' },
          '404': { $ref: '#/components/responses/AuthError' },
          '409': { $ref: '#/components/responses/AuthError' },
        },
      },
    },
    '/api/clinic/patients/directory': {
      get: {
        tags: ['Clinic'],
        summary: 'Get one page of the patient directory',
        description: "Returns the patients, profiles and payments for a single page of the Patients screen, with the search, filters, sort, count and offset applied in the database. Use this rather than the whole-workspace bootstrap read when only the directory is needed. Patient balances and treatment prices are redacted for roles without financial access, exactly as on the bootstrap route.",
        operationId: 'getClinicPatientDirectory',
        security: [{ bearerAuth: [] }],
        parameters: [
          {
            in: 'query',
            name: 'page',
            description: 'One-based page number. Defaults to the first page.',
            schema: { type: 'integer', minimum: 1, default: 1 },
          },
          {
            in: 'query',
            name: 'pageSize',
            description: 'Rows per page. Any other value falls back to 25.',
            // Read from the endpoint's own list rather than restated here, which
            // had already fallen a size behind it once.
            schema: { type: 'integer', enum: [...PATIENT_DIRECTORY_PAGE_SIZES], default: 25 },
          },
          {
            in: 'query',
            name: 'search',
            description: 'Matches a patient name, email address, phone number, or patient number.',
            schema: { type: 'string', maxLength: 120 },
          },
          {
            in: 'query',
            name: 'status',
            description: "Patient status, or `needsPayment` for anyone with an outstanding balance.",
            schema: { type: 'string', enum: ['all', 'needsPayment', 'active', 'inactive', 'lost'], default: 'all' },
          },
          {
            in: 'query',
            name: 'records',
            description: 'Limits the page to patients who do or do not have a clinical record.',
            schema: { type: 'string', enum: ['all', 'has', 'none'], default: 'all' },
          },
        ],
        responses: {
          '200': {
            description: 'One page of the directory, scoped to the caller.',
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  properties: {
                    patients: { type: 'array', items: { type: 'object', additionalProperties: true } },
                    patientProfiles: { type: 'array', items: { type: 'object', additionalProperties: true } },
                    patientPayments: { type: 'array', items: { type: 'object', additionalProperties: true } },
                    counts: {
                      type: 'object',
                      description: 'Directory-wide tallies for the filter menu, under the search and status already applied.',
                      properties: {
                        withRecords: { type: 'integer' },
                        withoutRecords: { type: 'integer' },
                      },
                    },
                    page: { type: 'integer' },
                    pageSize: { type: 'integer' },
                    records: { type: 'string' },
                    search: { type: 'string' },
                    status: { type: 'string' },
                    total: { type: 'integer', description: 'Patients matching every filter, across all pages.' },
                    totalPages: { type: 'integer' },
                  },
                },
              },
            },
          },
          '401': { $ref: '#/components/responses/AuthError' },
          '403': { $ref: '#/components/responses/AuthError' },
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
    '/api/clinic/patient-attachments': {
      get: {
        tags: ['Clinic'],
        summary: 'List patient record images',
        description: 'Returns metadata only. Image bytes remain in private object storage and are fetched separately after the same clinic and Patients-feature checks.',
        operationId: 'listPatientAttachments',
        security: [{ bearerAuth: [] }],
        parameters: [{
          in: 'query',
          name: 'patientId',
          required: false,
          schema: { type: 'string' },
          description: 'Limit the result to one patient in the authenticated clinic.',
        }],
        responses: {
          '200': {
            description: 'Attachment metadata scoped to the authenticated clinic.',
            content: {
              'application/json': {
                schema: { $ref: '#/components/schemas/PatientAttachmentListResponse' },
              },
            },
          },
          '401': { $ref: '#/components/responses/AuthError' },
          '403': { $ref: '#/components/responses/AuthError' },
        },
      },
      post: {
        tags: ['Clinic'],
        summary: 'Upload a patient record image',
        description: 'Validates the owning patient and optional intended record inside the authenticated clinic, re-encodes the image as WebP, stores it privately, and returns metadata rather than image bytes. The durable record link is committed when the workspace subsequently saves the attachment reference.',
        operationId: 'uploadPatientAttachment',
        security: [{ bearerAuth: [] }],
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: { $ref: '#/components/schemas/PatientAttachmentUploadRequest' },
            },
          },
        },
        responses: {
          '201': {
            description: 'Image stored successfully.',
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  required: ['attachment'],
                  properties: {
                    attachment: { $ref: '#/components/schemas/PatientAttachment' },
                  },
                },
              },
            },
          },
          '400': { $ref: '#/components/responses/AuthError' },
          '401': { $ref: '#/components/responses/AuthError' },
          '403': { $ref: '#/components/responses/AuthError' },
          '404': { $ref: '#/components/responses/AuthError' },
          '409': { $ref: '#/components/responses/AuthError' },
          '413': { $ref: '#/components/responses/AuthError' },
          '503': { $ref: '#/components/responses/AuthError' },
        },
      },
    },
    '/api/clinic/patient-attachments/{attachmentId}/signed-url': {
      get: {
        tags: ['Clinic'],
        summary: 'Authorize a short-lived attachment read',
        description: 'Returns a two-minute signed private-bucket URL after clinic ownership and Patients-feature checks. The local development driver returns a null URL so the client can use the authenticated content fallback.',
        operationId: 'signPatientAttachmentRead',
        security: [{ bearerAuth: [] }],
        parameters: [{
          in: 'path',
          name: 'attachmentId',
          required: true,
          schema: { type: 'string' },
        }],
        responses: {
          '200': {
            description: 'A short-lived direct URL, or null for the local driver.',
            content: {
              'application/json': {
                schema: { $ref: '#/components/schemas/PatientAttachmentSignedUrlResponse' },
              },
            },
          },
          '401': { $ref: '#/components/responses/AuthError' },
          '403': { $ref: '#/components/responses/AuthError' },
          '404': { $ref: '#/components/responses/AuthError' },
          '500': { $ref: '#/components/responses/AuthError' },
          '503': { $ref: '#/components/responses/AuthError' },
        },
      },
    },
    '/api/clinic/patient-attachments/{attachmentId}/content': {
      get: {
        tags: ['Clinic'],
        summary: 'Stream attachment bytes through the API',
        description: 'Authenticated fallback used by local development or when a browser cannot fetch the signed bucket URL.',
        operationId: 'getPatientAttachmentContent',
        security: [{ bearerAuth: [] }],
        parameters: [{
          in: 'path',
          name: 'attachmentId',
          required: true,
          schema: { type: 'string' },
        }],
        responses: {
          '200': {
            description: 'Stored WebP image.',
            content: {
              'image/webp': {
                schema: { type: 'string', format: 'binary' },
              },
            },
          },
          '401': { $ref: '#/components/responses/AuthError' },
          '403': { $ref: '#/components/responses/AuthError' },
          '404': { $ref: '#/components/responses/AuthError' },
          '502': { $ref: '#/components/responses/AuthError' },
        },
      },
    },
    '/api/clinic/patient-attachments/{attachmentId}': {
      delete: {
        tags: ['Clinic'],
        summary: 'Delete a patient record image',
        description: 'Removes the private object and its database index after clinic ownership and Patients-feature checks. Foreign and nonexistent IDs receive the same 404.',
        operationId: 'deletePatientAttachment',
        security: [{ bearerAuth: [] }],
        parameters: [{
          in: 'path',
          name: 'attachmentId',
          required: true,
          schema: { type: 'string' },
        }],
        responses: {
          '200': {
            description: 'The image was deleted.',
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  required: ['id'],
                  properties: { id: { type: 'string' } },
                },
              },
            },
          },
          '401': { $ref: '#/components/responses/AuthError' },
          '403': { $ref: '#/components/responses/AuthError' },
          '404': { $ref: '#/components/responses/AuthError' },
          '503': { $ref: '#/components/responses/AuthError' },
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
        description: 'Session token returned by completed login, signup OTP or email verification, two-factor verification, invitation-accept, password-change, and two-factor credential-management endpoints.',
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
            schema: { $ref: '#/components/schemas/SessionPayload' },
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
      SignupOtpChallenge: {
        type: 'object',
        required: ['challengeId', 'expiresIn', 'retryAfterSeconds', 'sent'],
        properties: {
          challengeId: { type: 'string', description: 'Opaque id paired with the emailed code.' },
          expiresIn: { type: 'integer', example: 600 },
          retryAfterSeconds: { type: 'integer', example: 60 },
          sent: { type: 'boolean' },
          error: { type: 'string', description: 'Present when the relay refused the message.' },
        },
      },
      HealthResponse: {
        type: 'object',
        required: ['status', 'service', 'uptime', 'timestamp', 'attachmentStorage'],
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
          attachmentStorage: {
            type: 'object',
            required: ['configured', 'driver', 'localFallbackAllowed'],
            properties: {
              configured: { type: 'boolean' },
              driver: { type: 'string', enum: ['supabase', 'local'] },
              localFallbackAllowed: { type: 'boolean' },
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
        required: ['id', 'email', 'fullName', 'role', 'status', 'organizationId', 'avatarUrl', 'emailVerified', 'mustChangePassword', 'twoFactorEnabled'],
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
          twoFactorEnabled: { type: 'boolean' },
        },
      },
      SessionPayload: {
        type: 'object',
        required: ['session', 'user'],
        properties: {
          session: {
            type: 'object',
            required: ['expiresIn', 'token'],
            properties: {
              expiresIn: { type: 'integer', description: 'Lifetime in seconds.' },
              token: { type: 'string' },
            },
          },
          user: { $ref: '#/components/schemas/PublicUser' },
        },
      },
      ActiveSession: {
        type: 'object',
        required: [
          'id',
          'current',
          'browser',
          'os',
          'deviceType',
          'deviceLabel',
          'ipAddress',
          'createdAt',
          'lastSeenAt',
          'expiresAt',
        ],
        properties: {
          id: { type: 'string', format: 'uuid' },
          current: { type: 'boolean' },
          browser: { type: 'string' },
          os: { type: 'string' },
          deviceType: {
            type: 'string',
            enum: ['desktop', 'mobile', 'tablet', 'unknown'],
          },
          deviceLabel: { type: 'string' },
          ipAddress: { type: 'string', nullable: true },
          createdAt: { type: 'string', format: 'date-time' },
          lastSeenAt: { type: 'string', format: 'date-time' },
          expiresAt: { type: 'string', format: 'date-time' },
        },
      },
      ActiveSessionsResponse: {
        type: 'object',
        required: ['sessions'],
        properties: {
          sessions: {
            type: 'array',
            items: { $ref: '#/components/schemas/ActiveSession' },
          },
        },
      },
      SessionRevocationResponse: {
        type: 'object',
        required: ['revoked', 'revokedCurrent'],
        properties: {
          revoked: { type: 'boolean', enum: [true] },
          revokedCurrent: { type: 'boolean' },
        },
      },
      RevokeOtherSessionsResponse: {
        allOf: [
          { $ref: '#/components/schemas/SessionPayload' },
          {
            type: 'object',
            required: ['revokedCount'],
            properties: {
              revokedCount: { type: 'integer', minimum: 0 },
            },
          },
        ],
      },
      AuthenticatedLoginResponse: {
        allOf: [
          { $ref: '#/components/schemas/SessionPayload' },
          {
            type: 'object',
            required: ['status'],
            properties: {
              status: { type: 'string', enum: ['authenticated'] },
            },
          },
        ],
      },
      TwoFactorLoginChallengeResponse: {
        type: 'object',
        required: ['status', 'challengeToken', 'expiresIn'],
        properties: {
          status: { type: 'string', enum: ['two_factor_required'] },
          challengeToken: { type: 'string', description: 'Opaque, short-lived token accepted only by the two-factor login verification endpoint.' },
          expiresIn: { type: 'integer', description: 'Challenge lifetime in seconds.' },
        },
      },
      TwoFactorStatusResponse: {
        type: 'object',
        required: ['enabled', 'enabledAt', 'recoveryCodesRemaining'],
        properties: {
          enabled: { type: 'boolean' },
          enabledAt: { type: 'string', format: 'date-time', nullable: true },
          recoveryCodesRemaining: { type: 'integer', minimum: 0 },
        },
      },
      TwoFactorSetupResponse: {
        type: 'object',
        required: ['manualKey', 'qrCodeDataUrl', 'setupExpiresAt'],
        properties: {
          manualKey: { type: 'string', description: 'TOTP secret formatted for manual entry. Treat as a password.' },
          qrCodeDataUrl: { type: 'string', description: 'PNG data URL encoding the authenticator provisioning URI. Treat as a password.' },
          setupExpiresAt: { type: 'string', format: 'date-time' },
        },
      },
      SessionWithRecoveryCodesResponse: {
        allOf: [
          { $ref: '#/components/schemas/SessionPayload' },
          {
            type: 'object',
            required: ['recoveryCodes'],
            properties: {
              recoveryCodes: {
                type: 'array',
                minItems: 1,
                items: { type: 'string' },
                description: 'New one-time recovery codes. The server does not return these values again.',
              },
            },
          },
        ],
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
      PatientAttachment: {
        type: 'object',
        required: [
          'id',
          'patientId',
          'recordId',
          'fileName',
          'bytes',
          'width',
          'height',
          'isRadiograph',
          'uploadedByName',
          'createdAt',
        ],
        properties: {
          id: { type: 'string' },
          patientId: { type: 'string' },
          recordId: { type: 'string', nullable: true },
          fileName: { type: 'string' },
          bytes: { type: 'integer', minimum: 1 },
          width: { type: 'integer', minimum: 1, nullable: true },
          height: { type: 'integer', minimum: 1, nullable: true },
          isRadiograph: { type: 'boolean' },
          uploadedByName: { type: 'string', nullable: true },
          createdAt: { type: 'string', format: 'date-time' },
        },
      },
      PatientAttachmentUploadRequest: {
        type: 'object',
        required: ['patientId', 'fileName', 'dataUrl'],
        properties: {
          patientId: { type: 'string' },
          recordId: { type: 'string' },
          fileName: { type: 'string', maxLength: 180 },
          dataUrl: {
            type: 'string',
            description: 'Base64 image data URL. Decoded source size is limited to 25 MiB.',
          },
          isRadiograph: {
            type: 'boolean',
            description: 'May promote an image to the diagnostic preservation policy; a radiograph-like filename cannot be downgraded.',
          },
        },
      },
      PatientAttachmentListResponse: {
        type: 'object',
        required: ['attachments', 'storage'],
        properties: {
          attachments: {
            type: 'array',
            items: { $ref: '#/components/schemas/PatientAttachment' },
          },
          storage: {
            type: 'object',
            required: ['configured', 'driver', 'localFallbackAllowed'],
            properties: {
              configured: { type: 'boolean' },
              driver: { type: 'string', enum: ['supabase', 'local'] },
              localFallbackAllowed: { type: 'boolean' },
            },
          },
        },
      },
      PatientAttachmentSignedUrlResponse: {
        type: 'object',
        required: ['url', 'expiresAt', 'bytes', 'checksum', 'contentType'],
        properties: {
          url: { type: 'string', format: 'uri', nullable: true },
          expiresAt: { type: 'string', format: 'date-time', nullable: true },
          bytes: { type: 'integer', minimum: 1 },
          checksum: {
            type: 'string',
            pattern: '^[0-9a-f]{64}$',
            description: 'SHA-256 of the stored bytes; clients verify the signed response before rendering.',
          },
          contentType: { type: 'string', enum: ['image/webp'] },
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
          status: { type: 'string', enum: ['active', 'onboarding', 'trial', 'denied', 'banned'] },
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
