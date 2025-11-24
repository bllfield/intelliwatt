import 'dotenv/config';
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function main() {
  const rows = await prisma.entry.findMany({
    orderBy: { createdAt: 'desc' },
    take: 20,
  });

  console.log('Latest entries:');
  for (const row of rows) {
    console.log({
      id: row.id,
      userId: row.userId,
      type: row.type,
      amount: row.amount,
      houseId: row.houseId,
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

