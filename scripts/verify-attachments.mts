/**
 * Destructive integration verification for patient-record attachments.
 *
 * This is deliberately not part of the normal test or build commands. It writes
 * two uniquely named clinics to the configured PostgreSQL database and exercises
 * the real authenticated HTTP routes. Every fixture is run-scoped and removed in
 * `cleanup`, but an explicit opt-in is still required:
 *
 *   PowerShell:
 *     $env:RUN_ATTACHMENT_INTEGRATION='1'
 *     npm.cmd run verify:attachments
 *
 *   Bash:
 *     RUN_ATTACHMENT_INTEGRATION=1 npm run verify:attachments
 *
 * Object bytes are always sent to the local development driver, even when the
 * surrounding environment has Supabase credentials. The script never runs the
 * record migration or its global `--purge` mode.
 */
import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import type { Server } from 'node:http';
import type { AddressInfo } from 'node:net';

type AttachmentSummary = {
  bytes: number;
  createdAt: string;
  fileName: string;
  height: number | null;
  id: string;
  isRadiograph: boolean;
  patientId: string;
  recordId: string | null;
  uploadedByName: string | null;
  width: number | null;
};

type AttachmentResponse = {
  attachment: AttachmentSummary;
};

type AttachmentListResponse = {
  attachments: AttachmentSummary[];
  storage: {
    configured: boolean;
    driver: string;
    localFallbackAllowed: boolean;
  };
};

type ApiErrorResponse = {
  code?: string;
  message?: string;
};

type BootstrapDiagnosis = {
  attachments?: Array<{
    attachmentId?: string;
    dataUrl: string;
    id: string;
    isRadiograph?: boolean;
    name: string;
    type: string;
  }>;
  id: string;
};

type BootstrapState = {
  diagnoses: BootstrapDiagnosis[];
  [key: string]: unknown;
};

type SignedUrlResponse = {
  bytes: number;
  checksum: string;
  contentType: string;
  expiresAt: string | null;
  url: string | null;
};

type RequestOptions = {
  body?: unknown;
  method?: string;
  organizationId?: string;
};

const runGuard = 'RUN_ATTACHMENT_INTEGRATION';

function requireOptIn() {
  if (process.env[runGuard] !== '1') {
    throw new Error(
      `Refusing to write integration fixtures. Re-run with ${runGuard}=1 only against the intended development database.`,
    );
  }
}

function forceLocalRecordStorage() {
  // These assignments happen before any application module is imported. dotenv
  // does not overwrite existing process values, so backend.env cannot silently
  // switch this verification run to a real bucket.
  process.env.SUPABASE_URL = '';
  process.env.SUPABASE_SERVICE_ROLE_KEY = '';
  process.env.SUPABASE_RECORDS_BUCKET = '';
  process.env.ALLOW_LOCAL_RECORD_STORAGE = 'true';
}

async function expectJson<T>(response: Response, expectedStatus: number, label: string): Promise<T> {
  const raw = await response.text();

  assert.equal(
    response.status,
    expectedStatus,
    `${label}: expected HTTP ${expectedStatus}, received ${response.status}. Body: ${raw.slice(0, 500)}`,
  );

  try {
    return JSON.parse(raw) as T;
  } catch {
    assert.fail(`${label}: expected a JSON response. Body: ${raw.slice(0, 500)}`);
  }
}

async function expectBinary(response: Response, expectedStatus: number, label: string) {
  if (response.status !== expectedStatus) {
    const raw = await response.text();
    assert.fail(
      `${label}: expected HTTP ${expectedStatus}, received ${response.status}. Body: ${raw.slice(0, 500)}`,
    );
  }

  return Buffer.from(await response.arrayBuffer());
}

async function closeServer(server: Server | null) {
  if (!server?.listening) {
    return;
  }

  server.closeIdleConnections?.();

  await new Promise<void>((resolve, reject) => {
    server.close((error) => {
      if (error) {
        reject(error);
        return;
      }

      resolve();
    });
  });
}

function emptyWorkspace(id: string, organizationId: string, organizationName: string, ownerEmail: string) {
  return {
    appointments: [],
    branches: [],
    diagnoses: [],
    doctors: [],
    financeEntries: [],
    forms: [],
    id,
    invoices: [],
    organizationId,
    organizationProfile: {
      assistantMessages: [],
      contact: ownerEmail,
      doctorProfileNotifications: [],
      legalName: organizationName,
      license: '',
      name: organizationName,
    },
    patientPayments: [],
    patientProfiles: [],
    patients: [],
    prescriptions: [],
    procedures: [],
    reports: [],
    revenueData: [],
    rolePermissions: [],
    roles: [],
    sickLeaves: [],
    staffUsers: [],
    symptoms: [],
  };
}

function patientFixture(id: string, organizationId: string, name: string, email: string) {
  return {
    age: 35,
    balance: 0,
    dentalChart: [],
    email,
    emergencyContacts: [],
    gender: 'other',
    id,
    lastVisit: '',
    medicalHistory: [],
    name,
    notes: [],
    organizationId,
    phone: '',
    status: 'active',
  };
}

async function verifyAttachments() {
  requireOptIn();
  forceLocalRecordStorage();

  // env.ts loads the configured database and auth secrets. It must run only
  // after the local-storage override above.
  await import('../src/env');

  assert.ok(
    process.env.DIRECT_URL?.trim() || process.env.DATABASE_URL?.trim(),
    'DIRECT_URL or DATABASE_URL must point at the intended integration database.',
  );

  const [
    { createApp },
    { buildSession },
    { prisma },
    storage,
    { default: sharp },
  ] = await Promise.all([
    import('../src/app'),
    import('../src/auth/sessions'),
    import('../src/db'),
    import('../src/storage/bucket'),
    import('sharp'),
  ]);

  assert.equal(
    storage.storageDriver(),
    'local',
    'Attachment verification must use the local storage driver, never a cloud bucket.',
  );

  const runSuffix = `${Date.now()}-${randomUUID().replace(/-/g, '').slice(0, 12)}`;
  const prefix = `attachment-verify-${runSuffix}`;
  const planId = `${prefix}-plan`;
  const organizationIds = [`${prefix}-org-a`, `${prefix}-org-b`] as const;
  const userIds = [`${prefix}-user-a`, `${prefix}-user-b`] as const;
  const workspaceIds = [`${prefix}-workspace-a`, `${prefix}-workspace-b`] as const;
  const patientIds = [`${prefix}-patient-a`, `${prefix}-patient-b`] as const;
  const diagnosisIds = [`${prefix}-diagnosis-a`, `${prefix}-diagnosis-b`] as const;
  const emails = [
    `attachment-verify-${runSuffix}-a@example.invalid`,
    `attachment-verify-${runSuffix}-b@example.invalid`,
  ] as const;
  const organizationNames = [
    `Attachment Verification A ${runSuffix}`,
    `Attachment Verification B ${runSuffix}`,
  ] as const;
  const userNames = ['Attachment Verifier A', 'Attachment Verifier B'] as const;
  const storagePaths = new Set<string>();
  let server: Server | null = null;
  let baseUrl = '';
  let primaryFailure: unknown = null;

  const request = async (
    token: string,
    path: string,
    options: RequestOptions = {},
  ) => {
    const headers: Record<string, string> = {
      Authorization: `Bearer ${token}`,
      'User-Agent': 'Bravestone Attachment Integration/1.0',
    };

    if (options.body !== undefined) {
      headers['Content-Type'] = 'application/json';
    }

    if (options.organizationId) {
      headers['X-Clinic-Organization-Id'] = options.organizationId;
    }

    return fetch(`${baseUrl}${path}`, {
      body: options.body === undefined ? undefined : JSON.stringify(options.body),
      headers,
      method: options.method || 'GET',
    });
  };

  const uploadBody = (
    patientId: string,
    fileName: string,
    dataUrl: string,
    isRadiograph = false,
    recordId?: string,
  ) => ({
    dataUrl,
    fileName,
    isRadiograph,
    patientId,
    ...(recordId ? { recordId } : {}),
  });

  const cleanupErrors: Array<{ error: unknown; label: string }> = [];
  const cleanupAttempt = async (label: string, action: () => Promise<unknown>) => {
    try {
      await action();
    } catch (error) {
      cleanupErrors.push({ error, label });
    }
  };

  try {
    const now = new Date();
    const dueDate = new Date(now.getTime() + 30 * 24 * 60 * 60 * 1000);

    await prisma.$transaction(async (transaction) => {
      await transaction.plan.create({
        data: {
          id: planId,
          name: `Attachment verification ${runSuffix}`,
          price: 0,
          summary: 'Throwaway plan for the guarded attachment integration verification.',
        },
      });

      await transaction.organization.createMany({
        data: organizationIds.map((id, index) => ({
          aiResetDate: dueDate,
          dueDate,
          id,
          name: organizationNames[index]!,
          owner: userNames[index]!,
          ownerEmail: emails[index]!,
          paymentStatus: 'paid',
          planId,
          status: 'active',
        })),
      });

      await transaction.user.createMany({
        data: userIds.map((id, index) => ({
          authUserId: id,
          email: emails[index]!,
          emailVerifiedAt: now,
          fullName: userNames[index]!,
          id,
          organizationId: organizationIds[index]!,
          role: 'clinic_admin',
          status: 'active',
        })),
      });

      await transaction.clinicWorkspaceState.createMany({
        data: workspaceIds.map((id, index) => emptyWorkspace(
          id,
          organizationIds[index]!,
          organizationNames[index]!,
          emails[index]!,
        )),
      });

      await transaction.clinicPatient.createMany({
        data: patientIds.map((id, index) => patientFixture(
          id,
          organizationIds[index]!,
          `Attachment Patient ${index === 0 ? 'A' : 'B'}`,
          `attachment-patient-${runSuffix}-${index === 0 ? 'a' : 'b'}@example.invalid`,
        )),
      });

      await transaction.clinicDiagnosis.createMany({
        data: diagnosisIds.map((id, index) => ({
          attachments: [],
          date: '2026-07-31',
          diagnosis: 'Attachment integration fixture',
          doctor: 'Integration verifier',
          id,
          organizationId: organizationIds[index]!,
          patient: `Attachment Patient ${index === 0 ? 'A' : 'B'}`,
          patientId: patientIds[index]!,
          severity: 'Low',
          tooth: '#1',
        })),
      });
    });

    const users = await prisma.user.findMany({
      orderBy: { id: 'asc' },
      where: { id: { in: [...userIds] } },
    });
    const userById = new Map(users.map((user) => [user.id, user]));

    assert.equal(users.length, 2, 'Both throwaway users must exist before issuing sessions.');

    const sessionA = await buildSession(userById.get(userIds[0])!, {
      browser: 'Integration browser A',
      deviceLabel: 'Integration browser A on test runner',
      deviceType: 'desktop',
      ipAddress: '192.0.2.10',
      os: 'Test runner',
      userAgent: 'Bravestone Attachment Integration A/1.0',
    });
    const sessionB = await buildSession(userById.get(userIds[1])!, {
      browser: 'Integration browser B',
      deviceLabel: 'Integration browser B on test runner',
      deviceType: 'desktop',
      ipAddress: '192.0.2.11',
      os: 'Test runner',
      userAgent: 'Bravestone Attachment Integration B/1.0',
    });

    const app = createApp();
    server = app.listen(0, '127.0.0.1');

    await new Promise<void>((resolve, reject) => {
      server!.once('listening', resolve);
      server!.once('error', reject);
    });

    const address = server.address();
    assert.ok(address && typeof address !== 'string', 'The in-process API did not bind a TCP port.');
    baseUrl = `http://127.0.0.1:${(address as AddressInfo).port}`;

    const sourceWidth = 32;
    const sourceHeight = 32;
    const sourceChannels = 3;
    const sourceSamples = Buffer.alloc(sourceWidth * sourceHeight * sourceChannels);

    // Every channel varies across the image. A flat color would miss a lossy
    // pipeline that happened to reproduce only that one color exactly.
    for (let y = 0; y < sourceHeight; y += 1) {
      for (let x = 0; x < sourceWidth; x += 1) {
        const offset = (y * sourceWidth + x) * sourceChannels;
        sourceSamples[offset] = (x * 7 + y * 3) % 256;
        sourceSamples[offset + 1] = (x * 11 + y * 5) % 256;
        sourceSamples[offset + 2] = (x * 13 + y * 17) % 256;
      }
    }

    const sourcePng = await sharp(sourceSamples, {
      raw: {
        channels: sourceChannels,
        height: sourceHeight,
        width: sourceWidth,
      },
    }).png().toBuffer();
    const dataUrl = `data:image/png;base64,${sourcePng.toString('base64')}`;

    const missingPatientError = await expectJson<ApiErrorResponse>(
      await request(sessionA.token, '/api/clinic/patient-attachments', {
        body: uploadBody(`${prefix}-missing-patient`, 'missing-patient.png', dataUrl),
        method: 'POST',
        organizationId: organizationIds[0],
      }),
      404,
      'missing-patient upload',
    );
    assert.equal(missingPatientError.code, 'patient_not_found');

    const foreignPatientError = await expectJson<ApiErrorResponse>(
      await request(sessionA.token, '/api/clinic/patient-attachments', {
        body: uploadBody(patientIds[1], 'foreign-patient.png', dataUrl),
        method: 'POST',
        organizationId: organizationIds[0],
      }),
      404,
      'foreign-patient upload',
    );
    assert.equal(foreignPatientError.code, 'patient_not_found');
    assert.equal(
      foreignPatientError.message,
      missingPatientError.message,
      'Missing and foreign patient IDs must be indistinguishable.',
    );

    const missingRecordError = await expectJson<ApiErrorResponse>(
      await request(sessionA.token, '/api/clinic/patient-attachments', {
        body: uploadBody(
          patientIds[0],
          'missing-record.png',
          dataUrl,
          false,
          `${prefix}-missing-diagnosis`,
        ),
        method: 'POST',
        organizationId: organizationIds[0],
      }),
      404,
      'missing-record upload',
    );
    assert.equal(missingRecordError.code, 'record_not_found');

    const foreignRecordError = await expectJson<ApiErrorResponse>(
      await request(sessionA.token, '/api/clinic/patient-attachments', {
        body: uploadBody(patientIds[0], 'foreign-record.png', dataUrl, false, diagnosisIds[1]),
        method: 'POST',
        organizationId: organizationIds[0],
      }),
      404,
      'foreign-record upload',
    );
    assert.equal(foreignRecordError.code, 'record_not_found');
    assert.equal(
      foreignRecordError.message,
      missingRecordError.message,
      'Missing and foreign record IDs must be indistinguishable.',
    );

    assert.equal(
      await prisma.patientAttachment.count({
        where: { organizationId: { in: [...organizationIds] } },
      }),
      0,
      'Rejected uploads must not create attachment rows.',
    );

    const mismatchError = await expectJson<ApiErrorResponse>(
      await request(sessionA.token, '/api/clinic/patient-attachments', {
        organizationId: organizationIds[1],
      }),
      403,
      'organization-header mismatch',
    );
    assert.match(mismatchError.message || '', /workspace mismatch/i);

    const createdA = await expectJson<AttachmentResponse>(
      await request(sessionA.token, '/api/clinic/patient-attachments', {
        body: uploadBody(
          patientIds[0],
          `bitewing-clinic-a-${runSuffix}.png`,
          dataUrl,
          true,
          diagnosisIds[0],
        ),
        method: 'POST',
        organizationId: organizationIds[0],
      }),
      201,
      'clinic A upload',
    );

    assert.equal(createdA.attachment.patientId, patientIds[0]);
    assert.equal(
      createdA.attachment.recordId,
      null,
      'An upload remains a draft until a successful workspace save references it.',
    );
    assert.equal(createdA.attachment.uploadedByName, userNames[0]);
    assert.equal(createdA.attachment.isRadiograph, true);
    assert.ok(createdA.attachment.bytes > 0);
    assert.equal(createdA.attachment.width, sourceWidth);
    assert.equal(createdA.attachment.height, sourceHeight);

    const rowA = await prisma.patientAttachment.findUnique({
      where: { id: createdA.attachment.id },
    });
    assert.ok(rowA, 'Clinic A attachment row must exist.');
    assert.equal(rowA.organizationId, organizationIds[0]);
    assert.equal(rowA.contentType, 'image/webp');
    assert.equal(rowA.isRadiograph, true);
    assert.equal(rowA.recordId, null);
    storagePaths.add(rowA.storagePath);

    const bootstrapBeforeLink = await expectJson<BootstrapState>(
      await request(sessionA.token, '/api/clinic/bootstrap', {
        organizationId: organizationIds[0],
      }),
      200,
      'clinic A bootstrap before attachment link',
    );
    const diagnosisBeforeLink = bootstrapBeforeLink.diagnoses.find(
      ({ id }) => id === diagnosisIds[0],
    );
    assert.ok(diagnosisBeforeLink, 'Clinic A diagnosis must be present in bootstrap.');
    diagnosisBeforeLink.attachments = [{
      attachmentId: createdA.attachment.id,
      dataUrl: '',
      id: createdA.attachment.id,
      isRadiograph: true,
      name: createdA.attachment.fileName,
      type: 'image/webp',
    }];

    const bootstrapAfterLink = await expectJson<BootstrapState>(
      await request(sessionA.token, '/api/clinic/bootstrap', {
        body: bootstrapBeforeLink,
        method: 'PUT',
        organizationId: organizationIds[0],
      }),
      200,
      'clinic A committing attachment reference',
    );
    const linkedDiagnosis = bootstrapAfterLink.diagnoses.find(
      ({ id }) => id === diagnosisIds[0],
    );
    assert.equal(linkedDiagnosis?.attachments?.[0]?.attachmentId, createdA.attachment.id);
    assert.equal(linkedDiagnosis?.attachments?.[0]?.isRadiograph, true);
    assert.equal(
      (await prisma.patientAttachment.findUnique({ where: { id: createdA.attachment.id } }))?.recordId,
      diagnosisIds[0],
      'A committed workspace reference must durably link the attachment row.',
    );

    const listA = await expectJson<AttachmentListResponse>(
      await request(
        sessionA.token,
        `/api/clinic/patient-attachments?patientId=${encodeURIComponent(patientIds[0])}`,
        { organizationId: organizationIds[0] },
      ),
      200,
      'clinic A attachment list',
    );
    assert.equal(listA.storage.driver, 'local');
    assert.equal(listA.storage.localFallbackAllowed, true);
    assert.deepEqual(listA.attachments.map(({ id }) => id), [createdA.attachment.id]);

    const emptyListB = await expectJson<AttachmentListResponse>(
      await request(sessionB.token, '/api/clinic/patient-attachments', {
        organizationId: organizationIds[1],
      }),
      200,
      'clinic B initial attachment list',
    );
    assert.deepEqual(emptyListB.attachments, []);

    const contentAResponse = await request(
      sessionA.token,
      `/api/clinic/patient-attachments/${encodeURIComponent(createdA.attachment.id)}/content`,
      { organizationId: organizationIds[0] },
    );
    assert.equal(contentAResponse.headers.get('content-type'), 'image/webp');
    assert.match(contentAResponse.headers.get('cache-control') || '', /\bprivate\b/i);
    const contentA = await expectBinary(contentAResponse, 200, 'clinic A attachment content');
    assert.equal(contentA.length, rowA.bytes);
    assert.equal(createHash('sha256').update(contentA).digest('hex'), rowA.checksum);
    assert.deepEqual(contentA, await storage.getObject(rowA.storagePath));

    const localSignedRead = await expectJson<SignedUrlResponse>(
      await request(
        sessionA.token,
        `/api/clinic/patient-attachments/${encodeURIComponent(createdA.attachment.id)}/signed-url`,
        { organizationId: organizationIds[0] },
      ),
      200,
      'clinic A signed read authorization',
    );
    assert.equal(localSignedRead.expiresAt, null);
    assert.equal(localSignedRead.url, null);
    assert.equal(localSignedRead.bytes, rowA.bytes);
    assert.equal(localSignedRead.checksum, rowA.checksum);
    assert.equal(localSignedRead.contentType, 'image/webp');

    const decodedRadiograph = await sharp(contentA)
      .removeAlpha()
      .raw()
      .toBuffer({ resolveWithObject: true });
    assert.equal(decodedRadiograph.info.width, sourceWidth);
    assert.equal(decodedRadiograph.info.height, sourceHeight);
    assert.equal(decodedRadiograph.info.channels, sourceChannels);
    assert.equal(decodedRadiograph.data.length, 3072);

    let preservedSamples = 0;
    for (let index = 0; index < sourceSamples.length; index += 1) {
      if (decodedRadiograph.data[index] === sourceSamples[index]) {
        preservedSamples += 1;
      }
    }
    assert.equal(
      preservedSamples,
      sourceSamples.length,
      `Radiograph WebP changed pixel samples: preserved ${preservedSamples}/${sourceSamples.length}.`,
    );

    const crossReadError = await expectJson<ApiErrorResponse>(
      await request(
        sessionB.token,
        `/api/clinic/patient-attachments/${encodeURIComponent(createdA.attachment.id)}/content`,
        { organizationId: organizationIds[1] },
      ),
      404,
      'clinic B reading clinic A attachment',
    );
    assert.equal(crossReadError.code, 'attachment_not_found');

    const crossSignedReadError = await expectJson<ApiErrorResponse>(
      await request(
        sessionB.token,
        `/api/clinic/patient-attachments/${encodeURIComponent(createdA.attachment.id)}/signed-url`,
        { organizationId: organizationIds[1] },
      ),
      404,
      'clinic B requesting a signed URL for clinic A attachment',
    );
    assert.equal(crossSignedReadError.code, 'attachment_not_found');

    const crossDeleteError = await expectJson<ApiErrorResponse>(
      await request(
        sessionB.token,
        `/api/clinic/patient-attachments/${encodeURIComponent(createdA.attachment.id)}`,
        { method: 'DELETE', organizationId: organizationIds[1] },
      ),
      404,
      'clinic B deleting clinic A attachment',
    );
    assert.equal(crossDeleteError.code, 'attachment_not_found');
    assert.ok(
      await prisma.patientAttachment.findUnique({ where: { id: createdA.attachment.id } }),
      'A cross-clinic DELETE must not remove the attachment row.',
    );

    const createdB = await expectJson<AttachmentResponse>(
      await request(sessionB.token, '/api/clinic/patient-attachments', {
        body: uploadBody(
          patientIds[1],
          `clinic-b-${runSuffix}.png`,
          dataUrl,
          false,
          diagnosisIds[1],
        ),
        method: 'POST',
        organizationId: organizationIds[1],
      }),
      201,
      'clinic B upload',
    );
    const rowB = await prisma.patientAttachment.findUnique({
      where: { id: createdB.attachment.id },
    });
    assert.ok(rowB, 'Clinic B attachment row must exist.');
    assert.equal(rowB.organizationId, organizationIds[1]);
    storagePaths.add(rowB.storagePath);

    const reverseReadError = await expectJson<ApiErrorResponse>(
      await request(
        sessionA.token,
        `/api/clinic/patient-attachments/${encodeURIComponent(createdB.attachment.id)}/content`,
        { organizationId: organizationIds[0] },
      ),
      404,
      'clinic A reading clinic B attachment',
    );
    assert.equal(reverseReadError.code, 'attachment_not_found');

    const reverseDeleteError = await expectJson<ApiErrorResponse>(
      await request(
        sessionA.token,
        `/api/clinic/patient-attachments/${encodeURIComponent(createdB.attachment.id)}`,
        { method: 'DELETE', organizationId: organizationIds[0] },
      ),
      404,
      'clinic A deleting clinic B attachment',
    );
    assert.equal(reverseDeleteError.code, 'attachment_not_found');

    const bootstrapBeforeUnlink = await expectJson<BootstrapState>(
      await request(sessionA.token, '/api/clinic/bootstrap', {
        organizationId: organizationIds[0],
      }),
      200,
      'clinic A bootstrap before attachment unlink',
    );
    const diagnosisBeforeUnlink = bootstrapBeforeUnlink.diagnoses.find(
      ({ id }) => id === diagnosisIds[0],
    );
    assert.ok(diagnosisBeforeUnlink, 'Clinic A diagnosis must remain available before unlink.');
    diagnosisBeforeUnlink.attachments = [];
    await expectJson<BootstrapState>(
      await request(sessionA.token, '/api/clinic/bootstrap', {
        body: bootstrapBeforeUnlink,
        method: 'PUT',
        organizationId: organizationIds[0],
      }),
      200,
      'clinic A committing attachment removal',
    );
    assert.equal(
      await prisma.patientAttachment.findUnique({ where: { id: createdA.attachment.id } }),
      null,
      'A committed reference removal must delete the attachment row.',
    );
    await assert.rejects(() => storage.getObject(rowA.storagePath));

    const listBAfterADelete = await expectJson<AttachmentListResponse>(
      await request(sessionB.token, '/api/clinic/patient-attachments', {
        organizationId: organizationIds[1],
      }),
      200,
      'clinic B list after clinic A delete',
    );
    assert.deepEqual(listBAfterADelete.attachments.map(({ id }) => id), [createdB.attachment.id]);

    const deletedContentA = await expectJson<ApiErrorResponse>(
      await request(
        sessionA.token,
        `/api/clinic/patient-attachments/${encodeURIComponent(createdA.attachment.id)}/content`,
        { organizationId: organizationIds[0] },
      ),
      404,
      'deleted clinic A attachment content',
    );
    assert.equal(deletedContentA.code, 'attachment_not_found');

    const deleteB = await expectJson<{ id: string }>(
      await request(
        sessionB.token,
        `/api/clinic/patient-attachments/${encodeURIComponent(createdB.attachment.id)}`,
        { method: 'DELETE', organizationId: organizationIds[1] },
      ),
      200,
      'clinic B deleting its attachment',
    );
    assert.equal(deleteB.id, createdB.attachment.id);
    await assert.rejects(() => storage.getObject(rowB.storagePath));

    assert.equal(
      await prisma.patientAttachment.count({
        where: { organizationId: { in: [...organizationIds] } },
      }),
      0,
      'The successful delete routes must remove both attachment rows.',
    );

    console.log('Attachment integration verification passed for two isolated throwaway clinics.');
  } catch (error) {
    primaryFailure = error;
  }

  await cleanupAttempt('closing the in-process API server', () => closeServer(server));

  let remainingRows: Array<{ storagePath: string }> = [];
  await cleanupAttempt('discovering remaining attachment objects', async () => {
    remainingRows = await prisma.patientAttachment.findMany({
      select: { storagePath: true },
      where: { organizationId: { in: [...organizationIds] } },
    });
  });
  remainingRows.forEach(({ storagePath }) => storagePaths.add(storagePath));

  for (const storagePath of storagePaths) {
    await cleanupAttempt(`removing local object ${storagePath}`, () => storage.removeObject(storagePath));
  }

  await cleanupAttempt('removing run-scoped database fixtures', () => prisma.$transaction(async (transaction) => {
    await transaction.patientAttachment.deleteMany({
      where: { organizationId: { in: [...organizationIds] } },
    });
    await transaction.authSession.deleteMany({
      where: { userId: { in: [...userIds] } },
    });
    await transaction.clinicDiagnosis.deleteMany({
      where: { organizationId: { in: [...organizationIds] } },
    });
    await transaction.clinicPatient.deleteMany({
      where: { organizationId: { in: [...organizationIds] } },
    });
    await transaction.clinicWorkspaceState.deleteMany({
      where: { organizationId: { in: [...organizationIds] } },
    });
    await transaction.user.deleteMany({
      where: { id: { in: [...userIds] } },
    });
    await transaction.organization.deleteMany({
      where: { id: { in: [...organizationIds] } },
    });
    await transaction.plan.deleteMany({ where: { id: planId } });
  }));

  await cleanupAttempt('disconnecting Prisma', () => prisma.$disconnect());

  if (cleanupErrors.length) {
    const cleanupFailure = new AggregateError(
      cleanupErrors.map(({ error }) => error),
      `Attachment verification cleanup failed: ${cleanupErrors.map(({ label }) => label).join(', ')}`,
    );

    if (primaryFailure) {
      console.error(cleanupFailure);
    } else {
      primaryFailure = cleanupFailure;
    }
  }

  if (primaryFailure) {
    throw primaryFailure;
  }
}

verifyAttachments().catch((error) => {
  console.error('');
  console.error(`Attachment integration verification failed: ${error instanceof Error ? error.message : String(error)}`);
  process.exitCode = 1;
});
