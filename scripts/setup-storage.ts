// Creates/updates the "avatars" Storage bucket and its RLS policies by running
// supabase/avatars-bucket.sql against the project's Postgres (DIRECT_URL).
//
// Run from bravestone-dental-api:  npm run setup:storage
import '../src/env';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { Client } from 'pg';

async function main() {
  const connectionString = process.env.DIRECT_URL || process.env.DATABASE_URL;

  if (!connectionString) {
    throw new Error('Missing DIRECT_URL (or DATABASE_URL) in backend.env.');
  }

  const sqlPath = resolve(process.cwd(), 'supabase/avatars-bucket.sql');
  const sql = readFileSync(sqlPath, 'utf8');

  const client = new Client({ connectionString });
  await client.connect();

  try {
    await client.query(sql);
    console.log('✔ "avatars" Storage bucket and policies are set up.');
  } finally {
    await client.end();
  }
}

main().catch((error) => {
  console.error('✖ Failed to set up the avatars bucket.');
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
