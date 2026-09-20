import '../src/env';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import pg from 'pg';

async function main() {
  const client = new pg.Client({ connectionString: process.env.DIRECT_URL || process.env.DATABASE_URL, connectionTimeoutMillis: 10000 });
  try {
    await client.connect();
    await client.query('BEGIN');
    await client.query(readFileSync(resolve('supabase/contact-messages.sql'), 'utf8'));
    await client.query('COMMIT');
    console.log('Contact messages table is ready with row level security enabled.');
  } finally {
    await client.end();
  }
}
main().catch(() => { console.error('Contact table setup failed. Check the database connection and migration permissions.'); process.exitCode = 1; });
