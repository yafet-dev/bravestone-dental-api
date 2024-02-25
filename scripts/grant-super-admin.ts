/**
 * Grants or revokes platform super-admin standing.
 *
 *   npm run grant:super-admin -- someone@example.com          # promote
 *   npm run grant:super-admin -- someone@example.com --revoke # demote to clinic_admin
 *   npm run grant:super-admin -- --list                       # show current platform admins
 *
 * The `super_admin` role on the user row is the ONLY thing that opens the platform
 * console and the /api/admin routes, so this script is the way in.
 */
import '../src/env';
// admin/service and clinic/service import each other; admin/service must load first.
import '../src/admin/service';
import { prisma } from '../src/db';

const demotedRole = 'clinic_admin';

async function listPlatformAdmins() {
  const admins = await prisma.user.findMany({
    where: { role: { in: ['super_admin', 'platform_admin'] } },
    orderBy: { email: 'asc' },
    select: { email: true, emailVerifiedAt: true, passwordHash: true, role: true, status: true },
  });

  if (!admins.length) {
    console.log('No accounts currently hold a platform-admin role.');
    return;
  }

  console.log(`${admins.length} platform admin account(s):`);
  admins.forEach((admin) => {
    const notes = [
      admin.status,
      admin.passwordHash ? 'password set' : 'NO PASSWORD — must use "Forgot password?"',
      admin.emailVerifiedAt ? 'verified' : 'NOT VERIFIED',
    ].join(', ');
    console.log(`  ${admin.email}  (${admin.role}; ${notes})`);
  });
}

async function main() {
  const args = process.argv.slice(2);

  if (args.includes('--list')) {
    await listPlatformAdmins();
    return;
  }

  const revoke = args.includes('--revoke');
  const email = args.find((arg) => !arg.startsWith('--'))?.trim().toLowerCase();

  if (!email) {
    console.error('Usage: npm run grant:super-admin -- <email> [--revoke]');
    console.error('       npm run grant:super-admin -- --list');
    process.exitCode = 1;
    return;
  }

  const user = await prisma.user.findUnique({ where: { email } });

  if (!user) {
    console.error(`No account exists for ${email}.`);
    console.error('Register the account first, then run this again to promote it.');
    process.exitCode = 1;
    return;
  }

  const nextRole = revoke ? demotedRole : 'super_admin';

  if (user.role === nextRole) {
    console.log(`${email} already has the role "${nextRole}". Nothing to do.`);
    return;
  }

  await prisma.user.update({ where: { id: user.id }, data: { role: nextRole } });

  console.log(`${email}: ${user.role} -> ${nextRole}`);

  if (!revoke) {
    if (!user.passwordHash) {
      console.log('\nThis account has no password yet. Use "Forgot password?" on the login page');
      console.log('to set one — the reset email is sent through the configured SMTP relay.');
    } else if (!user.emailVerifiedAt) {
      console.log('\nThis account is not email-verified yet, so sign-in will be refused until it is.');
      console.log('Use "Resend verification email" on the login page.');
    }

    console.log('\nSign out and back in for the new role to take effect (the session carries the old role).');
  }
}

main().finally(async () => {
  await prisma.$disconnect();
  process.exit(process.exitCode ?? 0);
});
