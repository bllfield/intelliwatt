/**
 * Re-run the canonical Green Button ingest pipeline from stored raw file bytes
 * and replace persisted interval rows (for houses uploaded before ingest v1).
 */

import { Prisma } from "@prisma/client";

import { prisma } from "@/lib/db";
import { usagePrisma } from "@/lib/db/usageClient";
import { resolveGreenButtonUploadRecordDateRange } from "@/lib/usage/greenButtonCoverage";
import {
  GREEN_BUTTON_INTERVAL_INGEST_VERSION,
  isGreenButtonIntervalIngestCurrent,
} from "@/lib/usage/greenButtonIngestContract";
import { createManyGreenButtonIntervalsInBatches } from "@/lib/usage/greenButtonIntervalPersist";
import { runGreenButtonUsagePipeline } from "@/lib/usage/greenButtonUsagePipeline";

const USAGE_DB_ENABLED = Boolean((process.env.USAGE_DATABASE_URL ?? "").trim());

/** Year-scale GB XML ingest exceeds Vercel one-path-sim maxDuration (~300s). */
export const GREEN_BUTTON_REHYDRATE_RAW_MAX_BYTES_ON_VERCEL = 3 * 1024 * 1024;

export function isGreenButtonRehydrateBlockedOnVercel(sizeBytes: number): boolean {
  return process.env.VERCEL === "1" && sizeBytes > GREEN_BUTTON_REHYDRATE_RAW_MAX_BYTES_ON_VERCEL;
}

export function greenButtonRehydrateUserMessage(error: string): string {
  switch (error) {
    case "raw_too_large_for_vercel_rehydrate":
      return (
        "This Green Button raw file is too large to rehydrate on Vercel (full-year ingest can take several minutes). " +
        "Re-upload at uploads.intelliwatt.com so the droplet runs ingest, then retry One Path without “Rehydrate from raw”."
      );
    case "usage_db_disabled":
      return "Usage database is not configured; cannot rehydrate Green Button intervals.";
    case "missing_raw_green_button":
      return "No stored Green Button raw file for this home.";
    case "raw_content_missing":
      return "Stored Green Button raw file has no content.";
    default:
      return error;
  }
}

export type RehydrateGreenButtonIntervalsResult =
  | {
      ok: true;
      intervalsWritten: number;
      intervalIngestVersion: number;
      coverageStartDateKey: string;
      coverageEndDateKey: string;
    }
  | { ok: false; error: string };

export async function rehydrateGreenButtonIntervalsFromRawForHouse(args: {
  houseId: string;
  rawId?: string | null;
  userId?: string | null;
  windowDays?: number;
}): Promise<RehydrateGreenButtonIntervalsResult> {
  if (!USAGE_DB_ENABLED) {
    return { ok: false, error: "usage_db_disabled" };
  }

  const houseId = String(args.houseId ?? "").trim();
  if (!houseId) return { ok: false, error: "missing_houseId" };

  const usageClient = usagePrisma as any;
  let rawId = typeof args.rawId === "string" && args.rawId.trim() ? args.rawId.trim() : null;
  if (!rawId) {
    const latest = await usageClient.rawGreenButton.findFirst({
      where: { homeId: houseId },
      orderBy: { createdAt: "desc" },
      select: { id: true, sizeBytes: true },
    });
    if (latest?.id && isGreenButtonRehydrateBlockedOnVercel(latest.sizeBytes ?? 0)) {
      return { ok: false, error: "raw_too_large_for_vercel_rehydrate" };
    }
    rawId = latest?.id ?? null;
  }
  if (!rawId) return { ok: false, error: "missing_raw_green_button" };

  const raw = await usageClient.rawGreenButton.findUnique({
    where: { id: rawId },
    select: { id: true, homeId: true, userId: true, filename: true, sizeBytes: true, content: true },
  });
  if (!raw) return { ok: false, error: "missing_raw_green_button" };
  if (isGreenButtonRehydrateBlockedOnVercel(raw.sizeBytes ?? 0)) {
    return { ok: false, error: "raw_too_large_for_vercel_rehydrate" };
  }
  if (!raw.content) return { ok: false, error: "raw_content_missing" };

  const pipeline = runGreenButtonUsagePipeline({
    buffer: Buffer.isBuffer(raw.content) ? raw.content : Buffer.from(raw.content),
    filename: raw.filename ?? null,
    windowDays: args.windowDays ?? 365,
  });
  if (!pipeline.ok) {
    return { ok: false, error: pipeline.error };
  }

  const userId =
    args.userId?.trim() ||
    (await prisma.houseAddress.findUnique({ where: { id: houseId }, select: { userId: true } }))?.userId ||
    raw.userId;
  if (!userId) return { ok: false, error: "missing_userId" };

  const { trimmed, startDateKey, endDateKey } = pipeline;
  await usageClient.greenButtonInterval.deleteMany({ where: { rawId } });
  const intervalData = trimmed.map((interval) => ({
    rawId,
    homeId: houseId,
    userId,
    timestamp: interval.timestamp,
    consumptionKwh: new Prisma.Decimal(interval.consumptionKwh),
    intervalMinutes: interval.intervalMinutes,
  }));

  await createManyGreenButtonIntervalsInBatches(usageClient, intervalData);

  const uploads = await (prisma as any).greenButtonUpload.findMany({
    where: { houseId: houseId },
    select: { id: true, parseMessage: true },
    orderBy: { createdAt: "desc" },
    take: 5,
  });
  const uploadDateRange = resolveGreenButtonUploadRecordDateRange({
    endDateKey: pipeline.endDateKey,
    windowDays: pipeline.summary.appliedWindowDays,
    fallbackStart: pipeline.earliest,
    fallbackEnd: pipeline.latest,
  });
  for (const upload of uploads ?? []) {
    if (!isGreenButtonIntervalIngestCurrent(upload.parseMessage)) {
      await (prisma as any).greenButtonUpload.update({
        where: { id: upload.id },
        data: {
          parseMessage: JSON.stringify(pipeline.summary),
          parseStatus: pipeline.parsed.warnings.length > 0 ? "complete_with_warnings" : "complete",
          intervalMinutes: 15,
          dateRangeStart: uploadDateRange?.dateRangeStart ?? pipeline.earliest,
          dateRangeEnd: uploadDateRange?.dateRangeEnd ?? pipeline.latest,
        },
      });
      break;
    }
  }

  return {
    ok: true,
    intervalsWritten: trimmed.length,
    intervalIngestVersion: GREEN_BUTTON_INTERVAL_INGEST_VERSION,
    coverageStartDateKey: startDateKey,
    coverageEndDateKey: endDateKey,
  };
}
