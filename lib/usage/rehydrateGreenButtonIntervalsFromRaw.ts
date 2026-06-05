/**
 * Re-run the canonical Green Button ingest pipeline from stored raw file bytes
 * and replace persisted interval rows (for houses uploaded before ingest v1).
 *
 * Production: delegates to the droplet uploader (same host as customer uploads),
 * not Vercel serverless ingest.
 */

import { Prisma } from "@prisma/client";

import { prisma } from "@/lib/db";
import { usagePrisma } from "@/lib/db/usageClient";
import {
  requestGreenButtonRehydrateOnDroplet,
  resolveGreenButtonDropletConfig,
} from "@/lib/usage/greenButtonDropletRehydrate";
import { resolveGreenButtonUploadRecordDateRange } from "@/lib/usage/greenButtonCoverage";
import {
  GREEN_BUTTON_INTERVAL_INGEST_VERSION,
  isGreenButtonIntervalIngestCurrent,
} from "@/lib/usage/greenButtonIngestContract";
import { createManyGreenButtonIntervalsInBatches } from "@/lib/usage/greenButtonIntervalPersist";
import { GREEN_BUTTON_NORMALIZE_READINGS_PER_CHUNK } from "@/lib/usage/greenButtonNormalize";
import {
  GREEN_BUTTON_USAGE_PIPELINE_WINDOW_DAYS,
  runGreenButtonUsagePipeline,
} from "@/lib/usage/greenButtonUsagePipeline";

const USAGE_DB_ENABLED = Boolean((process.env.USAGE_DATABASE_URL ?? "").trim());

/** Legacy guard retained for local-only fallback when droplet is not configured. */
export const GREEN_BUTTON_REHYDRATE_RAW_MAX_BYTES_ON_VERCEL = 3 * 1024 * 1024;

export function isGreenButtonRehydrateBlockedOnVercel(sizeBytes: number): boolean {
  return process.env.VERCEL === "1" && sizeBytes > GREEN_BUTTON_REHYDRATE_RAW_MAX_BYTES_ON_VERCEL;
}

export function greenButtonRehydrateUserMessage(error: string): string {
  switch (error) {
    case "raw_too_large_for_vercel_rehydrate":
      return (
        "Green Button rehydrate must run on the droplet ingest host, but droplet rehydrate is not configured. " +
        "Set GREEN_BUTTON_UPLOAD_URL and GREEN_BUTTON_UPLOAD_SECRET, or re-upload at uploads.intelliwatt.com."
      );
    case "green_button_droplet_unavailable":
      return (
        "Green Button droplet rehydrate is not configured (missing GREEN_BUTTON_UPLOAD_URL/SECRET). " +
        "Re-upload at uploads.intelliwatt.com or configure the droplet uploader."
      );
    case "droplet_rehydrate_request_failed":
      return "Could not reach the Green Button droplet rehydrate endpoint. Check uploads.intelliwatt.com health.";
    case "droplet_rehydrate_failed":
      return "Green Button droplet rehydrate failed. See droplet logs or re-upload the customer file.";
    case "rehydrate_timeout":
      return (
        "Green Button rehydrate is still processing on the droplet. Wait a minute, confirm Usage shows current ingest, then retry."
      );
    case "rehydrate_parse_error":
      return "Green Button rehydrate failed while parsing the stored raw file.";
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

export async function executeGreenButtonRehydrateFromStoredRaw(args: {
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
    select: { id: true, homeId: true, userId: true, filename: true, sizeBytes: true, content: true },
  });
  if (!raw) return { ok: false, error: "missing_raw_green_button" };
  if (!raw.content) return { ok: false, error: "raw_content_missing" };

  const readingsPerChunk = Number(
    process.env.GREEN_BUTTON_READINGS_PER_CHUNK || String(GREEN_BUTTON_NORMALIZE_READINGS_PER_CHUNK)
  );
  const pipeline = runGreenButtonUsagePipeline({
    buffer: Buffer.isBuffer(raw.content) ? raw.content : Buffer.from(raw.content),
    filename: raw.filename ?? null,
    windowDays: args.windowDays ?? GREEN_BUTTON_USAGE_PIPELINE_WINDOW_DAYS,
    maxKwhPerInterval: null,
    readingsPerChunk,
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

export async function rehydrateGreenButtonIntervalsFromRawForHouse(args: {
  houseId: string;
  rawId?: string | null;
  userId?: string | null;
  windowDays?: number;
  /** When true, skip droplet delegation (droplet endpoint calls local execution). */
  executeLocally?: boolean;
  waitForDropletCompletion?: boolean;
  dropletWaitTimeoutMs?: number;
}): Promise<RehydrateGreenButtonIntervalsResult> {
  if (!USAGE_DB_ENABLED) {
    return { ok: false, error: "usage_db_disabled" };
  }

  const houseId = String(args.houseId ?? "").trim();
  if (!houseId) return { ok: false, error: "missing_houseId" };

  const dropletConfig = args.executeLocally ? null : resolveGreenButtonDropletConfig();
  if (dropletConfig) {
    const userId =
      args.userId?.trim() ||
      (await prisma.houseAddress.findUnique({ where: { id: houseId }, select: { userId: true } }))?.userId ||
      null;
    if (!userId) return { ok: false, error: "missing_userId" };

    return requestGreenButtonRehydrateOnDroplet({
      houseId,
      userId,
      rawId: args.rawId ?? null,
      config: dropletConfig,
      waitForCompletion: args.waitForDropletCompletion !== false,
      waitTimeoutMs: args.dropletWaitTimeoutMs,
    });
  }

  if (process.env.VERCEL === "1") {
    const usageClient = usagePrisma as any;
    const latest = await usageClient.rawGreenButton.findFirst({
      where: { homeId: houseId },
      orderBy: { createdAt: "desc" },
      select: { sizeBytes: true },
    });
    if (isGreenButtonRehydrateBlockedOnVercel(latest?.sizeBytes ?? 0)) {
      return { ok: false, error: "raw_too_large_for_vercel_rehydrate" };
    }
  }

  return executeGreenButtonRehydrateFromStoredRaw(args);
}
