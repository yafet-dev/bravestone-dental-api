/**
 * Object storage for clinical images.
 *
 * Two drivers behind one interface. `supabase` is the real one: a **private**
 * bucket reached with the service-role key, which never leaves the server, and read
 * access granted per request as a short-lived signed URL. `local` writes under
 * `uploads/records` so the app runs without cloud credentials — it is a development
 * convenience, not a deployment target, because the files disappear with the host.
 *
 * Nothing here decides *who* may read an object. The caller checks that first (see
 * `clinic/patientAttachments.ts`); this module only moves bytes.
 */
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { mkdir, readFile, rm, rmdir, writeFile } from 'node:fs/promises';
import { dirname, join, normalize, resolve, sep } from 'node:path';

export const patientRecordsBucket = process.env.SUPABASE_RECORDS_BUCKET?.trim() || 'patient-records';

/** Where the local driver keeps objects. Never served statically. */
export const localRecordsRoot = resolve(process.cwd(), 'uploads', 'records');

export type StorageDriver = 'supabase' | 'local';

export type StoredObject = {
  bytes: number;
  path: string;
};

let cachedClient: SupabaseClient | null = null;

function supabaseCredentials() {
  const url = process.env.SUPABASE_URL?.trim() || '';
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY?.trim() || '';

  return url && serviceRoleKey ? { serviceRoleKey, url } : null;
}

/** Which driver is in force. Reported by the health endpoint so a misconfigured deploy is visible. */
export function storageDriver(): StorageDriver {
  return supabaseCredentials() ? 'supabase' : 'local';
}

/**
 * True when object storage is configured for real.
 *
 * Deliberately not thrown from at import time: the API must still boot without
 * storage so the rest of the workspace keeps working, and the upload endpoint can
 * answer with something a receptionist can act on.
 */
export function isCloudStorageConfigured() {
  return storageDriver() === 'supabase';
}

function requireSupabase() {
  const credentials = supabaseCredentials();

  if (!credentials) {
    throw new Error('Supabase storage is not configured.');
  }

  if (!cachedClient) {
    // No session persistence or token refresh: this client is a service-role
    // machine caller, not a signed-in user.
    cachedClient = createClient(credentials.url, credentials.serviceRoleKey, {
      auth: { autoRefreshToken: false, persistSession: false },
    });
  }

  return cachedClient;
}

/**
 * Refuses a path that could escape the bucket prefix.
 *
 * Paths are always built server-side from ids and random bytes, so this is a
 * backstop rather than the primary defence — but a traversal bug in a caller must
 * not become a filesystem read.
 */
function assertSafePath(path: string) {
  const trimmed = path.trim();

  if (!trimmed || trimmed !== path) {
    throw new Error('Storage path must not have surrounding whitespace.');
  }

  if (trimmed.startsWith('/') || trimmed.includes('..') || trimmed.includes('\\') || trimmed.includes('\0')) {
    throw new Error('Storage path is not allowed.');
  }

  return trimmed;
}

function localPathFor(path: string) {
  const absolute = resolve(localRecordsRoot, normalize(assertSafePath(path)));

  // resolve() has already collapsed any traversal; confirm we are still inside.
  if (absolute !== localRecordsRoot && !absolute.startsWith(localRecordsRoot + sep)) {
    throw new Error('Storage path escapes the records root.');
  }

  return absolute;
}

async function pruneEmptyLocalDirectories(filePath: string) {
  let directory = dirname(filePath);

  while (
    directory !== localRecordsRoot
    && directory.startsWith(localRecordsRoot + sep)
  ) {
    try {
      await rmdir(directory);
    } catch {
      // It is not empty (or another operation is using it), so none of its
      // ancestors can be pruned either.
      return;
    }

    directory = dirname(directory);
  }
}

export async function putObject(input: {
  contents: Buffer;
  contentType: string;
  path: string;
}): Promise<StoredObject> {
  const path = assertSafePath(input.path);

  if (storageDriver() === 'supabase') {
    const { error } = await requireSupabase()
      .storage
      .from(patientRecordsBucket)
      .upload(path, input.contents, {
        // Paths carry random bytes, so a collision means something is wrong and
        // overwriting would destroy a clinical image.
        contentType: input.contentType,
        upsert: false,
      });

    if (error) {
      throw new Error(`Upload to ${patientRecordsBucket} failed: ${error.message}`);
    }

    return { bytes: input.contents.length, path };
  }

  const absolute = localPathFor(path);
  await mkdir(dirname(absolute), { mode: 0o700, recursive: true });
  // Match Supabase's upsert:false behavior: even in development an improbable
  // path collision must fail rather than overwrite a clinical image.
  await writeFile(absolute, input.contents, { flag: 'wx', mode: 0o600 });

  return { bytes: input.contents.length, path };
}

export async function getObject(path: string): Promise<Buffer> {
  const safePath = assertSafePath(path);

  if (storageDriver() === 'supabase') {
    const { data, error } = await requireSupabase()
      .storage
      .from(patientRecordsBucket)
      .download(safePath);

    if (error || !data) {
      throw new Error(`Download from ${patientRecordsBucket} failed: ${error?.message || 'no data'}`);
    }

    return Buffer.from(await data.arrayBuffer());
  }

  return readFile(localPathFor(safePath));
}

/**
 * A URL the browser may fetch directly, valid for `expiresInSeconds`.
 *
 * Null on the local driver, which has no signing: the caller falls back to
 * streaming the bytes through the API.
 */
export async function createSignedUrl(path: string, expiresInSeconds = 120): Promise<string | null> {
  const safePath = assertSafePath(path);

  if (storageDriver() !== 'supabase') {
    return null;
  }

  const { data, error } = await requireSupabase()
    .storage
    .from(patientRecordsBucket)
    .createSignedUrl(safePath, expiresInSeconds);

  if (error || !data?.signedUrl) {
    throw new Error(`Signing ${safePath} failed: ${error?.message || 'no url'}`);
  }

  return data.signedUrl;
}

export async function removeObjects(paths: string[]) {
  const safePaths = [...new Set(paths.map(assertSafePath))];

  if (!safePaths.length) {
    return;
  }

  if (storageDriver() === 'supabase') {
    // Keep requests bounded for a clinic with a long image history.
    for (let index = 0; index < safePaths.length; index += 100) {
      const batch = safePaths.slice(index, index + 100);
      const { error } = await requireSupabase()
        .storage
        .from(patientRecordsBucket)
        .remove(batch);

      if (error) {
        throw new Error(`Removing patient-record objects failed: ${error.message}`);
      }
    }

    return;
  }

  for (const safePath of safePaths) {
    const absolute = localPathFor(safePath);
    await rm(absolute, { force: true });
    await pruneEmptyLocalDirectories(absolute);
  }
}

export async function removeObject(path: string) {
  await removeObjects([path]);
}

/**
 * Creates the bucket if it is missing, and asserts it is private.
 *
 * Called by `npm run storage:records`. Idempotent, and it re-checks `public` on an
 * existing bucket because a bucket flipped public in the dashboard would expose
 * every patient image to anyone holding a path.
 */
export async function ensurePatientRecordsBucket() {
  if (storageDriver() !== 'supabase') {
    await mkdir(localRecordsRoot, { mode: 0o700, recursive: true });
    return { bucket: localRecordsRoot, created: false, driver: 'local' as const, public: false };
  }

  const client = requireSupabase();
  const existing = await client.storage.getBucket(patientRecordsBucket);

  if (existing.data) {
    if (existing.data.public) {
      // Do not silently "fix" it: a public bucket may already have leaked, and the
      // operator needs to know rather than have it quietly toggled back.
      throw new Error(
        `Bucket "${patientRecordsBucket}" is PUBLIC. Patient images must not be world-readable. `
        + 'Set it to private in the Supabase dashboard, then re-run this command.'
      );
    }

    return { bucket: patientRecordsBucket, created: false, driver: 'supabase' as const, public: false };
  }

  const { error } = await client.storage.createBucket(patientRecordsBucket, {
    allowedMimeTypes: ['image/webp', 'image/png', 'image/jpeg'],
    fileSizeLimit: '25MB',
    public: false,
  });

  if (error) {
    throw new Error(`Could not create bucket "${patientRecordsBucket}": ${error.message}`);
  }

  return { bucket: patientRecordsBucket, created: true, driver: 'supabase' as const, public: false };
}
