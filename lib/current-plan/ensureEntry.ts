import { prisma } from '@/lib/db';
import { refreshUserEntryStatuses } from '@/lib/hitthejackwatt/entryLifecycle';

export type EnsureCurrentPlanEntryResult = {
  entryAwarded: boolean;
  alreadyAwarded: boolean;
};

export async function ensureCurrentPlanEntry(userId: string, houseId?: string | null) {
  const now = new Date();

  // Current plan details is a single 0/1 entry per user (does NOT stack by houseId).
  // Some older flows accidentally created one entry with houseId=null and another with houseId=<homeId>.
  // We always upsert into the newest entry and hard-clamp amount to 1.
  const existingAll = await prisma.entry.findMany({
    where: {
      userId,
      type: 'current_plan_details',
    },
    orderBy: { createdAt: 'desc' },
    select: { id: true, amount: true, status: true },
  });
  const canonical = existingAll[0] ?? null;

  let entryAwarded = false;
  let alreadyAwarded = false;

  if (!canonical) {
    await prisma.entry.create({
      data: {
        userId,
        houseId: houseId ?? null,
        type: 'current_plan_details',
        amount: 1,
        status: 'ACTIVE',
        expiresAt: null,
        expirationReason: null,
        lastValidated: now,
      },
    });
    entryAwarded = true;
  } else {
    // If we previously awarded, keep "alreadyAwarded" semantics, but clamp to 1.
    if ((canonical.amount ?? 0) >= 1) {
      alreadyAwarded = true;
    } else {
      entryAwarded = true;
    }

    await prisma.entry.update({
      where: { id: canonical.id },
      data: {
        amount: 1,
        status: 'ACTIVE',
        expiresAt: null,
        expirationReason: null,
        lastValidated: now,
        houseId: houseId ?? null,
      },
    });

    // Deduplicate any accidental extra rows so the Entries page never shows "2".
    const dupes = existingAll.slice(1);
    if (dupes.length > 0) {
      const dupeIds = dupes.map((d) => d.id);
      await prisma.entry.updateMany({
        where: { id: { in: dupeIds } },
        data: {
          amount: 0,
          status: 'EXPIRED',
          expiresAt: now,
          expirationReason: 'Superseded by canonical current plan entry',
          lastValidated: now,
        } as any,
      });
    }
  }

  await refreshUserEntryStatuses(userId);

  return { entryAwarded, alreadyAwarded };
}


