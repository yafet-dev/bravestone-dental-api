// Converts existing staff "role" values from display strings (e.g. "Clinic Admin")
// to canonical snake_case slugs (e.g. "clinic_admin") across:
//   - users.role
//   - clinic_roles.role
//   - clinic_workspace_states JSON arrays: staffUsers[].role, roles[].role, rolePermissions[].role
//
// Idempotent (roleSlug(slug) === slug) and transactional. Run from bravestone-dental-api:
//   npm run migrate:roles
import '../src/env';
import { Client } from 'pg';
import { roleSlug } from '../src/clinic/roles';

function mapRoleArray(value: unknown) {
  if (!Array.isArray(value)) {
    return value;
  }
  return value.map((item) =>
    item && typeof item === 'object' && 'role' in item
      ? { ...(item as Record<string, unknown>), role: roleSlug((item as { role?: string }).role) }
      : item,
  );
}

async function main() {
  const connectionString = process.env.DIRECT_URL || process.env.DATABASE_URL;
  if (!connectionString) {
    throw new Error('Missing DIRECT_URL (or DATABASE_URL) in backend.env.');
  }

  const client = new Client({ connectionString });
  await client.connect();

  try {
    await client.query('BEGIN');

    // 1) users.role
    const users = await client.query<{ id: string; role: string }>('SELECT id, role FROM users');
    const conversions = new Map<string, string>();
    let userUpdates = 0;
    for (const row of users.rows) {
      const next = roleSlug(row.role);
      if (next && next !== row.role) {
        conversions.set(row.role, next);
        await client.query('UPDATE users SET role = $1 WHERE id = $2', [next, row.id]);
        userUpdates += 1;
      }
    }

    // 2) clinic_roles.role
    const clinicRoles = await client.query<{ id: string; role: string }>('SELECT id, role FROM clinic_roles');
    let clinicRoleUpdates = 0;
    for (const row of clinicRoles.rows) {
      const next = roleSlug(row.role);
      if (next && next !== row.role) {
        conversions.set(row.role, next);
        await client.query('UPDATE clinic_roles SET role = $1 WHERE id = $2', [next, row.id]);
        clinicRoleUpdates += 1;
      }
    }

    // 3) clinic_workspace_states JSON snapshots
    const states = await client.query(
      'SELECT id, "staffUsers", "roles", "rolePermissions" FROM clinic_workspace_states',
    );
    let stateUpdates = 0;
    for (const row of states.rows) {
      await client.query(
        'UPDATE clinic_workspace_states SET "staffUsers" = $1::jsonb, "roles" = $2::jsonb, "rolePermissions" = $3::jsonb WHERE id = $4',
        [
          JSON.stringify(mapRoleArray(row.staffUsers)),
          JSON.stringify(mapRoleArray(row.roles)),
          JSON.stringify(mapRoleArray(row.rolePermissions)),
          row.id,
        ],
      );
      stateUpdates += 1;
    }

    await client.query('COMMIT');

    console.log('✔ Role migration complete.');
    console.log(`  users updated:              ${userUpdates}`);
    console.log(`  clinic_roles updated:       ${clinicRoleUpdates}`);
    console.log(`  workspace states rewritten: ${stateUpdates}`);
    if (conversions.size > 0) {
      console.log('  distinct conversions:');
      for (const [from, to] of conversions) {
        console.log(`    "${from}" -> "${to}"`);
      }
    }
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    await client.end();
  }
}

main().catch((error) => {
  console.error('✖ Role migration failed (rolled back).');
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
