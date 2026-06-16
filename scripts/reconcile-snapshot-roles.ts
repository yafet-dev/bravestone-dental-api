// Reconciles role drift between the authoritative `users` table and the
// denormalized `clinic_workspace_states.staffUsers` JSON snapshot.
//
// For every workspace snapshot, each staffUser's role is set to the role on the
// matching `users` row (matched by email within the same organization). This
// fixes cases where a role was changed directly in the `users` table (e.g. via
// SQL) without going through the app, which writes both.
//
// Idempotent + transactional. Run from bravestone-dental-api:
//   npm run reconcile:roles
import '../src/env';
import { Client } from 'pg';

async function main() {
  const client = new Client({ connectionString: process.env.DIRECT_URL || process.env.DATABASE_URL });
  await client.connect();

  try {
    await client.query('BEGIN');

    const states = await client.query<{ id: string; organizationId: string | null; staffUsers: unknown }>(
      'SELECT id, "organizationId", "staffUsers" FROM clinic_workspace_states',
    );

    let snapshotsChanged = 0;
    let rolesChanged = 0;

    for (const state of states.rows) {
      if (!state.organizationId || !Array.isArray(state.staffUsers)) {
        continue;
      }

      const users = await client.query<{ email: string; role: string }>(
        'SELECT email, role FROM users WHERE "organizationId" = $1',
        [state.organizationId],
      );
      const roleByEmail = new Map(users.rows.map((u) => [u.email.toLowerCase(), u.role]));

      let changed = false;
      const nextStaff = (state.staffUsers as Array<Record<string, unknown>>).map((member) => {
        const email = typeof member.email === 'string' ? member.email.toLowerCase() : '';
        const authoritativeRole = roleByEmail.get(email);
        if (authoritativeRole && authoritativeRole !== member.role) {
          rolesChanged += 1;
          changed = true;
          console.log(`  ${state.organizationId}: ${member.email} "${member.role}" -> "${authoritativeRole}"`);
          return { ...member, role: authoritativeRole };
        }
        return member;
      });

      if (changed) {
        snapshotsChanged += 1;
        await client.query(
          'UPDATE clinic_workspace_states SET "staffUsers" = $1::jsonb WHERE id = $2',
          [JSON.stringify(nextStaff), state.id],
        );
      }
    }

    await client.query('COMMIT');
    console.log(`✔ Reconciled snapshot roles. snapshots changed: ${snapshotsChanged}, staff roles changed: ${rolesChanged}`);
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    await client.end();
  }
}

main().catch((error) => {
  console.error('✖ Reconcile failed (rolled back).');
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
