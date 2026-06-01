import { EntryStatus } from "@prisma/client";

import { prisma } from "@/lib/db";
import { refreshUserEntryStatuses } from "@/lib/hitthejackwatt/entryLifecycle";

/** Green Button uploads stay active for one year from ingest time. */
export function resolveGreenButtonConnectionExpiresAt(anchor: Date = new Date()): Date {
  const expiresAt = new Date(anchor.getTime());
  expiresAt.setFullYear(expiresAt.getFullYear() + 1);
  return expiresAt;
}

/**
 * Records the 12-month Green Button usage-entry placeholder and keeps the smart_meter_connect entry active.
 */
export async function awardGreenButtonUsageEntry(args: {
  userId: string;
  houseId: string;
  uploadId: string;
  rawGreenButtonId: string;
  utilityName?: string | null;
  accountNumber?: string | null;
  summary?: Record<string, unknown> | null;
  coverageEnd?: Date | null;
}): Promise<{ manualUsageId: string }> {
  const now = new Date();
  const expiresAt = resolveGreenButtonConnectionExpiresAt(now);

  await (prisma as any).manualUsageUpload
    .deleteMany({ where: { houseId: args.houseId, source: "green_button" } })
    .catch(() => null);

  const manualUsage = await (prisma as any).manualUsageUpload.create({
    data: {
      userId: args.userId,
      houseId: args.houseId,
      source: "green_button",
      expiresAt,
      metadata: {
        rawGreenButtonId: args.rawGreenButtonId,
        uploadId: args.uploadId,
        utilityName: args.utilityName ?? null,
        accountNumber: args.accountNumber ?? null,
        summary: args.summary ?? null,
      },
    },
    select: { id: true },
  });

  const existingEntry = await prisma.entry.findFirst({
    where: { userId: args.userId, houseId: args.houseId, type: "smart_meter_connect" },
    select: { id: true, amount: true },
  });

  if (existingEntry) {
    await prisma.entry.update({
      where: { id: existingEntry.id },
      data: {
        amount: Math.max(existingEntry.amount, 1),
        manualUsageId: manualUsage.id,
        status: EntryStatus.ACTIVE,
        expiresAt: null,
        expirationReason: null,
        lastValidated: now,
      },
    });
  } else {
    await prisma.entry.create({
      data: {
        userId: args.userId,
        houseId: args.houseId,
        type: "smart_meter_connect",
        amount: 1,
        manualUsageId: manualUsage.id,
        status: EntryStatus.ACTIVE,
        lastValidated: now,
      },
    });
  }

  await refreshUserEntryStatuses(args.userId);
  return { manualUsageId: String(manualUsage.id) };
}
