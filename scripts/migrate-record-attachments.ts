/**
 * Moves patient record images out of `clinic_diagnoses.attachments` (base64 data
 * URLs, stored inline in Postgres) and into the private records bucket.
 *
 *   npm run migrate:attachments            # copy into the bucket, keep the base64
 *   npm run migrate:attachments -- --purge # then clear the base64, once verified
 *   npm run migrate:attachments -- --dry-run
 *
 * Two steps on purpose. The first is additive: every image is uploaded and an
 * `attachmentId` is recorded next to the existing `dataUrl`, so the app can render
 * from either and nothing is lost if an upload silently failed. Only once you have
 * looked at the images does `--purge` strip the base64 and reclaim the row size.
 *
 * `--purge` refuses to clear anything that does not already have a matching
 * attachment row whose checksum verifies against the stored object, so a half-done
 * first pass cannot turn into data loss.
 */
import '../src/env';
import { createHash } from 'node:crypto';
import type { PatientAttachment } from '@prisma/client';
import { prisma } from '../src/db';
import {
  getObject,
  isCloudStorageConfigured,
  putObject,
  removeObject,
  storageDriver,
} from '../src/storage/bucket';
import {
  parseDataUrl,
  prepareImage,
  resolveIsRadiograph,
  sanitizeFileName,
  type PreparedImage,
} from '../src/storage/images';

const purge = process.argv.includes('--purge');
const dryRun = process.argv.includes('--dry-run');

type StoredAttachment = {
  attachmentId?: unknown;
  dataUrl?: unknown;
  id?: unknown;
  name?: unknown;
  type?: unknown;
};

function isMigratableDataUrl(value: unknown): value is string {
  return typeof value === 'string' && value.startsWith('data:image/') && value.length > 64;
}

function formatBytes(bytes: number) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
}

function describeError(error: unknown) {
  return error instanceof Error ? error.message : String(error);
}

function sha256(contents: Buffer | string) {
  return createHash('sha256').update(contents).digest('hex');
}

function safeStorageSegment(value: string, label: string) {
  const safe = value.replace(/[^a-zA-Z0-9_-]/g, '').slice(0, 100);
  return safe || `${label}-${sha256(value).slice(0, 16)}`;
}

function patientKeyFor(diagnosis: { patient: string; patientId: string | null }) {
  return diagnosis.patientId || diagnosis.patient || 'patient';
}

/**
 * Stable across reruns and independent of how many images were encountered before
 * this one. A persisted attachment id wins; old entries without one fall back to
 * their index inside this diagnosis.
 */
function buildStoragePath(input: {
  attachment: StoredAttachment;
  attachmentIndex: number;
  diagnosisId: string;
  organizationId: string;
}) {
  const safeOrganization = safeStorageSegment(input.organizationId, 'organization');
  const safeDiagnosis = safeStorageSegment(input.diagnosisId, 'diagnosis');
  const attachmentId = typeof input.attachment.id === 'string'
    ? input.attachment.id.trim()
    : '';
  const sourceIdentity = attachmentId
    ? `id:${attachmentId}`
    : `index:${input.attachmentIndex}`;
  const attachmentKey = sha256(sourceIdentity).slice(0, 32);

  return `${safeOrganization}/migrated/${safeDiagnosis}/${attachmentKey}.webp`;
}

function ownershipIssue(
  row: PatientAttachment,
  expected: {
    diagnosisId: string;
    organizationId: string;
    patientId: string;
  },
) {
  if (row.organizationId !== expected.organizationId) {
    return `belongs to organization ${row.organizationId}, not ${expected.organizationId}`;
  }

  if (row.recordId !== expected.diagnosisId) {
    return `belongs to record ${row.recordId || '(none)'}, not ${expected.diagnosisId}`;
  }

  if (row.patientId !== expected.patientId) {
    return `belongs to patient ${row.patientId}, not ${expected.patientId}`;
  }

  return null;
}

function assertReusableRow(
  row: PatientAttachment,
  expected: {
    diagnosisId: string;
    organizationId: string;
    patientId: string;
    prepared: PreparedImage;
    storagePath: string;
  },
) {
  const issue = ownershipIssue(row, expected);

  if (issue) {
    throw new Error(
      `Storage path ${expected.storagePath} is already indexed by attachment ${row.id}, which ${issue}.`
    );
  }

  if (
    row.checksum !== expected.prepared.checksum
    || row.bytes !== expected.prepared.contents.length
  ) {
    throw new Error(
      `Attachment row ${row.id} does not match the image currently stored at ${expected.storagePath}.`
    );
  }
}

/**
 * Uploads a new object, or verifies and reuses one left by an interrupted prior
 * run. Supabase rejects overwrites and the local path is deterministic, so an
 * upload error is followed by a read-and-check rather than a destructive retry.
 */
async function ensureStoredObject(storagePath: string, prepared: PreparedImage) {
  let existing: Buffer | null = null;

  try {
    existing = await getObject(storagePath);
  } catch (readError) {
    if (
      storageDriver() === 'local'
      && (readError as NodeJS.ErrnoException).code !== 'ENOENT'
    ) {
      throw readError;
    }

    // A missing object is the normal first-run case. If this was instead a
    // transient read failure, the upload below either succeeds safely or is
    // rejected as a collision and followed by another verified read.
  }

  if (existing) {
    if (
      existing.length !== prepared.contents.length
      || sha256(existing) !== prepared.checksum
    ) {
      throw new Error(
        `Storage path ${storagePath} already exists with different contents; refusing to overwrite it.`
      );
    }

    return { created: false };
  }

  try {
    await putObject({
      contentType: prepared.contentType,
      contents: prepared.contents,
      path: storagePath,
    });
    return { created: true };
  } catch (uploadError) {
    let retryContents: Buffer;

    try {
      retryContents = await getObject(storagePath);
    } catch (readError) {
      throw new Error(
        `Could not upload ${storagePath} (${describeError(uploadError)}), and no reusable object could be read (${describeError(readError)}).`
      );
    }

    if (
      retryContents.length !== prepared.contents.length
      || sha256(retryContents) !== prepared.checksum
    ) {
      throw new Error(
        `Storage path ${storagePath} already exists with different contents; refusing to overwrite it.`
      );
    }

    return { created: false };
  }
}

async function persistMigratedAttachment(input: {
  diagnosisId: string;
  fileName: string;
  organizationId: string;
  patientId: string;
  prepared: PreparedImage;
  storagePath: string;
}) {
  const expected = {
    diagnosisId: input.diagnosisId,
    organizationId: input.organizationId,
    patientId: input.patientId,
    prepared: input.prepared,
    storagePath: input.storagePath,
  };
  const priorRow = await prisma.patientAttachment.findUnique({
    where: { storagePath: input.storagePath },
  });

  if (priorRow) {
    assertReusableRow(priorRow, expected);
    await ensureStoredObject(input.storagePath, input.prepared);

    // A prior run got as far as committing the row but not as far as adding the
    // attachmentId to the diagnosis JSON. The object was verified (or restored
    // from the deterministic source bytes), so the row is safe to reuse.
    return priorRow;
  }

  await ensureStoredObject(input.storagePath, input.prepared);

  try {
    return await prisma.patientAttachment.create({
      data: {
        bytes: input.prepared.contents.length,
        checksum: input.prepared.checksum,
        contentType: input.prepared.contentType,
        fileName: input.fileName,
        height: input.prepared.height,
        isRadiograph: input.prepared.isRadiograph,
        organizationId: input.organizationId,
        patientId: input.patientId,
        recordId: input.diagnosisId,
        storagePath: input.storagePath,
        uploadedByName: 'Migrated from record',
        width: input.prepared.width,
      },
    });
  } catch (databaseError) {
    let rowAfterFailure: PatientAttachment | null;

    try {
      rowAfterFailure = await prisma.patientAttachment.findUnique({
        where: { storagePath: input.storagePath },
      });
    } catch (verificationError) {
      // Database state is unknown, so deleting the object could break a row that
      // did commit. Retain it and report both failures for an operator to inspect.
      throw new Error(
        `Could not index ${input.storagePath} (${describeError(databaseError)}), and could not verify whether a row committed (${describeError(verificationError)}). The object was retained.`
      );
    }

    if (rowAfterFailure) {
      // Covers a concurrent migration or a response lost after the DB committed.
      assertReusableRow(rowAfterFailure, expected);
      return rowAfterFailure;
    }

    try {
      await removeObject(input.storagePath);
    } catch (cleanupError) {
      throw new Error(
        `Could not index ${input.storagePath} (${describeError(databaseError)}), and orphan cleanup also failed (${describeError(cleanupError)}).`
      );
    }

    throw databaseError;
  }
}

async function copyPass() {
  const diagnoses = await prisma.clinicDiagnosis.findMany({
    orderBy: { createdAt: 'asc' },
    select: { attachments: true, id: true, organizationId: true, patient: true, patientId: true },
  });

  let scanned = 0;
  let uploaded = 0;
  let skipped = 0;
  let failed = 0;
  let bytesBefore = 0;
  let bytesAfter = 0;

  for (const diagnosis of diagnoses) {
    const attachments = Array.isArray(diagnosis.attachments)
      ? diagnosis.attachments as StoredAttachment[]
      : [];

    if (!attachments.length) {
      continue;
    }

    const patientKey = patientKeyFor(diagnosis);
    let changed = false;
    const next: StoredAttachment[] = [];

    for (let index = 0; index < attachments.length; index++) {
      const attachment = attachments[index]!;

      if (!attachment || typeof attachment !== 'object' || !isMigratableDataUrl(attachment.dataUrl)) {
        next.push(attachment);
        continue;
      }

      scanned += 1;

      const fileName = sanitizeFileName(attachment.name);
      const base64 = attachment.dataUrl.slice(attachment.dataUrl.indexOf(',') + 1);
      const original = Buffer.from(base64, 'base64');
      bytesBefore += original.length;

      if (dryRun) {
        const alreadyLinked = typeof attachment.attachmentId === 'string' && attachment.attachmentId;
        console.log(
          `  would ${alreadyLinked ? 'verify' : 'upload'} ${fileName} (${formatBytes(original.length)}) from diagnosis ${diagnosis.id}`
        );
        if (alreadyLinked) {
          skipped += 1;
        } else {
          uploaded += 1;
        }
        next.push(attachment);
        continue;
      }

      try {
        const prepared = await prepareImage({
          contents: original,
          fileName,
          isRadiograph: resolveIsRadiograph(fileName),
        });
        const existingAttachmentId = typeof attachment.attachmentId === 'string'
          ? attachment.attachmentId.trim()
          : '';

        if (existingAttachmentId) {
          const existingRow = await prisma.patientAttachment.findUnique({
            where: { id: existingAttachmentId },
          });

          if (!existingRow) {
            throw new Error(`attachment row ${existingAttachmentId} no longer exists`);
          }

          const issue = ownershipIssue(existingRow, {
            diagnosisId: diagnosis.id,
            organizationId: diagnosis.organizationId,
            patientId: patientKey,
          });

          if (issue) {
            throw new Error(`attachment ${existingAttachmentId} ${issue}`);
          }

          if (
            existingRow.checksum !== prepared.checksum
            || existingRow.bytes !== prepared.contents.length
          ) {
            throw new Error(
              `attachment ${existingAttachmentId} no longer matches its retained base64 source`
            );
          }

          // Repairs an interrupted run where the row/pointer committed but the
          // object later disappeared, and verifies intact rows without duplicating.
          await ensureStoredObject(existingRow.storagePath, prepared);
          bytesAfter += prepared.contents.length;
          skipped += 1;
          next.push(attachment);
          continue;
        }

        const storagePath = buildStoragePath({
          attachment,
          attachmentIndex: index,
          diagnosisId: diagnosis.id,
          organizationId: diagnosis.organizationId,
        });
        const row = await persistMigratedAttachment({
          diagnosisId: diagnosis.id,
          fileName,
          organizationId: diagnosis.organizationId,
          patientId: patientKey,
          prepared,
          storagePath,
        });

        bytesAfter += prepared.contents.length;
        uploaded += 1;
        changed = true;
        // The dataUrl stays put: this pass only adds the pointer.
        next.push({ ...attachment, attachmentId: row.id });
      } catch (error) {
        failed += 1;
        console.error(`  FAILED ${fileName} (diagnosis ${diagnosis.id}): ${error instanceof Error ? error.message : error}`);
        next.push(attachment);
      }
    }

    if (changed && !dryRun) {
      await prisma.clinicDiagnosis.update({
        data: { attachments: next as never },
        where: { id: diagnosis.id },
      });
    }
  }

  console.log('');
  console.log(`Scanned inline images: ${scanned}`);
  console.log(`Uploaded:              ${uploaded}`);
  console.log(`Already migrated:      ${skipped}`);
  console.log(`Failed:                ${failed}`);

  if (bytesBefore) {
    console.log(`Size:                  ${formatBytes(bytesBefore)} -> ${formatBytes(bytesAfter)}`);
  }

  console.log('');

  if (dryRun) {
    console.log('Dry run: nothing was uploaded or written.');
    return;
  }

  if (failed) {
    console.log('Some images failed. Fix those before purging — --purge will refuse them anyway.');
    return;
  }

  console.log('The base64 copies are still in the database. Open a few patient records and');
  console.log('check the images render, then reclaim the space with:');
  console.log('  npm run migrate:attachments -- --purge');
}

async function purgePass() {
  const diagnoses = await prisma.clinicDiagnosis.findMany({
    orderBy: { createdAt: 'asc' },
    select: {
      attachments: true,
      id: true,
      organizationId: true,
      patient: true,
      patientId: true,
    },
  });

  let cleared = 0;
  let refused = 0;
  let reclaimed = 0;

  for (const diagnosis of diagnoses) {
    const attachments = Array.isArray(diagnosis.attachments)
      ? diagnosis.attachments as StoredAttachment[]
      : [];

    if (!attachments.length) {
      continue;
    }

    let changed = false;
    const next: StoredAttachment[] = [];
    const expectedPatientId = patientKeyFor(diagnosis);

    for (const attachment of attachments) {
      if (!attachment || typeof attachment !== 'object' || !isMigratableDataUrl(attachment.dataUrl)) {
        next.push(attachment);
        continue;
      }

      const attachmentId = typeof attachment.attachmentId === 'string' ? attachment.attachmentId : '';

      if (!attachmentId) {
        refused += 1;
        console.error(`  REFUSED ${String(attachment.name)} (diagnosis ${diagnosis.id}): never migrated.`);
        next.push(attachment);
        continue;
      }

      const row = await prisma.patientAttachment.findUnique({ where: { id: attachmentId } });

      if (!row) {
        refused += 1;
        console.error(`  REFUSED ${String(attachment.name)}: no attachment row ${attachmentId}.`);
        next.push(attachment);
        continue;
      }

      const issue = ownershipIssue(row, {
        diagnosisId: diagnosis.id,
        organizationId: diagnosis.organizationId,
        patientId: expectedPatientId,
      });

      if (issue) {
        refused += 1;
        console.error(`  REFUSED ${String(attachment.name)}: attachment ${attachmentId} ${issue}.`);
        next.push(attachment);
        continue;
      }

      // Rebuild the inline source with the same policy used for the indexed row.
      // Ownership checks alone are not enough: a stale or swapped attachmentId in
      // the same diagnosis could otherwise point at a different valid image and
      // cause us to purge the only correct source.
      let preparedInline: PreparedImage;

      try {
        const { contents } = parseDataUrl(attachment.dataUrl);
        preparedInline = await prepareImage({
          contents,
          fileName: row.fileName,
          isRadiograph: row.isRadiograph,
        });
      } catch (error) {
        refused += 1;
        console.error(`  REFUSED ${row.fileName}: cannot verify the inline source (${describeError(error)}).`);
        next.push(attachment);
        continue;
      }

      if (
        preparedInline.checksum !== row.checksum
        || preparedInline.contents.length !== row.bytes
      ) {
        refused += 1;
        console.error(`  REFUSED ${row.fileName}: inline source does not match attachment ${attachmentId}.`);
        next.push(attachment);
        continue;
      }

      // Read the object back and check both checksum and byte count. This is the
      // whole point of the two-step design: base64 is only dropped once the source,
      // index row, and replacement object all agree.
      try {
        const stored = await getObject(row.storagePath);
        const checksum = createHash('sha256').update(stored).digest('hex');

        if (checksum !== row.checksum || stored.length !== row.bytes) {
          refused += 1;
          console.error(`  REFUSED ${row.fileName}: checksum or size mismatch in the bucket.`);
          next.push(attachment);
          continue;
        }
      } catch (error) {
        refused += 1;
        console.error(`  REFUSED ${row.fileName}: cannot read it back (${error instanceof Error ? error.message : error}).`);
        next.push(attachment);
        continue;
      }

      if (dryRun) {
        console.log(`  would clear ${row.fileName} (${formatBytes(String(attachment.dataUrl).length)})`);
        next.push(attachment);
        continue;
      }

      reclaimed += String(attachment.dataUrl).length;
      cleared += 1;
      changed = true;
      const { dataUrl: _dropped, ...withoutDataUrl } = attachment;
      next.push({ ...withoutDataUrl, dataUrl: '' });
    }

    if (changed && !dryRun) {
      await prisma.clinicDiagnosis.update({
        data: { attachments: next as never },
        where: { id: diagnosis.id },
      });
    }
  }

  console.log('');
  console.log(`Cleared:  ${cleared}`);
  console.log(`Refused:  ${refused}`);
  console.log(`Reclaimed: ~${formatBytes(reclaimed)} of base64 text`);

  if (refused) {
    console.log('');
    console.log('Refused images still have their base64 and still render. Re-run the copy step');
    console.log('to migrate them: npm run migrate:attachments');
  }
}

async function main() {
  console.log(`Driver: ${storageDriver()}${isCloudStorageConfigured() ? '' : ' (no cloud credentials)'}`);
  console.log(`Mode:   ${purge ? 'PURGE base64' : 'copy into bucket'}${dryRun ? ' (dry run)' : ''}`);
  console.log('');

  if (!isCloudStorageConfigured() && process.env.ALLOW_LOCAL_RECORD_STORAGE !== 'true') {
    throw new Error(
      'Object storage is not configured. Set SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY '
      + '(see npm run storage:records), or set ALLOW_LOCAL_RECORD_STORAGE="true" to migrate to local disk.'
    );
  }

  if (purge) {
    await purgePass();
  } else {
    await copyPass();
  }
}

main()
  .then(async () => {
    await prisma.$disconnect();
    process.exit(0);
  })
  .catch(async (error) => {
    console.error('');
    console.error(`Migration failed: ${error instanceof Error ? error.message : String(error)}`);
    await prisma.$disconnect();
    process.exit(1);
  });
