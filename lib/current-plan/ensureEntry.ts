import { prisma } from '@/lib/db';
import { refreshUserEntryStatuses } from '@/lib/hitthejackwatt/entryLifecycle';

export type EnsureCurrentPlanEntryResult = {
  entryAwarded: boolean;
  alreadyAwarded: boolean;
};

export async function ensureCurrentPlanEntry(userId: string, houseId?: string | null) {
  const normalizedHouseId = houseId ?? null;

  const existing = await prisma.entry.findFirst({
    where: {
      userId,
      type: 'current_plan_details',
      houseId: normalizedHouseId,
    },
    select: {
      id: true,
      amount: true,
    },
  });

  let entryAwarded = false;
  let alreadyAwarded = false;

  if (!existing) {
    await prisma.entry.create({
      data: {
        userId,
        houseId: normalizedHouseId,
        type: 'current_plan_details',
        amount: 1,
        status: 'ACTIVE',
      },
    });
    entryAwarded = true;
  } else if (existing.amount >= 1) {
    alreadyAwarded = true;
  } else {
    await prisma.entry.update({
      where: { id: existing.id },
      data: { amount: 1 },
    });
    entryAwarded = true;
  }

  await refreshUserEntryStatuses(userId);

  return { entryAwarded, alreadyAwarded };
}


