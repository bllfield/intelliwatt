import express, { Request, Response, NextFunction } from "express";
import multer from "multer";
import { createHash, createHmac } from "node:crypto";
import { Prisma, PrismaClient } from "@prisma/client";
import { PrismaClient as UsagePrismaClient } from "../../.prisma/usage-client";
import { XMLParser } from "fast-xml-parser";

const PORT = Number(process.env.GREEN_BUTTON_UPLOAD_PORT || "8091");
const MAX_BYTES = Number(process.env.GREEN_BUTTON_UPLOAD_MAX_BYTES || 500 * 1024 * 1024);
const SECRET = process.env.GREEN_BUTTON_UPLOAD_SECRET || "";
const ALLOW_ORIGIN = process.env.GREEN_BUTTON_UPLOAD_ALLOW_ORIGIN || "https://intelliwatt.com";

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

  const readings: GreenButtonRawReading[] = [];
  collectXmlReadings(root, readings);

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

function collectXmlReadings(node: unknown, out: GreenButtonRawReading[]) {
  if (!node) return;
  if (Array.isArray(node)) {
    for (const entry of node) {
      collectXmlReadings(entry, out);
    }
    return;
  }

  if (typeof node !== "object") {
    return;
  }

  const reading = readingFromNode(node as Record<string, unknown>);
  if (reading) {
    out.push(reading);
  }

  for (const value of Object.values(node as Record<string, unknown>)) {
    collectXmlReadings(value, out);
  }
}

function readingFromNode(node: Record<string, unknown>): GreenButtonRawReading | null {
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
      unit,
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
        unit: intervalUnit,
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

function normalizeGreenButtonReadingsTo15Min(
  rawReadings: GreenButtonRawReading[],
  options?: { treatTimestampAsEnd?: boolean; maxKwhPerInterval?: number | null },
): GreenButton15MinInterval[] {
  const treatAsEnd = options?.treatTimestampAsEnd ?? false;
  const maxKwh = options?.maxKwhPerInterval ?? null;

  const buckets = new Map<number, number>();

  for (const reading of rawReadings) {
    const ts = ensureUtcDate(reading.timestamp);
    if (!ts) continue;

    const durSecRaw = reading.durationSeconds ?? 900;
    const durationSeconds = durSecRaw > 0 ? durSecRaw : 900;

    const valueKwh = ensureKwh(reading.value, reading.unit ?? undefined);
    if (!isFinite(valueKwh) || valueKwh < 0) {
      continue;
    }

    const base = new Date(ts.getTime());
    if (treatAsEnd) {
      base.setSeconds(base.getSeconds() - durationSeconds);
    }

    const start = roundDownTo15Minutes(base);

    const intervals = Math.max(1, Math.round(durationSeconds / 900));
    const perIntervalKwh = valueKwh / intervals;

    for (let i = 0; i < intervals; i++) {
      const bucketStartMs = start.getTime() + i * 15 * 60 * 1000;
      const existing = buckets.get(bucketStartMs) ?? 0;
      buckets.set(bucketStartMs, existing + perIntervalKwh);
    }
  }

  const results: GreenButton15MinInterval[] = [];

  buckets.forEach((kwh, ms) => {
    if (!isFinite(kwh) || kwh < 0) {
      return;
    }
    if (maxKwh != null && kwh > maxKwh) {
      return;
    }

    results.push({
      timestamp: new Date(ms),
      consumptionKwh: kwh,
      intervalMinutes: 15,
      unit: "kWh",
    });
  });

  results.sort((a, b) => a.timestamp.getTime() - b.timestamp.getTime());

  return results;
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

function setCorsHeaders(res: Response, origin: string | undefined) {
  if (origin && origin === ALLOW_ORIGIN) {
    res.header("Access-Control-Allow-Origin", origin);
    res.header("Vary", "Origin");
  }
  res.header("Access-Control-Allow-Methods", "GET,POST,OPTIONS");
  res.header(
    "Access-Control-Allow-Headers",
    "Content-Type, X-Green-Button-Payload, X-Green-Button-Signature",
  );
}

app.use((req: Request, res: Response, next: NextFunction) => {
  setCorsHeaders(res, req.headers.origin as string | undefined);
  if (req.method === "OPTIONS") {
    res.sendStatus(204);
    return;
  }
  next();
});

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
  issuedAt?: string;
  expiresAt?: string;
};

function decodePayload(encoded: string): UploadPayload {
  const buffer = base64UrlToBuffer(encoded);
  const json = buffer.toString("utf8");
  return JSON.parse(json) as UploadPayload;
}
 
app.post("/upload", upload.single("file"), async (req: Request, res: Response) => {
  let uploadRecordId: string | null = null;
  let rawRecordId: string | null = null;
  try {
    if (!SECRET) {
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
      res.status(401).json({ ok: false, error: "missing_signature" });
      return;
    }

    if (!verifySignature(payloadEncoded, signature)) {
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
      select: { id: true, userId: true, utilityName: true },
    });

    if (!house) {
      res.status(404).json({ ok: false, error: "home_not_found" });
      return;
    }

    const buffer = file.buffer;
    const sha256 = createHash("sha256").update(buffer).digest("hex");
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

    // Idempotent insert: if the sha256 already exists, reuse that record instead of failing
    try {
      const upserted = await usagePrisma.rawGreenButton.upsert({
        where: { sha256 },
        update: {},
        create: {
          homeId: house.id,
          userId: house.userId,
          utilityName,
          accountNumber,
          filename,
          mimeType,
          sizeBytes: buffer.length,
          content: buffer,
          sha256,
          capturedAt: new Date(),
        },
        select: { id: true },
      });
      rawRecordId = upserted.id;
      logEvent("raw.upsert", { sha256, rawRecordId, reused: false, sizeBytes: buffer.length });
    } catch (err) {
      if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002") {
        const existing = await usagePrisma.rawGreenButton.findUnique({ where: { sha256 }, select: { id: true } });
        rawRecordId = existing?.id ?? null;
        logEvent("raw.upsert.duplicate", { sha256, rawRecordId });
      } else {
        logEvent("raw.upsert.error", { sha256, error: String(err) });
        throw err;
      }
    }

    if (!rawRecordId) {
      throw new Error("Failed to persist raw Green Button record");
    }

    const storageKey = `usage:raw_green_button:${rawRecordId}`;
    const existingUpload = await (prisma as any).greenButtonUpload.findFirst({
      where: { storageKey },
      select: { id: true },
    });

    const baseUploadData = {
      houseId: house.id,
      utilityName,
      accountNumber,
      fileName: filename,
      fileType: mimeType,
      fileSizeBytes: buffer.length,
      storageKey,
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
        data: baseUploadData,
      });
    } else {
      const createdUpload = await (prisma as any).greenButtonUpload.create({
        data: baseUploadData,
      });
      uploadRecordId = createdUpload.id;
    }

    logEvent("upload.record", { uploadRecordId, rawRecordId, houseId: house.id, fileSize: buffer.length });

    const parsed = parseGreenButtonBuffer(buffer, filename);
    if (parsed.errors.length > 0) {
      if (uploadRecordId) {
        await (prisma as any).greenButtonUpload.update({
          where: { id: uploadRecordId },
          data: {
            parseStatus: "error",
            parseMessage: parsed.errors.join("; "),
          },
        });
      }
      res.status(422).json({
        ok: false,
        error: parsed.errors.join("; "),
        warnings: parsed.warnings,
      });
      return;
    }

    if (parsed.readings.length === 0) {
      if (uploadRecordId) {
        await (prisma as any).greenButtonUpload.update({
          where: { id: uploadRecordId },
          data: {
            parseStatus: "empty",
            parseMessage: "File parsed but no interval data was found.",
          },
        });
      }
      res.status(422).json({
        ok: false,
        error: "no_readings",
        warnings: parsed.warnings,
      });
      return;
    }

    const normalized = normalizeGreenButtonReadingsTo15Min(parsed.readings);
    if (normalized.length === 0) {
      if (uploadRecordId) {
        await (prisma as any).greenButtonUpload.update({
          where: { id: uploadRecordId },
          data: {
            parseStatus: "empty",
            parseMessage: "Readings were parsed but could not be normalized to 15-minute intervals.",
          },
        });
      }
      res.status(422).json({
        ok: false,
        error: "normalization_empty",
        warnings: parsed.warnings,
      });
      return;
    }

    const intervalData = normalized.map((interval) => ({
      rawId: rawRecordId!,
      homeId: house.id,
      userId: house.userId,
      timestamp: interval.timestamp,
      consumptionKwh: new Prisma.Decimal(interval.consumptionKwh),
      intervalMinutes: interval.intervalMinutes,
    }));

    await usagePrisma.$transaction(async (tx) => {
      await (tx as any).greenButtonInterval.deleteMany({ where: { rawId: rawRecordId! } });
      if (intervalData.length > 0) {
        await (tx as any).greenButtonInterval.createMany({
          data: intervalData,
        });
      }
    });

    const totalKwh = normalized.reduce((sum, row) => sum + row.consumptionKwh, 0);
    const earliest = normalized[0]?.timestamp ?? null;
    const latest = normalized[normalized.length - 1]?.timestamp ?? null;

    if (uploadRecordId) {
      const summary = {
        format: parsed.format,
        totalRawReadings: parsed.metadata.totalReadings,
        normalizedIntervals: normalized.length,
        totalKwh: Number(totalKwh.toFixed(6)),
        warnings: parsed.warnings,
      };
      await (prisma as any).greenButtonUpload.update({
        where: { id: uploadRecordId },
        data: {
          parseStatus: parsed.warnings.length > 0 ? "complete_with_warnings" : "complete",
          parseMessage: JSON.stringify(summary),
          dateRangeStart: earliest,
          dateRangeEnd: latest,
          intervalMinutes: 15,
        },
      });
    }

    res.status(201).json({
      ok: true,
      rawId: rawRecordId,
      intervalsCreated: normalized.length,
      totalKwh,
      warnings: parsed.warnings,
      dateRangeStart: earliest ? earliest.toISOString() : null,
      dateRangeEnd: latest ? latest.toISOString() : null,
    });
    logEvent("upload.success", {
      rawRecordId,
      uploadRecordId,
      intervals: normalized.length,
      totalKwh,
      warnings: parsed.warnings,
    });
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
    setCorsHeaders(res, req.headers.origin as string | undefined);
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


