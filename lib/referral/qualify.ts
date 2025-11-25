import { prisma } from '@/lib/db';

export async function qualifyReferralsForUser(userId: string) {
  await prisma.$transaction(async (tx) => {
    const client = tx as any;
    const pendingReferrals = await client.referral.findMany({
      where: {
        referredUserId: userId,
        status: 'PENDING',
      },
      include: {
        entry: true,
      },
      orderBy: {
        createdAt: 'asc',
      },
    });

    if (pendingReferrals.length === 0) {
      return;
    }

    const now = new Date();

    for (const referral of pendingReferrals) {
      let entryRecord = referral.entry;

      if (!entryRecord) {
        entryRecord = await client.entry.findFirst({
          where: { referralId: referral.id },
        });
      }

      if (!entryRecord) {
        const entry = await client.entry.create({
          data: {
            userId: referral.referredById,
            type: 'referral',
            amount: 1,
            referralId: referral.id,
            lastValidated: now,
          } as any,
        });
        entryRecord = entry;
      }

      await client.referral.update({
        where: { id: referral.id },
        data: {
          status: 'QUALIFIED',
          qualifiedAt: referral.qualifiedAt ?? now,
          entryAwardedAt: referral.entryAwardedAt ?? now,
        },
      });
    }
  });
}

export async function recalculateAllReferrals() {
  const prismaAny = prisma as any;
  const referrals = await prismaAny.referral.findMany({
    include: {
      entry: true,
    },
  });

  let promoted = 0;
  let demoted = 0;
  let entriesRemoved = 0;

  for (const referral of referrals) {
    const referredUserId = referral.referredUserId ?? null;

    let qualifies = false;
    if (referredUserId) {
      const qualifyingEntry = await prismaAny.entry.findFirst({
        where: {
          userId: referredUserId,
          type: 'smart_meter_connect',
          status: { in: ['ACTIVE', 'EXPIRING_SOON'] },
        },
      });

      qualifies = Boolean(qualifyingEntry);
    }

    if (qualifies) {
      await qualifyReferralsForUser(referredUserId!);
      if (referral.status !== 'QUALIFIED') {
        promoted += 1;
      }
    } else {
      if (referral.entry) {
        await prismaAny.entry.delete({
          where: { id: referral.entry.id },
        });
        entriesRemoved += 1;
      }

      if (
        referral.status !== 'PENDING' ||
        referral.qualifiedAt !== null ||
        referral.entryAwardedAt !== null
      ) {
        await prismaAny.referral.update({
          where: { id: referral.id },
          data: {
            status: 'PENDING',
            qualifiedAt: null,
            entryAwardedAt: null,
          },
        });
        demoted += 1;
      }
    }
  }

  return {
    totalReferrals: referrals.length,
    promoted,
    demoted,
    entriesRemoved,
  };
}

