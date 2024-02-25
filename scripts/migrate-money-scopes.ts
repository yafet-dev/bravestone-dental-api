/**
 * Backfills the two money scopes onto role rows written before they existed.
 *
 * Money visibility used to be implicit: a role either had the Billing/Finance
 * sections or it did not, and the amounts inside were shown to everyone. Access is
 * now decided by two explicit scopes — `patient_payments` and `clinic_finances` —
 * and a stored row that names neither reads, correctly, as "no money at all".
 *
 * That is the right default for a new clinic but the wrong answer for an existing
 * one: it silently took the balance and payment history away from the receptionist
 * who collects them. This script grants each role the money it is meant to have.
 *
 * Deliberately minimal. It adds the role's default money scopes and the
 * money-bearing sections that go with them, and nothing else — it will not widen a
 * role's clinical access on the way past. Rows that already name a scope are left
 * exactly as they are, so an admin's own choices are never overwritten and the
 * script is safe to run twice.
 *
 *   npm run migrate:money-scopes -- --dry-run   # report only
 *   npm run migrate:money-scopes               # apply
 */

import 'dotenv/config';
import {
  FEATURE_MONEY_SCOPE,
  MONEY_PERMISSIONS,
  defaultFeaturesForRole,
  normalizeFeatureList,
} from '../src/clinic/permissions';
import { roleLabel } from '../src/clinic/roles';
import { prisma } from '../src/db';

const moneyKeys = new Set<string>(MONEY_PERMISSIONS);

/** The grants to add to one row, or null when it needs nothing. */
function planFor(role: string, storedFeatures: string[]) {
  const stored = new Set(storedFeatures);

  // Already configured for money — under the new vocabulary, by an admin or by an
  // earlier run of this script. Leave it alone.
  if (storedFeatures.some((feature) => moneyKeys.has(feature))) {
    return null;
  }

  const defaults = defaultFeaturesForRole(role);
  const defaultScopes = defaults.filter((feature) => moneyKeys.has(feature));

  // An empty row means the role was created without any grants at all rather than
  // deliberately locked out of everything, so it is restored to its defaults.
  if (storedFeatures.length === 0) {
    return { added: defaults.filter((feature) => !stored.has(feature)), reason: 'empty row restored to defaults' };
  }

  if (defaultScopes.length === 0) {
    return null;
  }

  // The scopes, plus the money-only sections that would otherwise stay hidden.
  const sections = defaults.filter((feature) => {
    const scope = FEATURE_MONEY_SCOPE[feature as keyof typeof FEATURE_MONEY_SCOPE];
    return scope !== undefined && defaultScopes.includes(scope);
  });

  const added = [...defaultScopes, ...sections].filter((feature) => !stored.has(feature));

  return added.length ? { added, reason: 'money scopes backfilled' } : null;
}

async function main() {
  const dryRun = process.argv.includes('--dry-run');
  const rows = await prisma.clinicRole.findMany({
    orderBy: [{ organizationId: 'asc' }, { role: 'asc' }],
    select: { features: true, id: true, organizationId: true, role: true },
  });

  console.log(`Inspecting ${rows.length} stored role rows${dryRun ? ' (dry run)' : ''}.\n`);

  let changed = 0;
  let skipped = 0;

  for (const row of rows) {
    const stored = normalizeFeatureList(row.features);
    const plan = planFor(row.role, stored);

    if (!plan) {
      skipped += 1;
      continue;
    }

    const next = [...new Set([...stored, ...plan.added])].sort();
    changed += 1;

    console.log(`${row.organizationId} · ${roleLabel(row.role)}`);
    console.log(`  ${plan.reason}: +${plan.added.join(', ')}`);

    if (!dryRun) {
      await prisma.clinicRole.update({
        data: { features: next },
        where: { id: row.id },
      });
    }
  }

  console.log(`\n${changed} row${changed === 1 ? '' : 's'} ${dryRun ? 'would be' : ''} updated, ${skipped} left unchanged.`);

  if (dryRun && changed > 0) {
    console.log('Re-run without --dry-run to apply.');
  }

  await prisma.$disconnect();
}

void main().catch(async (error) => {
  console.error('Money scope migration failed:', error);
  await prisma.$disconnect();
  process.exit(1);
});
