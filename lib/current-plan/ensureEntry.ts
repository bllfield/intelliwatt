import { prisma } from '@/lib/db';
import { refreshUserEntryStatuses } from '@/lib/hitthejackwatt/entryLifecycle';

export type EnsureCurrentPlanEntryResult = {
  entryAwarded: boolean;
  alreadyAwarded: boolean;
};

export async function ensureCurrentPlanEntry(userId: string, houseId?: string | null) {
  const normalizedHouseId = houseId ?? null;
  const now = new Date();

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
        expiresAt: null,
        expirationReason: null,
        lastValidated: now,
      },
    });
    entryAwarded = true;
  } else {
    const nextAmount = existing.amount >= 1 ? existing.amount : 1;
    if (existing.amount >= 1) {
      alreadyAwarded = true;
    } else {
      entryAwarded = true;
    }

    await prisma.entry.update({
      where: { id: existing.id },
      data: {
        amount: nextAmount,
        status: 'ACTIVE',
        expiresAt: null,
        expirationReason: null,
        lastValidated: now,
      },
    });
  }

  await refreshUserEntryStatuses(userId);

  return { entryAwarded, alreadyAwarded };
}


