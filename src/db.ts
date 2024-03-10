import './env';
import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '@prisma/client';

const databaseUrl = process.env.DIRECT_URL || process.env.DATABASE_URL;

if (!databaseUrl) {
  throw new Error('Missing DIRECT_URL or DATABASE_URL for Prisma.');
}

const adapter = new PrismaPg({
  // This Express API is a persistent process, so prefer Supavisor session mode
  // (DIRECT_URL, port 5432) over the serverless transaction pooler.
  connectionString: databaseUrl,
  connectionTimeoutMillis: 10_000,
  idleTimeoutMillis: 30_000,
  keepAlive: true,
  max: 5,
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
