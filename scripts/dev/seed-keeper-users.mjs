#!/usr/bin/env node
/**
 * Re-create the keeper user accounts if they were deleted.
 *
 * Usage (PowerShell):
 *   node scripts/dev/seed-keeper-users.mjs
 *
 * The script is idempotent: it upserts each keeper email.
 */
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

const keeperEmails = [
  'omoneo@o2epcm.com',
  'cgoldstein@seia.com',
  'whill@hilltrans.com',
  'erhamilton@messer.com',
  'zander86@gmail.com',
];

async function main() {
  for (const email of keeperEmails) {
    const normalizedEmail = email.trim().toLowerCase();
    const result = await prisma.user.upsert({
      where: { email: normalizedEmail },
      update: {},
      create: { email: normalizedEmail },
    });

    console.log(`Keeper ensured: ${result.email} (id: ${result.id})`);
  }
}

main()
  .catch((error) => {
    console.error('Failed to seed keeper users:', error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });

