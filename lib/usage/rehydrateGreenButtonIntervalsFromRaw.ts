/**
 * Re-run the canonical Green Button ingest pipeline from stored raw file bytes
 * and replace persisted interval rows (for houses uploaded before ingest v1).
 */

import { Prisma } from "@prisma/client";

import { prisma } from "@/lib/db";
import { usagePrisma } from "@/lib/db/usageClient";
import { trimGreenButtonIntervalsToLatestLocalDays } from "@/lib/usage/greenButtonCoverage";
import {
  GREEN_BUTTON_INTERVAL_INGEST_VERSION,
  isGreenButtonIntervalIngestCurrent,
} from "@/lib/usage/greenButtonIngestContract";
import { runGreenButtonUsagePipeline } from "@/lib/usage/greenButtonUsagePipeline";

const USAGE_DB_ENABLED = Boolean((process.env.USAGE_DATABASE_URL ?? "").trim());

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
      select: { id: true },
    });
    rawId = latest?.id ?? null;
  }
  if (!rawId) return { ok: false, error: "missing_raw_green_button" };

  const raw = await usageClient.rawGreenButton.findUnique({
    where: { id: rawId },
    select: { id: true, homeId: true, userId: true, filename: true, content: true },
  });
  if (!raw?.content) return { ok: false, error: "raw_content_missing" };

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
  await usageClient.greenButtonInterval.deleteMany({ where: { homeId: houseId, rawId } });
  const intervalData = trimmed.map((interval) => ({
    rawId,
    homeId: houseId,
    userId,
    timestamp: interval.timestamp,
    consumptionKwh: new Prisma.Decimal(interval.consumptionKwh),
    intervalMinutes: interval.intervalMinutes,
  }));

  const BATCH_SIZE = 4000;
  for (let i = 0; i < intervalData.length; i += BATCH_SIZE) {
    const slice = intervalData.slice(i, i + BATCH_SIZE);
    if (slice.length === 0) continue;
    await usageClient.greenButtonInterval.createMany({ data: slice });
  }

  const uploads = await (prisma as any).greenButtonUpload.findMany({
    where: { houseId: houseId },
    select: { id: true, parseMessage: true },
    orderBy: { createdAt: "desc" },
    take: 5,
  });
  for (const upload of uploads ?? []) {
    if (!isGreenButtonIntervalIngestCurrent(upload.parseMessage)) {
      await (prisma as any).greenButtonUpload.update({
        where: { id: upload.id },
        data: {
          parseMessage: JSON.stringify(pipeline.summary),
          parseStatus: pipeline.parsed.warnings.length > 0 ? "complete_with_warnings" : "complete",
          intervalMinutes: 15,
          dateRangeStart: pipeline.earliest,
          dateRangeEnd: pipeline.latest,
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
