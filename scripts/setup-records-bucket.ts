/**
 * Prepares the private bucket that holds patient record images.
 *
 * Run from bravestone-dental-api:  npm run storage:records
 *
 * Safe to run repeatedly. Creates the bucket if missing, and refuses to continue if
 * an existing bucket is public — patient images must never be world-readable, and a
 * bucket flipped public in the dashboard needs a human to look at it rather than
 * being quietly toggled back.
 *
 * Not to be confused with `setup-storage.ts`, which set up the old Supabase "avatars"
 * bucket. Avatars are stored on the API host now, so that script is legacy.
 */
import '../src/env';
import { ensurePatientRecordsBucket, storageDriver } from '../src/storage/bucket';

async function main() {
  if (storageDriver() === 'local') {
    console.log('Storage driver: local (development only)');
    console.log('');
    console.log('SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are not set, so patient images would');
    console.log('be written to ./uploads/records on this machine. Those files are lost when the');
    console.log('host restarts, so uploads are refused outright unless you also set');
    console.log('ALLOW_LOCAL_RECORD_STORAGE="true".');
    console.log('');
    console.log('To use Supabase Storage, add to backend.env:');
    console.log('  SUPABASE_URL="https://<project-ref>.supabase.co"');
    console.log('  SUPABASE_SERVICE_ROLE_KEY="<service_role secret>"');
    console.log('');
    console.log('Both are in the Supabase dashboard under Project Settings -> API.');
    console.log('The service_role key bypasses row-level security. Keep it server-side only,');
    console.log('never in a VITE_ variable, and never commit it.');
  }

  const result = await ensurePatientRecordsBucket();

  console.log('');
  console.log(`Driver:  ${result.driver}`);
  console.log(`Bucket:  ${result.bucket}`);
  console.log(`Public:  ${result.public ? 'YES - THIS IS WRONG' : 'no (correct)'}`);
  console.log(`Created: ${result.created ? 'just now' : 'already existed'}`);

  if (result.driver === 'supabase') {
    console.log('');
    console.log('The bucket is private, and it needs no row-level-security policies: the API');
    console.log('reads and writes with the service-role key. After an authenticated clinic check,');
    console.log('the browser receives a signed read URL that expires after 120 seconds.');
  }
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error('');
    console.error(`Could not prepare the records bucket: ${error instanceof Error ? error.message : String(error)}`);
    process.exit(1);
  });
