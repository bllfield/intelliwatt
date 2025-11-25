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

