/**
 * Brings stored role grants in line with the three-role clinic.
 *
 * Two things changed in the code that a workspace saved earlier cannot know
 * about:
 *
 *  1. Cashier and Accountant were removed. A clinic configured before that keeps
 *     rows for them in `roles` and `rolePermissions`. Nobody can be given those
 *     roles any more, so the rows are dead weight that the access grid would
 *     otherwise still draw.
 *  2. The receptionist absorbed both jobs and now sees clinic finances by
 *     default. A stored grant beats the default — that is what makes an admin's
 *     ticking stick — so without this the front desk would keep the narrower
 *     access it was saved with and the merge would silently not have happened.
 *
 * Deliberately surgical. It adds exactly the three grants the receptionist
 * gained and removes exactly the rows for roles nobody holds. It never widens
 * clinical access, never touches a role a staff member still has, and is safe to
 * run twice.
 *
 *   npm run migrate:clinic-roles -- --dry-run   # report only
 *   npm run migrate:clinic-roles               # apply
 */

import 'dotenv/config';
import {
  CLINIC_FINANCES_PERMISSION,
  isAssignableClinicRole,
  normalizeFeatureList,
} from '../src/clinic/permissions';
import { roleLabel, roleSlug } from '../src/clinic/roles';
import { prisma } from '../src/db';

/**
 * What the receptionist gained when cashier and accountant merged into it.
 *
 * Written out rather than diffed against the previous default, because that
 * default no longer exists in the code to diff against. Adding only these three
 * leaves anything an admin revoked from the front desk revoked.
 */
const RECEPTIONIST_ADDED_GRANTS = ['finance', 'reports', CLINIC_FINANCES_PERMISSION];

type RoleEntry = { role?: unknown };

function entryRole(entry: unknown) {
  return entry && typeof entry === 'object'
    ? roleSlug(String((entry as RoleEntry).role ?? ''))
    : '';
}

async function main() {
  const dryRun = process.argv.includes('--dry-run');

  const workspaces = await prisma.clinicWorkspaceState.findMany({
    orderBy: { organizationId: 'asc' },
    select: {
      id: true,
      organizationId: true,
      rolePermissions: true,
      roles: true,
      staffUsers: true,
    },
  });

  console.log(`Inspecting ${workspaces.length} workspace${workspaces.length === 1 ? '' : 's'}${dryRun ? ' (dry run)' : ''}.\n`);

  let workspacesChanged = 0;
  let rowsDropped = 0;
  let grantsAdded = 0;

  for (const workspace of workspaces) {
    const staffUsers = Array.isArray(workspace.staffUsers) ? workspace.staffUsers : [];
    // A role somebody still holds is left completely alone, whatever it is.
    const heldRoles = new Set(staffUsers.map(entryRole).filter(Boolean));

    const keep = (entry: unknown) => {
      const role = entryRole(entry);
      return !role || isAssignableClinicRole(role) || heldRoles.has(role);
    };

    const storedRoles = Array.isArray(workspace.roles) ? workspace.roles : [];
    const storedPermissions = Array.isArray(workspace.rolePermissions) ? workspace.rolePermissions : [];

    const nextRoles = storedRoles.filter(keep);
    const droppedRoleNames = [
      ...storedRoles.filter((entry) => !keep(entry)).map(entryRole),
      ...storedPermissions.filter((entry) => !keep(entry)).map(entryRole),
    ];

    let addedHere: string[] = [];
    const nextPermissions = storedPermissions.filter(keep).map((entry) => {
      if (entryRole(entry) !== 'receptionist') {
        return entry;
      }

      const stored = normalizeFeatureList((entry as { features?: unknown }).features);
      const missing = RECEPTIONIST_ADDED_GRANTS.filter((grant) => !stored.includes(grant));

      if (!missing.length) {
        return entry;
      }

      addedHere = missing;
      return { ...(entry as object), features: [...stored, ...missing] };
    });

    if (!droppedRoleNames.length && !addedHere.length) {
      continue;
    }

    workspacesChanged += 1;
    rowsDropped += droppedRoleNames.length;
    grantsAdded += addedHere.length;

    console.log(workspace.organizationId || '(workspace with no organization)');
    if (droppedRoleNames.length) {
      const names = [...new Set(droppedRoleNames)].map(roleLabel).join(', ');
      console.log(`  removed role rows: ${names}`);
    }
    if (addedHere.length) {
      console.log(`  ${roleLabel('receptionist')} granted: +${addedHere.join(', ')}`);
    }

    if (dryRun) {
      continue;
    }

    const organizationId = workspace.organizationId;

    await prisma.$transaction(async (transaction) => {
      await transaction.clinicWorkspaceState.update({
        data: { rolePermissions: nextPermissions, roles: nextRoles },
        where: { id: workspace.id },
      });

      // `clinic_roles` is rebuilt from the workspace on the next save, but it is
      // read before then, so it is brought along here rather than left stale. A
      // workspace with no organization has no rows there to bring along.
      if (!organizationId) {
        return;
      }

      const retired = [...new Set(droppedRoleNames)].filter(Boolean);
      if (retired.length) {
        await transaction.clinicRole.deleteMany({
          where: { organizationId, role: { in: retired } },
        });
      }

      if (addedHere.length) {
        const receptionistRow = await transaction.clinicRole.findFirst({
          select: { features: true, id: true },
          where: { organizationId, role: 'receptionist' },
        });

        if (receptionistRow) {
          const stored = normalizeFeatureList(receptionistRow.features);
          await transaction.clinicRole.update({
            data: { features: [...new Set([...stored, ...RECEPTIONIST_ADDED_GRANTS])] },
            where: { id: receptionistRow.id },
          });
        }
      }
    });
  }

  console.log(
    `\n${workspacesChanged} workspace${workspacesChanged === 1 ? '' : 's'} ${dryRun ? 'would be ' : ''}updated`
    + ` · ${rowsDropped} retired role row${rowsDropped === 1 ? '' : 's'} removed`
    + ` · ${grantsAdded} receptionist grant${grantsAdded === 1 ? '' : 's'} added.`
  );

  if (dryRun && workspacesChanged > 0) {
    console.log('Re-run without --dry-run to apply.');
  }

  await prisma.$disconnect();
}

void main().catch(async (error) => {
  console.error('Clinic role consolidation failed:', error);
  await prisma.$disconnect();
  process.exit(1);
});
