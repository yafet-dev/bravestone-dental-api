import './env';
import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '@prisma/client';

// Application traffic must use DATABASE_URL. In production that points at the
// Supavisor transaction pooler (port 6543), which can share a small number of
// Postgres connections across Vercel's short-lived function instances.
// DIRECT_URL is reserved for migrations and other session-level tooling; using
// it here gives every warm function its own session connections and exhausts a
// small Supabase pool very quickly.
const isVercel = process.env.VERCEL === '1';
const databaseUrl = process.env.DATABASE_URL || (isVercel ? undefined : process.env.DIRECT_URL);

if (!databaseUrl) {
  throw new Error(isVercel
    ? 'Missing DATABASE_URL for Prisma. Vercel must use the transaction pooler URL.'
    : 'Missing DATABASE_URL or DIRECT_URL for Prisma.');
}

const adapter = new PrismaPg({
  connectionString: databaseUrl,
  connectionTimeoutMillis: 10_000,
  // A Vercel instance only needs one connection: concurrent instances share
  // the transaction pooler, and limiting each instance prevents connection
  // storms during traffic spikes and deployments.
  max: isVercel ? 1 : 5,
  idleTimeoutMillis: isVercel ? 10_000 : 30_000,
  keepAlive: true,
}, {
  onConnectionError: (error) => {
    console.error('PostgreSQL connection error:', error.message);
  },
  onPoolError: (error) => {
    console.error('PostgreSQL pool error:', error.message);
  },
});

const globalForPrisma = globalThis as unknown as {
  bravestonePrisma?: PrismaClient;
};

export const prisma = globalForPrisma.bravestonePrisma ?? new PrismaClient({
  adapter,
  transactionOptions: {
    maxWait: 10_000,
    timeout: 60_000,
  },
});

if (process.env.NODE_ENV !== 'production') {
  globalForPrisma.bravestonePrisma = prisma;
}
