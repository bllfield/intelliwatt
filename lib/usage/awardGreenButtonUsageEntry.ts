import { EntryStatus } from "@prisma/client";

import { prisma } from "@/lib/db";
import { refreshUserEntryStatuses } from "@/lib/hitthejackwatt/entryLifecycle";
import {
  buildUtcRangeForChicagoLocalDateRange,
  greenButtonUploadDateRangeFromChicagoDateKeys,
} from "@/lib/usage/greenButtonCoverage";
import { getChicagoDateKeyForTimestamp } from "@/lib/usage/greenButtonLocalSlot";
import { parseGreenButtonUploadParseSummary } from "@/lib/usage/greenButtonIngestContract";

export type GreenButtonExpirationInput = {
  createdAt: Date;
  parseMessage?: string | null;
  /** Latest persisted interval timestamp (DB aggregate fallback). */
  meterDataEnd?: Date | null;
  /** Last reading timestamp at ingest (`pipeline.latest`). */
  coverageEnd?: Date | null;
};

/**
 * Last day of meter data in the uploaded file — not upload time.
 * SMT expiration is separate (`authorizationEndDate` on the subscription).
 */
export function resolveGreenButtonExpirationAnchor(input: GreenButtonExpirationInput): Date {
  const summary = parseGreenButtonUploadParseSummary(input.parseMessage);
  const dataEndKey = summary?.dataAvailableEndDateKey;
  if (dataEndKey) {
    const range = greenButtonUploadDateRangeFromChicagoDateKeys({
      startDateKey: dataEndKey,
      endDateKey: dataEndKey,
    });
    if (range) return range.dateRangeEnd;
  }
  if (input.coverageEnd) return input.coverageEnd;
  if (input.meterDataEnd) return input.meterDataEnd;
  return input.createdAt;
}

/** Active through the end of the Chicago-local calendar day of the last file reading. */
export function resolveGreenButtonConnectionExpiresAt(anchor: Date): Date {
  const dateKey = getChicagoDateKeyForTimestamp(anchor);
  if (!dateKey) return anchor;
  const range = buildUtcRangeForChicagoLocalDateRange({ startDateKey: dateKey, endDateKey: dateKey });
  return range?.endInclusive ?? anchor;
}

export function resolveGreenButtonConnectionExpiresAtForUpload(
  input: GreenButtonExpirationInput
): Date {
  return resolveGreenButtonConnectionExpiresAt(resolveGreenButtonExpirationAnchor(input));
}

/**
 * Records the Green Button usage-entry placeholder and keeps the smart_meter_connect entry active.
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
  const parseMessage =
    args.summary && typeof args.summary === "object" ? JSON.stringify(args.summary) : null;
  const expiresAt = resolveGreenButtonConnectionExpiresAtForUpload({
    createdAt: now,
    parseMessage,
    coverageEnd: args.coverageEnd ?? null,
  });

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
