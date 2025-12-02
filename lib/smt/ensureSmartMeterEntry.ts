import { EntryStatus } from '@prisma/client';

import { prisma } from '@/lib/db';
import { refreshUserEntryStatuses } from '@/lib/hitthejackwatt/entryLifecycle';

type EnsureSmartMeterEntryResult = {
  entryId: string;
  entryAwarded: boolean;
  statusLogCreated: boolean;
};

export async function ensureSmartMeterEntry(
  userId: string,
  houseId: string | null,
  now: Date,
): Promise<EnsureSmartMeterEntryResult> {
  const normalizedHouseId = houseId ?? null;

  const existing = await prisma.entry.findFirst({
    where: {
      userId,
      type: 'smart_meter_connect',
      houseId: normalizedHouseId,
    },
    select: {
      id: true,
      amount: true,
      status: true,
    },
  });

  let entryId: string;
  let entryAwarded = false;
  let statusLogCreated = false;

  if (!existing) {
    const created = await prisma.entry.create({
      data: {
        userId,
        houseId: normalizedHouseId,
        type: 'smart_meter_connect',
        amount: 1,
        status: EntryStatus.ACTIVE,
        lastValidated: now,
      },
    });
    entryId = created.id;
    entryAwarded = true;

    await prisma.entryStatusLog.create({
      data: {
        entryId,
        previous: null,
        next: EntryStatus.ACTIVE,
        reason: 'smt_email_approved',
      },
    });
    statusLogCreated = true;
  } else {
    entryId = existing.id;
    const updateData: {
      amount?: number;
      status?: EntryStatus;
      expiresAt?: Date | null;
      expirationReason?: string | null;
      lastValidated?: Date;
    } = {
      status: EntryStatus.ACTIVE,
      expiresAt: null,
      expirationReason: null,
      lastValidated: now,
    };

    if (existing.amount < 1) {
      updateData.amount = 1;
      entryAwarded = true;
    }

    await prisma.entry.update({
      where: { id: entryId },
      data: updateData,
    });

    await prisma.entryStatusLog.create({
      data: {
        entryId,
        previous: existing.status as EntryStatus,
        next: EntryStatus.ACTIVE,
        reason: 'smt_email_approved',
      },
    });
    statusLogCreated = true;
  }

  await refreshUserEntryStatuses(userId);

  return { entryId, entryAwarded, statusLogCreated };
}


