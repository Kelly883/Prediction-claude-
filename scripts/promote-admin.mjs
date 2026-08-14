// One-off CLI to promote an existing account to admin. There's no seeded
// admin account and no self-registration path to admin (correctly, for
// security — /api/auth/register always creates role: 'user'). This is the
// intended way to create your first admin: register a normal account
// through the app, then run this once against the same database.
//
// Usage:
//   DATABASE_URL="<your real DATABASE_URL>" node scripts/promote-admin.mjs you@example.com
//
// Requires `npx prisma generate` to have been run first (so
// node_modules/@prisma/client exists) — that already happens via the
// package.json postinstall/build script in a normal `npm install`.

import { PrismaClient } from '@prisma/client';

const email = process.argv[2];
if (!email) {
  console.error('Usage: node scripts/promote-admin.mjs <email>');
  process.exit(1);
}

const prisma = new PrismaClient();

try {
  const user = await prisma.user.update({
    where: { email },
    data: { role: 'admin' },
  });
  console.log(`✓ ${user.email} is now an admin.`);
} catch (err) {
  if (err.code === 'P2025') {
    console.error(`No user found with email ${email} — register the account first, then run this.`);
  } else {
    console.error(err);
  }
  process.exit(1);
} finally {
  await prisma.$disconnect();
}
