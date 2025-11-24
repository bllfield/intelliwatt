import 'dotenv/config';
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function backfillSmartMeterEntries() {
  const authorizations = await prisma.smtAuthorization.findMany({
    where: {
      archivedAt: null,
      smtStatus: {
        notIn: ['error', 'archived'],
      },
    },
    select: {
      id: true,
      userId: true,
      houseId: true,
    },
  });

  let created = 0;

  for (const auth of authorizations) {
    if (!auth.userId || !auth.houseId) continue;

    const existing = await prisma.entry.findFirst({
      where: {
        userId: auth.userId,
        type: 'smart_meter_connect',
        houseId: auth.houseId,
      },
    });

    if (existing) continue;

    await prisma.entry.create({
      data: {
        userId: auth.userId,
        type: 'smart_meter_connect',
        amount: 10,
        houseId: auth.houseId,
      },
    });

    created += 1;
  }

  return created;
}

async function backfillReferralEntries() {
  const referrals = await prisma.referral.findMany({
    select: {
      id: true,
      referredById: true,
    },
  });

  let created = 0;

  for (const referral of referrals) {
    if (!referral.referredById) continue;

    const existing = await prisma.entry.findMany({
      where: {
        userId: referral.referredById,
        type: 'referral',
      },
    });

    // We allow multiple referral entries, but ensure at least one exists.
    if (existing.length === 0) {
      await prisma.entry.create({
        data: {
          userId: referral.referredById,
          type: 'referral',
          amount: 5,
        },
      });
      created += 1;
    }
  }

  return created;
}

async function main() {
  const smtCreated = await backfillSmartMeterEntries();
  const referralCreated = await backfillReferralEntries();

  console.log(
    `Backfill complete. smart_meter_connect entries added: ${smtCreated}, referral entries added: ${referralCreated}`,
  );
}

main()
  .catch((err) => {
    console.error(err);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });

