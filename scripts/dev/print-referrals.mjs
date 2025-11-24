import 'dotenv/config';
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function main() {
  const rows = await prisma.referral.findMany({
    orderBy: { createdAt: 'desc' },
    take: 20,
  });

  console.log('Latest referrals:');
  for (const row of rows) {
    console.log({
      id: row.id,
      referredById: row.referredById,
      referredEmail: row.referredEmail,
      createdAt: row.createdAt,
    });
  }
}

main()
  .catch((err) => {
    console.error(err);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });

