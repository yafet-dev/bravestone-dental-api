import './env';
import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '@prisma/client';

const databaseUrl = process.env.DATABASE_URL || process.env.DIRECT_URL;

if (!databaseUrl) {
  throw new Error('Missing DIRECT_URL or DATABASE_URL for Prisma.');
}

const adapter = new PrismaPg({
  // Prefer the pooled runtime URL; Prisma CLI commands already use DIRECT_URL via prisma.config.ts.
  connectionString: databaseUrl,
});

const globalForPrisma = globalThis as unknown as {
  bravestonePrisma?: PrismaClient;
};

export const prisma = globalForPrisma.bravestonePrisma ?? new PrismaClient({ adapter });

if (process.env.NODE_ENV !== 'production') {
  globalForPrisma.bravestonePrisma = prisma;
}
