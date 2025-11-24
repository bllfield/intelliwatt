import 'dotenv/config';
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function main() {
  const rows = await prisma.smtAuthorization.findMany({
    orderBy: { createdAt: 'desc' },
    take: 10,
  });

  console.log('Latest SMT authorizations:');
  for (const row of rows) {
    console.log({
      id: row.id,
      userId: row.userId,
      esiid: row.esiid,
      meterNumber: row.meterNumber,
      smtStatus: row.smtStatus,
      archivedAt: row.archivedAt,
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

