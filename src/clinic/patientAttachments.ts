/**
 * Patient record images: stored in a private bucket, indexed in Postgres.
 *
 * Not to be confused with `attachments.ts`, which extracts text from files a user
 * hands the AI assistant. This module owns clinical images belonging to a patient's
 * chart, which used to be base64 `dataUrl` strings inside the workspace snapshot.
 *
 * The permission boundary is here rather than in the storage driver. Every read and
 * write is checked against the caller's organization *and* their patient access, so a
 * signed session for clinic A can never reach clinic B's images even holding a valid
 * attachment id. Storage paths never reach a browser at all: reads are streamed
 * through the API, and the bucket itself is private.
 */
import { createHash, randomBytes } from 'node:crypto';
import { AuthError } from '../auth/accounts';
import { prisma } from '../db';
import {
  createSignedUrl,
  getObject,
  isCloudStorageConfigured,
  putObject,
  removeObject,
  removeObjects,
  storageDriver,
} from '../storage/bucket';
import {
  ImageRejected,
  parseDataUrl,
  prepareImage,
  resolveIsRadiograph,
  sanitizeFileName,
} from '../storage/images';
import { canOpenFeature, type WorkspaceAccess } from './permissions';
import type { ClinicDiagnosis } from './types';

/** How long a read URL stays valid. Long enough to render, short enough to not be a handle. */
const signedUrlSeconds = 120;

/** A cap per patient, so one clinic cannot fill the bucket by accident. */
const maxAttachmentsPerPatient = 60;

export type AttachmentSummary = {
  bytes: number;
  createdAt: string;
  fileName: string;
  height: number | null;
  id: string;
  isRadiograph: boolean;
  patientRecord: boolean;
  patientId: string;
  recordId: string | null;
  uploadedByName: string | null;
  width: number | null;
};

type AttachmentRow = {
  bytes: number;
  createdAt: Date;
  fileName: string;
  height: number | null;
  id: string;
  isRadiograph: boolean;
  patientRecord: boolean;
  patientId: string;
  recordId: string | null;
  uploadedByName: string | null;
  width: number | null;
};

function toSummary(row: AttachmentRow): AttachmentSummary {
  return {
    bytes: row.bytes,
    createdAt: row.createdAt.toISOString(),
    fileName: row.fileName,
    height: row.height,
    id: row.id,
    isRadiograph: row.isRadiograph,
    patientRecord: row.patientRecord,
    patientId: row.patientId,
    recordId: row.recordId,
    uploadedByName: row.uploadedByName,
    width: row.width,
  };
}

/**
 * Patient images are part of the patient record, so the gate is the patients
 * section. A role that cannot open Patients has no business fetching their photos.
 */
function assertPatientAccess(access: WorkspaceAccess) {
  if (!canOpenFeature(access, 'patients')) {
    throw new AuthError(403, 'forbidden', 'You do not have access to patient records.');
  }
}

function requireWorkspaceId(value: unknown, field: string) {
  const trimmed = typeof value === 'string' ? value.trim() : '';

  if (!trimmed || trimmed.length > 120) {
    throw new AuthError(400, 'invalid_request', `A valid ${field} is required.`);
  }

  return trimmed;
}

/**
 * Builds the object path.
 *
 * Composed only from ids we control plus random bytes — never from the uploaded file
 * name, so a name like `../../avatars/x.png` cannot reach another prefix. The
 * organization is the first segment, which keeps one clinic's objects contiguous and
 * makes a bucket-level policy or a bulk delete straightforward.
 */
function buildStoragePath(input: { organizationId: string; patientId: string }) {
  const safeOrganization = input.organizationId.replace(/[^a-zA-Z0-9_-]/g, '');
  const safePatient = input.patientId.replace(/[^a-zA-Z0-9_-]/g, '') || 'patient';

  return `${safeOrganization}/${safePatient}/${Date.now()}-${randomBytes(8).toString('hex')}.webp`;
}

function rethrowImageError(error: unknown): never {
  if (error instanceof ImageRejected) {
    throw new AuthError(error.status, error.code, error.message);
  }

  throw error;
}

type PatientAttachmentReference = {
  attachmentId: string;
  patientId: string;
  recordId: string;
};

/** Patient-level gallery images are durable even though they intentionally have
 * no diagnosis id. Only diagnosis drafts use age-based orphan reclamation. */
export function shouldReclaimUnreferencedAttachment(
  row: Pick<AttachmentRow, 'createdAt' | 'patientRecord' | 'recordId'>,
  hasDiagnosisReference: boolean,
  now = Date.now()
) {
  return !row.patientRecord
    && !hasDiagnosisReference
    && (Boolean(row.recordId) || row.createdAt.getTime() < now - 24 * 60 * 60 * 1000);
}

function collectPatientAttachmentReferences(diagnoses: ClinicDiagnosis[]) {
  const references = new Map<string, PatientAttachmentReference>();

  for (const diagnosis of diagnoses) {
    const patientId = diagnosis.patientId || diagnosis.patient;

    for (const attachment of diagnosis.attachments || []) {
      const attachmentId = attachment.attachmentId?.trim();

      if (!attachmentId) {
        continue;
      }

      const existing = references.get(attachmentId);

      if (
        existing
        && (existing.recordId !== diagnosis.id || existing.patientId !== patientId)
      ) {
        throw new AuthError(
          400,
          'attachment_reference_conflict',
          'The same stored image cannot belong to more than one patient record.'
        );
      }

      references.set(attachmentId, {
        attachmentId,
        patientId,
        recordId: diagnosis.id,
      });
    }
  }

  return references;
}

/**
 * Validates storage-backed references before the clinic workspace transaction.
 *
 * A browser may remove a reference, but it may not move an existing image to a
 * different patient/record or use a same-clinic id as an ownership shortcut.
 * Missing ids are tolerated so one stale image does not block unrelated chart
 * edits; they still render as unavailable and reveal nothing about another clinic.
 */
export async function validatePatientAttachmentReferences(input: {
  diagnoses: ClinicDiagnosis[];
  organizationId: string;
}) {
  const references = collectPatientAttachmentReferences(input.diagnoses);

  if (!references.size) {
    return;
  }

  const rows = await prisma.patientAttachment.findMany({
    select: { id: true, patientId: true, patientRecord: true, recordId: true },
    where: {
      id: { in: [...references.keys()] },
      organizationId: input.organizationId,
    },
  });

  for (const row of rows) {
    const reference = references.get(row.id)!;

    if (row.patientId !== reference.patientId) {
      throw new AuthError(
        400,
        'attachment_patient_mismatch',
        'A stored image cannot be moved to a different patient.'
      );
    }

    if (row.patientRecord) {
      throw new AuthError(
        400,
        'attachment_scope_mismatch',
        'A patient image-record item cannot be moved into a diagnosis.'
      );
    }

    if (row.recordId && row.recordId !== reference.recordId) {
      throw new AuthError(
        400,
        'attachment_record_mismatch',
        'A stored image cannot be moved to a different patient record.'
      );
    }
  }
}

/**
 * Runs only after the clinic workspace transaction succeeds.
 *
 * Newly uploaded draft rows receive their durable record link. Rows whose saved
 * diagnosis no longer references them are then removed from private storage and
 * Postgres. A storage outage keeps the rows for a later retry rather than deleting
 * the only index of PHI that still exists.
 */
export async function reconcilePatientAttachmentReferences(input: {
  diagnoses: ClinicDiagnosis[];
  organizationId: string;
}) {
  const references = collectPatientAttachmentReferences(input.diagnoses);
  const rows = await prisma.patientAttachment.findMany({
    where: { organizationId: input.organizationId },
  });

  const linkUpdates = rows.flatMap((row) => {
    const reference = references.get(row.id);

    if (!reference || row.recordId === reference.recordId) {
      return [];
    }

    // Validation above prevents reassignment of a non-null recordId. This branch
    // therefore links only rows uploaded while a new record draft was open.
    return [prisma.patientAttachment.updateMany({
      data: { recordId: reference.recordId },
      where: {
        id: row.id,
        organizationId: input.organizationId,
        patientId: reference.patientId,
        recordId: null,
      },
    })];
  });

  await Promise.all(linkUpdates);

  const removedRows = rows.filter((row) => (
    shouldReclaimUnreferencedAttachment(row, references.has(row.id))
  ));

  if (!removedRows.length) {
    return;
  }

  try {
    await removeObjects(removedRows.map((row) => row.storagePath));
    await prisma.patientAttachment.deleteMany({
      where: {
        id: { in: removedRows.map((row) => row.id) },
        organizationId: input.organizationId,
      },
    });
  } catch (error) {
    console.error(
      `Could not reconcile ${removedRows.length} unreferenced patient attachment object(s) for organization ${input.organizationId}.`,
      error
    );
  }
}

export async function listPatientAttachments(input: {
  access: WorkspaceAccess;
  organizationId: string;
  patientId?: string;
}) {
  assertPatientAccess(input.access);

  const rows = await prisma.patientAttachment.findMany({
    orderBy: { createdAt: 'desc' },
    take: 500,
    where: {
      organizationId: input.organizationId,
      ...(input.patientId ? { patientId: input.patientId } : {}),
    },
  });

  return rows.map(toSummary);
}

export async function createPatientAttachment(input: {
  access: WorkspaceAccess;
  actorId?: string;
  actorName?: string;
  body: Record<string, unknown>;
  organizationId: string;
}) {
  assertPatientAccess(input.access);

  if (!isCloudStorageConfigured() && process.env.ALLOW_LOCAL_RECORD_STORAGE !== 'true') {
    // Refusing loudly beats writing a clinical image somewhere it will be lost on
    // the next deploy. The operator opts in explicitly for local development.
    throw new AuthError(
      503,
      'storage_unconfigured',
      'Image storage is not set up on the server yet. Ask your administrator to finish configuring the records bucket.'
    );
  }

  const patientId = requireWorkspaceId(input.body.patientId, 'patient');
  const patientRecord = input.body.patientRecord === true;
  const recordId = typeof input.body.recordId === 'string' && input.body.recordId.trim()
    ? input.body.recordId.trim().slice(0, 120)
    : null;
  const fileName = sanitizeFileName(input.body.fileName ?? input.body.name);

  if (patientRecord && recordId) {
    throw new AuthError(
      400,
      'invalid_attachment_scope',
      'Choose either the patient image record or a diagnosis record for this image.'
    );
  }

  // A client-supplied id must not create an unbounded set of fake "patients" that
  // bypasses the per-patient cap. Use the same answer for missing and foreign ids so
  // the endpoint cannot be used to enumerate another clinic's patients.
  const patient = await prisma.clinicPatient.findFirst({
    select: { id: true },
    where: { id: patientId, organizationId: input.organizationId },
  });

  if (!patient) {
    throw new AuthError(404, 'patient_not_found', 'That patient is no longer available.');
  }

  if (recordId) {
    const record = await prisma.clinicDiagnosis.findFirst({
      select: { id: true },
      where: {
        id: recordId,
        organizationId: input.organizationId,
        patientId,
      },
    });

    if (!record) {
      throw new AuthError(404, 'record_not_found', 'That patient record is no longer available.');
    }
  }

  const existingCount = await prisma.patientAttachment.count({
    where: { organizationId: input.organizationId, patientId },
  });

  if (existingCount >= maxAttachmentsPerPatient) {
    throw new AuthError(
      409,
      'attachment_limit',
      `This patient already has ${maxAttachmentsPerPatient} images. Remove one before adding another.`
    );
  }

  let prepared;

  try {
    const { contents } = parseDataUrl(input.body.dataUrl);
    prepared = await prepareImage({
      contents,
      fileName,
      isRadiograph: resolveIsRadiograph(fileName, input.body.isRadiograph),
    });
  } catch (error) {
    rethrowImageError(error);
  }

  const storagePath = buildStoragePath({ organizationId: input.organizationId, patientId });
  await putObject({
    contentType: prepared.contentType,
    contents: prepared.contents,
    path: storagePath,
  });

  try {
    const row = await prisma.patientAttachment.create({
      data: {
        bytes: prepared.contents.length,
        checksum: prepared.checksum,
        contentType: prepared.contentType,
        fileName,
        height: prepared.height,
        isRadiograph: prepared.isRadiograph,
        patientRecord,
        organizationId: input.organizationId,
        patientId,
        // The request's recordId is an ownership assertion only. The row becomes
        // durably linked when a successful workspace PUT actually references it,
        // avoiding a race where autosave deletes an upload still in an open draft.
        recordId: null,
        storagePath,
        uploadedById: input.actorId || null,
        uploadedByName: input.actorName || null,
        width: prepared.width,
      },
    });

    return toSummary(row);
  } catch (error) {
    // Without this the bucket accumulates objects no row points at, which nothing
    // would ever clean up or even be able to find.
    try {
      await removeObject(storagePath);
    } catch (cleanupError) {
      // Keep the original database failure as the response, but make a failed
      // compensating delete observable so operations can remove the orphan.
      console.error('Could not roll back a patient attachment object after its database write failed.', cleanupError);
    }
    throw error;
  }
}

/** The row, once the caller has been proven to be in the owning organization. */
async function loadOwnedAttachment(input: {
  access: WorkspaceAccess;
  attachmentId: string;
  organizationId: string;
}) {
  assertPatientAccess(input.access);

  const row = await prisma.patientAttachment.findUnique({ where: { id: input.attachmentId } });

  // Same answer for "does not exist" and "belongs to another clinic", so an id
  // cannot be probed to discover whether it is real.
  if (!row || row.organizationId !== input.organizationId) {
    throw new AuthError(404, 'attachment_not_found', 'That image is no longer available.');
  }

  return row;
}

/**
 * The image bytes, for the API to send on.
 *
 * Streamed through the API rather than answered with a redirect to the signed URL.
 * Redirecting would be cheaper on our bandwidth, but it would mean either putting the
 * session token in a query string (an `<img>` cannot send a header) or depending on
 * the storage host's CORS configuration for every image to render. Streaming keeps
 * the credential in a header, keeps the storage path and signed URL entirely
 * server-side, and has no cross-origin failure mode.
 *
 * `signedReadUrl` exists for the cases that genuinely need a direct link — a
 * "download original" or an emailed report — and is not used to render the chart.
 */
export async function resolvePatientAttachment(input: {
  access: WorkspaceAccess;
  attachmentId: string;
  organizationId: string;
}) {
  const row = await loadOwnedAttachment(input);
  const contents = await getObject(row.storagePath);
  const checksum = createHash('sha256').update(contents).digest('hex');

  if (checksum !== row.checksum) {
    throw new AuthError(
      502,
      'attachment_corrupt',
      'That image failed its integrity check. Ask your administrator to restore it from backup.'
    );
  }

  return {
    contents,
    contentType: row.contentType,
    fileName: row.fileName,
  };
}

/** A time-limited direct URL, for deliberate download links rather than rendering. */
export async function signedReadUrl(input: {
  access: WorkspaceAccess;
  attachmentId: string;
  organizationId: string;
}) {
  const row = await loadOwnedAttachment(input);
  const url = await createSignedUrl(row.storagePath, signedUrlSeconds);

  return {
    bytes: row.bytes,
    checksum: row.checksum,
    contentType: row.contentType,
    expiresAt: url ? new Date(Date.now() + signedUrlSeconds * 1000).toISOString() : null,
    url,
  };
}

export async function deletePatientAttachment(input: {
  access: WorkspaceAccess;
  attachmentId: string;
  organizationId: string;
}) {
  const row = await loadOwnedAttachment(input);

  // Remove the PHI first. If the database delete then fails, the visible row gives
  // the operation a durable handle that can be retried; deleting the row first and
  // suppressing an object-store failure would leave undiscoverable patient data in
  // the bucket forever.
  try {
    await removeObject(row.storagePath);
  } catch {
    throw new AuthError(
      503,
      'attachment_delete_failed',
      'The image could not be removed securely. Please try again.'
    );
  }

  await prisma.patientAttachment.delete({ where: { id: row.id } });

  return { id: row.id };
}

/** Reported by the health endpoint so a half-configured deploy is obvious. */
export function describeAttachmentStorage() {
  return {
    configured: isCloudStorageConfigured(),
    driver: storageDriver(),
    localFallbackAllowed: process.env.ALLOW_LOCAL_RECORD_STORAGE === 'true',
  };
}
