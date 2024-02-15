import type { Prisma } from '@prisma/client';

/**
 * Serializes password, session-version, MFA-enrollment, and MFA-challenge
 * changes for one account. Every security-sensitive transaction takes this row
 * lock before touching dependent token or credential rows, which keeps attempt
 * budgets and invalidation decisions atomic across API instances.
 */
export async function lockUserSecurityState(
  transaction: Prisma.TransactionClient,
  userId: string,
) {
  const rows = await transaction.$queryRaw<Array<{ id: string }>>`
    SELECT "id"
    FROM "users"
    WHERE "id" = ${userId}
    FOR UPDATE
  `;

  return rows.length === 1;
}
