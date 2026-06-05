import express, { Request, Response, NextFunction } from "express";
import multer from "multer";
import { createHash, createHmac } from "node:crypto";
import { Prisma, PrismaClient } from "@prisma/client";
import { PrismaClient as UsagePrismaClient } from "../../.prisma/usage-client";
import { XMLParser } from "fast-xml-parser";
import { awardGreenButtonUsageEntry } from "../../lib/usage/awardGreenButtonUsageEntry";
import {
  GREEN_BUTTON_INTERVAL_CREATE_BATCH_SIZE,
  GREEN_BUTTON_INTERVAL_CREATE_PARALLEL,
  createManyGreenButtonIntervalsInBatches,
} from "../../lib/usage/greenButtonIntervalPersist";
import { resolveGreenButtonUploadRecordDateRange } from "../../lib/usage/greenButtonCoverage";
import { runGreenButtonUsagePipeline } from "../../lib/usage/greenButtonUsagePipeline";
import { executeGreenButtonRehydrateFromStoredRaw } from "../../lib/usage/rehydrateGreenButtonIntervalsFromRaw";

const PORT = Number(process.env.GREEN_BUTTON_UPLOAD_PORT || "8091");
const MAX_BYTES = Number(process.env.GREEN_BUTTON_UPLOAD_MAX_BYTES || 500 * 1024 * 1024);
const SECRET = process.env.GREEN_BUTTON_UPLOAD_SECRET || "";
const ALLOW_ORIGIN = process.env.GREEN_BUTTON_UPLOAD_ALLOW_ORIGIN || "https://intelliwatt.com";
const MANUAL_USAGE_LIFETIME_DAYS = 365;

const prisma = new PrismaClient({
  log: process.env.NODE_ENV === "development" ? ["query", "error", "warn"] : ["error"],
});
const usagePrisma = new UsagePrismaClient({
  log: process.env.NODE_ENV === "development" ? ["query", "error", "warn"] : ["error"],
});

function logEvent(event: string, details?: Record<string, unknown>) {
  const payload = details ? ` ${JSON.stringify(details)}` : "";
  // eslint-disable-next-line no-console
  console.log(`[green-button-upload] ${event}${payload}`);
}

const storage = multer.memoryStorage();
const upload = multer({
  storage,
  limits: {
    fileSize: MAX_BYTES,
  },
});

const app = express();

// --- Local Green Button parser + normalizer (copied from lib to avoid TS import issues on the droplet) ---

type GreenButtonRawReading = {
  timestamp: string | number | Date;
  durationSeconds?: number | null;
  value: number | string;
  unit?: string | null;
};

type GreenButton15MinInterval = {
  timestamp: Date;
  consumptionKwh: number;
  intervalMinutes: 15;
  unit: "kWh";
};

type ParsedGreenButtonResult = {
  format: "xml" | "csv" | "json" | "unknown";
  readings: GreenButtonRawReading[];
  metadata: {
    timezoneOffsetSeconds: number | null;
    meterSerialNumber: string | null;
    sourceTitle: string | null;
    totalReadings: number;
  };
  warnings: string[];
  errors: string[];
};

const XML_PARSER_OPTIONS = {
  ignoreAttributes: false,
  removeNSPrefix: true,
  parseTagValue: false,
  parseAttributeValue: false,
  trimValues: true,
};

function stripBom(input: string): string {
  if (input.charCodeAt(0) === 0xfeff) {
    return input.slice(1);
  }
  return input;
}

function parseGreenButtonBuffer(buffer: Buffer, filename?: string | null): ParsedGreenButtonResult {
  const warnings: string[] = [];
  const errors: string[] = [];

  const content = stripBom(buffer.toString("utf8"));
  const trimmed = content.trim();
  const extension = filename?.toLowerCase().split(".").pop() ?? "";

  let format: ParsedGreenButtonResult["format"] = "unknown";
  if (extension === "xml" || trimmed.startsWith("<")) {
    format = "xml";
  } else if (extension === "csv" || trimmed.includes(",") || trimmed.includes("\n")) {
    format = "csv";
  } else if (trimmed.startsWith("{") || trimmed.startsWith("[")) {
    format = "json";
  }

  let readings: GreenButtonRawReading[] = [];
  let metadata = {
    timezoneOffsetSeconds: null as number | null,
    meterSerialNumber: null as string | null,
    sourceTitle: null as string | null,
    totalReadings: 0,
  };

  try {
    if (format === "xml") {
      const xmlResult = parseGreenButtonXml(content);
      readings = xmlResult.readings;
      metadata = {
        timezoneOffsetSeconds: xmlResult.timezoneOffsetSeconds,
        meterSerialNumber: xmlResult.meterSerialNumber,
        sourceTitle: xmlResult.sourceTitle,
        totalReadings: readings.length,
      };
      warnings.push(...xmlResult.warnings);
    } else if (format === "csv" || format === "unknown") {
      readings = parseGreenButtonCsv(content, warnings);
      metadata = {
        timezoneOffsetSeconds: null,
        meterSerialNumber: null,
        sourceTitle: filename ?? null,
        totalReadings: readings.length,
      };
    } else if (format === "json") {
      readings = parseGreenButtonJson(content, warnings);
      metadata = {
        timezoneOffsetSeconds: null,
        meterSerialNumber: null,
        sourceTitle: filename ?? null,
        totalReadings: readings.length,
      };
    }
  } catch (error) {
    errors.push(`Failed to parse file: ${(error as Error)?.message ?? error}`);
  }

  if (readings.length === 0) {
    warnings.push("No Green Button intervals were detected in the uploaded file.");
  }

  return {
    format,
    readings,
    metadata,
    warnings,
    errors,
  };
}

type XmlParseResult = {
  readings: GreenButtonRawReading[];
  timezoneOffsetSeconds: number | null;
  meterSerialNumber: string | null;
  sourceTitle: string | null;
  warnings: string[];
};

function parseGreenButtonXml(xml: string): XmlParseResult {
  const parser = new XMLParser(XML_PARSER_OPTIONS);
  const warnings: string[] = [];
  let root: any;

  try {
    root = parser.parse(xml);
  } catch (error) {
    throw new Error(`XML parse error: ${(error as Error)?.message ?? error}`);
  }

  const defaultReadingUnit = resolveXmlDefaultReadingUnit(root);
  const readings: GreenButtonRawReading[] = [];
  collectXmlReadings(root, readings, defaultReadingUnit);

  if (readings.length === 0) {
    warnings.push("Parsed XML successfully, but no interval readings were found.");
  }

  const timezoneOffsetSeconds = parseIntOrNull(findFirstScalar(root, "tzOffset"));
  const meterSerialNumber = findFirstScalar(root, "meterSerialNumber");
  const sourceTitle = findFirstScalar(root, "title");

  return {
    readings,
    timezoneOffsetSeconds,
    meterSerialNumber,
    sourceTitle,
    warnings,
  };
}

function resolveXmlDefaultReadingUnit(root: unknown): string | null {
  const title = findFirstScalar(root, "title");
  const readingType = findFirstNode(root, "ReadingType");
  const uom = getScalar(readingType?.uom);
  const multiplier = getScalar(readingType?.powerOfTenMultiplier);
  if (uom === "72") {
    return multiplier === "3" ? "kWh" : "Wh";
  }
  if (/\bKWH\b/i.test(String(title ?? ""))) return "kWh";
  if (/\bWH\b/i.test(String(title ?? ""))) return "Wh";
  return null;
}

function collectXmlReadings(node: unknown, out: GreenButtonRawReading[], defaultUnit: string | null) {
  if (!node) return;
  if (Array.isArray(node)) {
    for (const entry of node) {
      collectXmlReadings(entry, out, defaultUnit);
    }
    return;
  }

  if (typeof node !== "object") {
    return;
  }

  const reading = readingFromNode(node as Record<string, unknown>, defaultUnit);
  if (reading) {
    out.push(reading);
  }

  for (const value of Object.values(node as Record<string, unknown>)) {
    collectXmlReadings(value, out, defaultUnit);
  }
}

function readingFromNode(node: Record<string, unknown>, defaultUnit: string | null): GreenButtonRawReading | null {
  const start = getScalar(node.start);
  const duration = parseIntOrNull(getScalar(node.duration));
  const value = getScalar(node.value);
  const unit =
    getScalar((node as Record<string, unknown>)["@_uom"]) ??
    getScalar(node.uom) ??
    getScalar(node.unit) ??
    getScalar(node.units);

  if (start && value) {
    return {
      timestamp: start,
      durationSeconds: duration ?? undefined,
      value,
      unit: unit ?? defaultUnit,
    };
  }

  const intervalNode = getFirstObject(node.interval) ?? getFirstObject(node.timePeriod);
  if (intervalNode) {
    const intervalStart = getScalar(intervalNode.start);
    const intervalDuration = parseIntOrNull(getScalar(intervalNode.duration));
    const intervalValue =
      value ?? getScalar((node as Record<string, unknown>).readingValue) ?? getScalar(node.amount);

    if (intervalStart && intervalValue) {
      const intervalUnit =
        unit ??
        getScalar(intervalNode["@_uom"]) ??
        getScalar(intervalNode.uom) ??
        getScalar(intervalNode.unit);
      return {
        timestamp: intervalStart,
        durationSeconds: intervalDuration ?? undefined,
        value: intervalValue,
        unit: intervalUnit ?? defaultUnit,
      };
    }
  }

  return null;
}

function getFirstObject(value: unknown): Record<string, unknown> | null {
  if (!value) return null;
  if (Array.isArray(value)) {
    for (const item of value) {
      const found = getFirstObject(item);
      if (found) {
        return found;
      }
    }
    return null;
  }
  if (typeof value === "object") {
    return value as Record<string, unknown>;
  }
  return null;
}

function findFirstNode(node: unknown, key: string): Record<string, unknown> | null {
  if (!node) return null;
  if (Array.isArray(node)) {
    for (const entry of node) {
      const found = findFirstNode(entry, key);
      if (found) return found;
    }
    return null;
  }
  if (typeof node !== "object") return null;

  const record = node as Record<string, unknown>;
  if (key in record) {
    const value = record[key];
    if (value && typeof value === "object" && !Array.isArray(value)) return value as Record<string, unknown>;
    const nested = getFirstObject(value);
    if (nested) return nested;
  }
  for (const value of Object.values(record)) {
    const found = findFirstNode(value, key);
    if (found) return found;
  }
  return null;
}

function findFirstScalar(node: unknown, key: string): string | null {
  if (!node) return null;
  if (Array.isArray(node)) {
    for (const entry of node) {
      const found = findFirstScalar(entry, key);
      if (found !== null) return found;
    }
    return null;
  }
  if (typeof node !== "object") return null;

  const record = node as Record<string, unknown>;
  if (key in record) {
    const scalar = getScalar(record[key]);
    if (scalar !== null) {
      return scalar;
    }
  }

  for (const value of Object.values(record)) {
    const found = findFirstScalar(value, key);
    if (found !== null) return found;
  }

  return null;
}

function getScalar(value: unknown): string | null {
  if (value === null || value === undefined) return null;
  if (typeof value === "string" || typeof value === "number") {
    const asStr = String(value).trim();
    return asStr.length > 0 ? asStr : null;
  }
  if (typeof value === "boolean") {
    return value ? "true" : "false";
  }
  return null;
}

function parseIntOrNull(value: string | null): number | null {
  if (value === null) return null;
  const parsed = parseInt(value, 10);
  return Number.isFinite(parsed) ? parsed : null;
}

function parseFloatOrNull(value: string | null): number | null {
  if (value === null) return null;
  const parsed = parseFloat(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function parseGreenButtonCsv(csv: string, warnings: string[]): GreenButtonRawReading[] {
  const lines = csv.split(/\r?\n/).filter((line) => line.trim().length > 0);
  if (lines.length === 0) return [];

  const header = lines[0].split(/,|\t/).map((h) => h.trim().toLowerCase());
  const rows = lines.slice(1);
  const readings: GreenButtonRawReading[] = [];

  const tsIdx = header.findIndex((h) => h === "timestamp" || h === "start" || h === "datetime");
  const valueIdx = header.findIndex((h) => h === "value" || h === "kwh" || h === "consumption");
  const durIdx = header.findIndex((h) => h === "duration" || h === "durationseconds");
  const unitIdx = header.findIndex((h) => h === "unit" || h === "uom");

  for (const row of rows) {
    const cells = row.split(/,|\t/);
    const ts = tsIdx >= 0 ? cells[tsIdx]?.trim() : null;
    const val = valueIdx >= 0 ? cells[valueIdx]?.trim() : null;
    if (!ts || !val) continue;

    const durRaw = durIdx >= 0 ? cells[durIdx]?.trim() : null;
    const unit = unitIdx >= 0 ? cells[unitIdx]?.trim() : null;
    readings.push({
      timestamp: ts,
      durationSeconds: durRaw ? parseFloatOrNull(durRaw) ?? undefined : undefined,
      value: val,
      unit: unit ?? undefined,
    });
  }

  if (readings.length === 0) {
    warnings.push("CSV parsed but no usable rows were found.");
  }

  return readings;
}

function parseGreenButtonJson(json: string, warnings: string[]): GreenButtonRawReading[] {
  try {
    const data = JSON.parse(json);
    if (!Array.isArray(data)) {
      warnings.push("JSON payload is not an array; skipping.");
      return [];
    }
    const readings: GreenButtonRawReading[] = [];
    for (const row of data) {
      if (!row || typeof row !== "object") continue;
      const ts = getScalar((row as Record<string, unknown>).timestamp ?? (row as Record<string, unknown>).start);
      const val = getScalar((row as Record<string, unknown>).value ?? (row as Record<string, unknown>).kwh);
      if (!ts || !val) continue;
      const dur = parseIntOrNull(getScalar((row as Record<string, unknown>).durationSeconds ?? (row as Record<string, unknown>).duration));
      const unit = getScalar((row as Record<string, unknown>).unit ?? (row as Record<string, unknown>).uom);
      readings.push({ timestamp: ts, durationSeconds: dur ?? undefined, value: val, unit: unit ?? undefined });
    }
    if (readings.length === 0) {
      warnings.push("JSON parsed but no usable readings were found.");
    }
    return readings;
  } catch (error) {
    warnings.push(`Failed to parse JSON: ${(error as Error)?.message ?? error}`);
    return [];
  }
}

function ensureUtcDate(input: string | number | Date): Date | null {
  try {
    if (input instanceof Date) {
      return new Date(input.getTime());
    }

    if (typeof input === "number") {
      if (!Number.isFinite(input)) return null;

      if (Math.abs(input) >= 1e11) {
        return new Date(Math.trunc(input));
      } else {
        return new Date(Math.trunc(input) * 1000);
      }
    }

    if (typeof input === "string") {
      const trimmed = input.trim();
      if (!trimmed) return null;

      const isoParsed = new Date(trimmed);
      if (!isNaN(isoParsed.getTime())) {
        return isoParsed;
      }

      const maybeEpoch = Number(trimmed);
      if (Number.isFinite(maybeEpoch)) {
        return ensureUtcDate(maybeEpoch);
      }
    }

    return null;
  } catch {
    return null;
  }
}

function ensureKwh(value: number | string, unit?: string | null): number {
  let numeric = typeof value === "string" ? Number(value) : value;
  if (!Number.isFinite(numeric)) return NaN;

  const u = unit?.toLowerCase().trim();

  if (u === "wh") {
    return numeric / 1000;
  }

  if (u === "kwh") {
    return numeric;
  }

  if (Math.abs(numeric) > 100) {
    return numeric / 1000;
  }

  return numeric;
}

function roundDownTo15Minutes(d: Date): Date {
  const ms = d.getTime();
  const FIFTEEN_MIN_MS = 15 * 60 * 1000;
  const bucketMs = Math.floor(ms / FIFTEEN_MIN_MS) * FIFTEEN_MIN_MS;
  return new Date(bucketMs);
}

type GreenButtonIngestJobArgs = {
  buffer: Buffer;
  filename: string;
  mimeType: string;
  house: { id: string; userId: string; utilityName: string | null; esiid: string | null };
  utilityName: string | null;
  accountNumber: string | null;
  uploadRecordId: string;
};

async function persistRawGreenButton(args: {
  buffer: Buffer;
  house: { id: string; userId: string };
  utilityName: string | null;
  accountNumber: string | null;
  filename: string;
  mimeType: string;
}): Promise<{ rawRecordId: string; previousRawHomeId: string | null; sha256: string }> {
  const { buffer, house, utilityName, accountNumber, filename, mimeType } = args;
  const sha256 = createHash("sha256").update(buffer).digest("hex");
  const content = (() => {
    const bytes = new Uint8Array(buffer.byteLength);
    bytes.set(buffer);
    return bytes;
  })();

  let rawRecordId: string | null = null;
  let previousRawHomeId: string | null = null;

  const existing = await usagePrisma.rawGreenButton.findUnique({
    where: { sha256 },
    select: { id: true, homeId: true },
  });
  if (existing?.id) {
    rawRecordId = existing.id;
    previousRawHomeId = existing.homeId ? String(existing.homeId) : null;
    await usagePrisma.rawGreenButton.update({
      where: { id: existing.id },
      data: {
        homeId: house.id,
        userId: house.userId,
        utilityName,
        accountNumber,
        filename,
        mimeType,
        sizeBytes: buffer.length,
        content,
        capturedAt: new Date(),
      },
    });
    logEvent("raw.upsert", {
      sha256,
      rawRecordId,
      reused: true,
      reboundFromHouseId: previousRawHomeId && previousRawHomeId !== house.id ? previousRawHomeId : null,
      sizeBytes: buffer.length,
    });
  } else {
    const created = await usagePrisma.rawGreenButton.create({
      data: {
        homeId: house.id,
        userId: house.userId,
        utilityName,
        accountNumber,
        filename,
        mimeType,
        sizeBytes: buffer.length,
        content,
        sha256,
        capturedAt: new Date(),
      },
      select: { id: true },
    });
    rawRecordId = created.id;
    logEvent("raw.upsert", { sha256, rawRecordId, reused: false, sizeBytes: buffer.length });
  }

  if (!rawRecordId) {
    throw new Error("Failed to persist raw Green Button record");
  }

  return { rawRecordId, previousRawHomeId, sha256 };
}

/** Runs after HTTP 202 — full reparse from upload bytes, raw persist, interval replace (off request thread). */
async function runGreenButtonIngestJob(args: GreenButtonIngestJobArgs): Promise<void> {
  const { buffer, filename, mimeType, house, utilityName, accountNumber, uploadRecordId } = args;
  let rawRecordId: string | null = null;
  let previousRawHomeId: string | null = null;
  const ingestStartedAt = Date.now();
  const stageMs: Record<string, number> = {};
  try {
    logEvent("ingest.job_start", {
      uploadRecordId,
      houseId: house.id,
      bytes: buffer.length,
      filename,
    });

    let stageStart = Date.now();
    logEvent("ingest.stage_start", { uploadRecordId, stage: "pipeline" });
    const readingsPerChunk = Number(process.env.GREEN_BUTTON_READINGS_PER_CHUNK || "5000");
    const pipelineResult = runGreenButtonUsagePipeline({
      buffer,
      filename,
      windowDays: MANUAL_USAGE_LIFETIME_DAYS,
      maxKwhPerInterval: null,
      readingsPerChunk,
      onStageComplete: (detail) => {
        logEvent("ingest.pipeline_progress", { uploadRecordId, ...detail });
      },
      onNormalizeChunkStart: (progress) => {
        logEvent("ingest.pipeline_progress", {
          uploadRecordId,
          stage: "normalize_chunk_start",
          ...progress,
        });
      },
      onNormalizeChunkComplete: (progress) => {
        logEvent("ingest.pipeline_progress", {
          uploadRecordId,
          stage: "normalize_chunk",
          ...progress,
        });
      },
      onXmlParseProgress: (detail) => {
        logEvent("ingest.pipeline_progress", {
          uploadRecordId,
          stage: "parse_xml_blocks",
          ...detail,
        });
      },
    });
    if (!pipelineResult.ok) {
      await (prisma as any).greenButtonUpload.update({
        where: { id: uploadRecordId },
        data: {
          parseStatus: pipelineResult.parseStatus,
          parseMessage: pipelineResult.message,
        },
      });
      logEvent("ingest.pipeline_failed", { uploadRecordId, error: pipelineResult.error });
      return;
    }
    const { trimmed, summary, parsed, earliest, latest, endDateKey, normalized } = pipelineResult;
    const uploadDateRange = resolveGreenButtonUploadRecordDateRange({
      endDateKey,
      windowDays: MANUAL_USAGE_LIFETIME_DAYS,
      fallbackStart: earliest,
      fallbackEnd: latest,
    });
    stageMs.pipeline = Date.now() - stageStart;
    logEvent("ingest.pipeline_anchor", {
      uploadRecordId,
      totalRawReadings: summary.totalRawReadings,
      normalizedBeforeTrim: summary.normalizedBeforeTrim ?? normalized.length,
      trimmedIntervals: trimmed.length,
      displayWindowStartDateKey: summary.displayWindowStartDateKey,
      displayWindowEndDateKey: summary.displayWindowEndDateKey,
      dataAvailableStartDateKey: summary.dataAvailableStartDateKey,
      dataAvailableEndDateKey: summary.dataAvailableEndDateKey,
      persistedCoverageStartDateKey: summary.coverageStartDateKey,
      persistedCoverageEndDateKey: summary.coverageEndDateKey,
    });
    logEvent("ingest.stage_complete", {
      uploadRecordId,
      stage: "pipeline",
      ms: stageMs.pipeline,
      intervals: trimmed.length,
    });

    stageStart = Date.now();
    logEvent("ingest.stage_start", { uploadRecordId, stage: "raw_persist" });
    const persisted = await persistRawGreenButton({
      buffer,
      house,
      utilityName,
      accountNumber,
      filename,
      mimeType,
    });
    rawRecordId = persisted.rawRecordId;
    previousRawHomeId = persisted.previousRawHomeId;
    stageMs.rawPersist = Date.now() - stageStart;
    logEvent("ingest.stage_complete", {
      uploadRecordId,
      stage: "raw_persist",
      ms: stageMs.rawPersist,
      rawRecordId,
      sha256: persisted.sha256,
    });

    const storageKey = `usage:raw_green_button:${rawRecordId}`;
    await (prisma as any).greenButtonUpload.update({
      where: { id: uploadRecordId },
      data: { storageKey },
    });

    stageStart = Date.now();
    logEvent("ingest.stage_start", { uploadRecordId, stage: "cleanup_deletes" });
    await Promise.all([
      usagePrisma.greenButtonInterval.deleteMany({ where: { homeId: house.id, rawId: { not: rawRecordId } } }),
      usagePrisma.rawGreenButton.deleteMany({ where: { homeId: house.id, NOT: { id: rawRecordId } } }),
      (prisma as any).greenButtonUpload.deleteMany({ where: { houseId: house.id, NOT: { id: uploadRecordId } } }),
    ]);
    if (previousRawHomeId && previousRawHomeId !== house.id) {
      await Promise.all([
        usagePrisma.greenButtonInterval.deleteMany({
          where: { homeId: previousRawHomeId, rawId: rawRecordId },
        }),
        (prisma as any).greenButtonUpload.deleteMany({
          where: { houseId: previousRawHomeId, storageKey },
        }),
      ]);
    }
    await usagePrisma.greenButtonInterval.deleteMany({ where: { rawId: rawRecordId } });
    stageMs.cleanupDeletes = Date.now() - stageStart;

    const intervalData = trimmed.map((interval) => ({
      rawId: rawRecordId,
      homeId: house.id,
      userId: house.userId,
      timestamp: interval.timestamp,
      consumptionKwh: new Prisma.Decimal(interval.consumptionKwh),
      intervalMinutes: interval.intervalMinutes,
    }));

    stageStart = Date.now();
    logEvent("ingest.stage_start", {
      uploadRecordId,
      stage: "interval_insert",
      rows: intervalData.length,
      batchSize: GREEN_BUTTON_INTERVAL_CREATE_BATCH_SIZE,
      parallelPerWave: GREEN_BUTTON_INTERVAL_CREATE_PARALLEL,
    });
    const insertStats = await createManyGreenButtonIntervalsInBatches(usagePrisma, intervalData, {
      onProgress: (progress) => {
        logEvent("ingest.interval_insert_progress", {
          uploadRecordId,
          ...progress,
        });
      },
    });
    stageMs.intervalInsert = Date.now() - stageStart;
    stageMs.intervalInsertBatches = insertStats.batches;
    stageMs.intervalInsertWaves = insertStats.waves;
    logEvent("ingest.stage_complete", {
      uploadRecordId,
      stage: "interval_insert",
      ms: stageMs.intervalInsert,
      batches: insertStats.batches,
      waves: insertStats.waves,
      rows: insertStats.rows,
    });

    stageStart = Date.now();
    await (prisma as any).greenButtonUpload.update({
      where: { id: uploadRecordId },
      data: {
        parseStatus: parsed.warnings.length > 0 ? "complete_with_warnings" : "complete",
        parseMessage: JSON.stringify(summary),
        dateRangeStart: uploadDateRange?.dateRangeStart ?? earliest,
        dateRangeEnd: uploadDateRange?.dateRangeEnd ?? latest,
        intervalMinutes: 15,
      },
    });

    stageMs.uploadStatusUpdate = Date.now() - stageStart;
    stageStart = Date.now();
    try {
      await awardGreenButtonUsageEntry({
        userId: house.userId,
        houseId: house.id,
        uploadId: uploadRecordId,
        rawGreenButtonId: rawRecordId,
        utilityName,
        accountNumber,
        summary,
        coverageEnd: latest,
      });
    } catch (entryErr) {
      logEvent("upload.entry_award_error", { error: String(entryErr) });
    }
    stageMs.entryAward = Date.now() - stageStart;
    stageMs.total = Date.now() - ingestStartedAt;

    logEvent("ingest.timings", {
      uploadRecordId,
      houseId: house.id,
      intervals: trimmed.length,
      ...stageMs,
    });
    logEvent("upload.success", {
      rawRecordId,
      uploadRecordId,
      intervals: trimmed.length,
      totalKwh: pipelineResult.totalKwh,
      warnings: parsed.warnings,
      ingestMs: stageMs.total,
    });
  } catch (error) {
    console.error("[green-button-upload] ingest job failed", error);
    try {
      await (prisma as any).greenButtonUpload.update({
        where: { id: uploadRecordId },
        data: {
          parseStatus: "error",
          parseMessage: String((error as Error)?.message || error),
        },
      });
    } catch (updateErr) {
      console.error("[green-button-upload] failed to mark upload error", updateErr);
    }
  }
}

// CORS + OPTIONS preflight: nginx on uploads.intelliwatt.com (deploy/droplet/nginx/uploads.intelliwatt.com).

app.get("/health", (_req: Request, res: Response) => {
  res.json({
    ok: true,
    service: "green-button-upload-server",
    maxBytes: MAX_BYTES,
    allowOrigin: ALLOW_ORIGIN,
  });
});

function verifySignature(payload: string, signature: string) {
  if (!SECRET) {
    throw new Error("Green Button upload secret is not configured");
  }
  const expected = createHmac("sha256", SECRET).update(payload).digest("hex");
  return expected === signature;
}

function base64UrlToBuffer(input: string) {
  let normalized = input.replace(/-/g, "+").replace(/_/g, "/");
  const padding = normalized.length % 4;
  if (padding === 2) {
    normalized += "==";
  } else if (padding === 3) {
    normalized += "=";
  } else if (padding !== 0) {
    throw new Error("Invalid base64url string");
  }
  return Buffer.from(normalized, "base64");
}

type UploadPayload = {
  v: number;
  userId: string;
  houseId: string;
  rawId?: string;
  issuedAt?: string;
  expiresAt?: string;
};

function decodePayload(encoded: string): UploadPayload {
  const buffer = base64UrlToBuffer(encoded);
  const json = buffer.toString("utf8");
  return JSON.parse(json) as UploadPayload;
}

async function runGreenButtonRehydrateJob(args: {
  houseId: string;
  userId: string;
  rawId?: string | null;
}) {
  let uploadRecordId: string | null = null;
  try {
    logEvent("rehydrate.job_start", {
      houseId: args.houseId,
      userId: args.userId,
      rawId: args.rawId ?? null,
    });
    const latestUpload = await (prisma as any).greenButtonUpload.findFirst({
      where: { houseId: args.houseId },
      orderBy: { createdAt: "desc" },
      select: { id: true },
    });
    uploadRecordId = latestUpload?.id ?? null;
    if (uploadRecordId) {
      await (prisma as any).greenButtonUpload.update({
        where: { id: uploadRecordId },
        data: {
          parseStatus: "processing",
          parseMessage: "rehydrate_from_raw",
        },
      });
    }

    const result = await executeGreenButtonRehydrateFromStoredRaw({
      houseId: args.houseId,
      userId: args.userId,
      rawId: args.rawId ?? null,
    });

    if (!result.ok && uploadRecordId) {
      await (prisma as any).greenButtonUpload.update({
        where: { id: uploadRecordId },
        data: {
          parseStatus: "error",
          parseMessage: result.error,
        },
      });
    }

    logEvent("rehydrate.job_complete", {
      houseId: args.houseId,
      ok: result.ok,
      error: result.ok ? undefined : result.error,
      intervalsWritten: result.ok ? result.intervalsWritten : undefined,
    });
  } catch (error) {
    console.error("[green-button-upload] rehydrate job failed", error);
    if (uploadRecordId) {
      try {
        await (prisma as any).greenButtonUpload.update({
          where: { id: uploadRecordId },
          data: {
            parseStatus: "error",
            parseMessage: String((error as Error)?.message || error),
          },
        });
      } catch (updateErr) {
        console.error("[green-button-upload] failed to mark rehydrate error", updateErr);
      }
    }
  }
}

app.post("/rehydrate", express.json({ limit: "64kb" }), async (req: Request, res: Response) => {
  try {
    if (!SECRET) {
      res.status(500).json({ ok: false, error: "server_not_configured" });
      return;
    }

    const payloadEncoded =
      typeof req.body?.payload === "string" ? req.body.payload : undefined;
    const signature =
      typeof req.body?.signature === "string" ? req.body.signature : undefined;
    if (!payloadEncoded || !signature) {
      res.status(401).json({ ok: false, error: "missing_signature" });
      return;
    }
    if (!verifySignature(payloadEncoded, signature)) {
      res.status(401).json({ ok: false, error: "invalid_signature" });
      return;
    }

    let payload: UploadPayload;
    try {
      payload = decodePayload(payloadEncoded);
    } catch (parseErr) {
      res.status(400).json({
        ok: false,
        error: "invalid_payload",
        detail: String((parseErr as Error)?.message || parseErr),
      });
      return;
    }

    if (!payload?.userId || !payload?.houseId) {
      res.status(400).json({ ok: false, error: "payload_missing_fields" });
      return;
    }

    if (payload.expiresAt) {
      const expiresMs = Date.parse(payload.expiresAt);
      if (Number.isFinite(expiresMs) && expiresMs < Date.now()) {
        res.status(401).json({ ok: false, error: "upload_ticket_expired" });
        return;
      }
    }

    const house = await prisma.houseAddress.findFirst({
      where: { id: payload.houseId, userId: payload.userId, archivedAt: null },
      select: { id: true, userId: true },
    });
    if (!house) {
      res.status(404).json({ ok: false, error: "home_not_found" });
      return;
    }

    const rawId =
      (typeof req.body?.rawId === "string" && req.body.rawId.trim()) ||
      (typeof payload.rawId === "string" && payload.rawId.trim()) ||
      null;

    void runGreenButtonRehydrateJob({
      houseId: house.id,
      userId: house.userId,
      rawId,
    });

    res.status(202).json({
      ok: true,
      accepted: true,
      processing: true,
      houseId: house.id,
      message: "Green Button rehydrate accepted; processing continues in the background.",
    });
    logEvent("rehydrate.accepted_async", { houseId: house.id, rawId });
  } catch (error) {
    console.error("[green-button-upload] failed to handle rehydrate", error);
    res.status(500).json({
      ok: false,
      error: "internal_error",
      detail: String((error as Error)?.message || error),
    });
  }
});

app.post("/upload", upload.single("file"), async (req: Request, res: Response) => {
  let uploadRecordId: string | null = null;
  try {
    logEvent("request.received", {
      contentLength: req.headers["content-length"],
      secretConfigured: Boolean(SECRET),
    });

    if (!SECRET) {
      logEvent("request.rejected", { reason: "missing_secret" });
      res.status(500).json({ ok: false, error: "server_not_configured" });
      return;
    }

    const payloadEncoded =
      (req.body?.payload as string | undefined) ||
      (typeof req.headers["x-green-button-payload"] === "string"
        ? (req.headers["x-green-button-payload"] as string)
        : undefined);
    const signature =
      (req.body?.signature as string | undefined) ||
      (typeof req.headers["x-green-button-signature"] === "string"
        ? (req.headers["x-green-button-signature"] as string)
        : undefined);

    if (!payloadEncoded || !signature) {
      logEvent("request.rejected", {
        reason: "missing_payload_or_signature",
        hasPayload: Boolean(payloadEncoded),
        hasSignature: Boolean(signature),
      });
      res.status(401).json({ ok: false, error: "missing_signature" });
      return;
    }

    if (!verifySignature(payloadEncoded, signature)) {
      logEvent("request.rejected", {
        reason: "invalid_signature",
        payloadEncodedLength: payloadEncoded.length,
        hasSignature: Boolean(signature),
      });
      res.status(401).json({ ok: false, error: "invalid_signature" });
      return;
    }

    logEvent("request.accepted", {
      payloadEncodedLength: payloadEncoded.length,
      hasSignature: Boolean(signature),
      contentLength: req.headers["content-length"],
    });

    let payload: UploadPayload;
    try {
      payload = decodePayload(payloadEncoded);
    } catch (parseErr) {
      res
        .status(400)
        .json({ ok: false, error: "invalid_payload", detail: String((parseErr as Error)?.message || parseErr) });
      return;
    }

    if (!payload?.userId || !payload?.houseId) {
      res.status(400).json({ ok: false, error: "payload_missing_fields" });
      return;
    }

    if (payload.expiresAt) {
      const expiresMs = Date.parse(payload.expiresAt);
      if (Number.isFinite(expiresMs) && expiresMs < Date.now()) {
        res.status(401).json({ ok: false, error: "upload_ticket_expired" });
        return;
      }
    }

    const file = req.file;
    if (!file || !file.buffer || file.buffer.length === 0) {
      res.status(400).json({ ok: false, error: "missing_file" });
      return;
    }

    if (file.buffer.length > MAX_BYTES) {
      res.status(413).json({ ok: false, error: "file_too_large" });
      return;
    }

    const house = await prisma.houseAddress.findFirst({
      where: { id: payload.houseId, userId: payload.userId, archivedAt: null },
      select: { id: true, userId: true, utilityName: true, esiid: true },
    });

    if (!house) {
      res.status(404).json({ ok: false, error: "home_not_found" });
      return;
    }

    const buffer = file.buffer;
    const utilityName =
      typeof req.body?.utilityName === "string" && req.body.utilityName.trim().length > 0
        ? req.body.utilityName.trim()
        : house.utilityName ?? null;
    const accountNumber =
      typeof req.body?.accountNumber === "string" && req.body.accountNumber.trim().length > 0
        ? req.body.accountNumber.trim()
        : null;
    const filename = file.originalname?.slice(0, 255) || file.fieldname || "green-button-upload.xml";
    const mimeType = file.mimetype?.slice(0, 128) || "application/xml";

    const existingUpload = await (prisma as any).greenButtonUpload.findFirst({
      where: { houseId: house.id },
      orderBy: { createdAt: "desc" },
      select: { id: true },
    });

    const pendingStorageKey = `usage:raw_green_button:processing:${existingUpload?.id ?? "new"}`;
    const baseUploadData = {
      houseId: house.id,
      utilityName,
      accountNumber,
      fileName: filename,
      fileType: mimeType,
      fileSizeBytes: buffer.length,
      storageKey: pendingStorageKey,
      parseStatus: "processing",
      parseMessage: null,
      dateRangeStart: null,
      dateRangeEnd: null,
      intervalMinutes: null,
    };

    if (existingUpload) {
      uploadRecordId = existingUpload.id;
      await (prisma as any).greenButtonUpload.update({
        where: { id: existingUpload.id },
        data: {
          ...baseUploadData,
          storageKey: `usage:raw_green_button:processing:${existingUpload.id}`,
        },
      });
    } else {
      const createdUpload = await (prisma as any).greenButtonUpload.create({
        data: baseUploadData,
      });
      uploadRecordId = createdUpload.id;
      await (prisma as any).greenButtonUpload.update({
        where: { id: createdUpload.id },
        data: { storageKey: `usage:raw_green_button:processing:${createdUpload.id}` },
      });
    }

    if (!uploadRecordId) {
      throw new Error("upload_record_missing_after_persist");
    }

    logEvent("upload.record", { uploadRecordId, houseId: house.id, fileSize: buffer.length });

    const jobArgs: GreenButtonIngestJobArgs = {
      buffer,
      filename,
      mimeType,
      house,
      utilityName,
      accountNumber,
      uploadRecordId,
    };
    void runGreenButtonIngestJob(jobArgs);

    res.status(202).json({
      ok: true,
      accepted: true,
      processing: true,
      uploadRecordId,
      message: "Green Button file accepted; processing continues in the background.",
    });
    logEvent("upload.accepted_async", { uploadRecordId, houseId: house.id });
  } catch (error) {
    console.error("[green-button-upload] failed to handle upload", error);
    if (uploadRecordId) {
      try {
        await (prisma as any).greenButtonUpload.update({
          where: { id: uploadRecordId },
          data: {
            parseStatus: "error",
            parseMessage: String((error as Error)?.message || error),
          },
        });
      } catch (updateErr) {
        console.error("[green-button-upload] failed to mark upload error", updateErr);
      }
    }
    res.status(500).json({
      ok: false,
      error: "internal_error",
      detail: String((error as Error)?.message || error),
    });
  }
});

app.use(
  (
    err: unknown,
    req: Request,
    res: Response,
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    _next: NextFunction,
  ) => {
    console.error("[green-button-upload] unhandled error", err);
    if (res.headersSent) {
      return;
    }
    res.status(500).json({
      ok: false,
      error: "internal_error",
      detail: String((err as Error)?.message || err),
    });
  },
);

app.listen(PORT, () => {
  console.log(
    `Green Button upload server listening on port ${PORT}, maxBytes=${MAX_BYTES}, allowOrigin=${ALLOW_ORIGIN}`,
  );
});


