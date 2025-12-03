import { NextRequest, NextResponse } from "next/server";
import { createHash } from "node:crypto";
import { Prisma } from "@prisma/client";
import { normalizeGreenButtonReadingsTo15Min, GreenButtonRawReading } from "@/lib/usage/greenButtonNormalize";
import { usagePrisma } from "@/lib/db/usageClient";

function toUtf8String(buffer: ArrayBuffer): string {
  return new TextDecoder("utf-8").decode(buffer);
}

function parseGreenButtonContent(content: string, filename: string): GreenButtonRawReading[] {
  const trimmed = content.trim();
  if (!trimmed) {
    return [];
  }

  if (trimmed.startsWith("[") || trimmed.startsWith("{")) {
    try {
      const json = JSON.parse(trimmed);
      if (Array.isArray(json)) {
        return json.flatMap((item) => mapJsonToReading(item));
      }
      return mapJsonToReading(json);
    } catch (error) {
      console.warn("[green-button/upload] JSON parse failed", error);
      // fall through to CSV/newline parsing
    }
  }

  return parseCsvContent(trimmed, filename);
}

function mapJsonToReading(value: any): GreenButtonRawReading[] {
  if (!value || typeof value !== "object") return [];
  const candidate: GreenButtonRawReading = {
    timestamp: value.timestamp ?? value.start ?? value.time ?? value.intervalStart ?? "",
    durationSeconds: value.durationSeconds ?? value.duration ?? value.intervalSeconds ?? null,
    value: value.value ?? value.usage ?? value.kwh ?? value.wh ?? 0,
    unit: value.unit ?? value.units ?? value.measure ?? null,
  };
  if (!candidate.timestamp || candidate.value === undefined || candidate.value === null) {
    return [];
  }
  return [candidate];
}

function parseCsvContent(content: string, filename: string): GreenButtonRawReading[] {
  const lines = content
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.length > 0 && !line.startsWith("#"));

  if (lines.length === 0) return [];

  const delimiter = detectDelimiter(lines[0]);
  const [headerLine, ...dataLines] = lines;
  const headers = headerLine
    .split(delimiter)
    .map((h) => h.trim().toLowerCase().replace(/[^a-z0-9]+/g, "_"));

  const readings: GreenButtonRawReading[] = [];
  for (const dataLine of dataLines) {
    const columns = dataLine.split(delimiter).map((value) => value.trim());
    if (columns.length === 0) continue;

    if (columns.length === 1 && !headers.includes("timestamp")) {
      // Single column CSV with values only – ignore.
      continue;
    }

    const row: Record<string, string> = {};
    for (let i = 0; i < headers.length; i++) {
      row[headers[i]] = columns[i] ?? "";
    }

    const timestamp =
      row.timestamp ||
      row.start ||
      row.interval_start ||
      row.start_time ||
      row.begin_datetime ||
      row.begin_date ||
      row.time ||
      "";
    const endTimestamp =
      row.end || row.interval_end || row.end_time || row.stop || row.end_datetime || row.end_date || "";
    const value = row.value || row.consumption || row.kwh || row.usage || row.reading || columns[1] || "";
    const unit = row.unit || row.units || row.measure || null;
    const durationSeconds =
      parseNumber(row.duration_seconds) ||
      parseNumber(row.duration) ||
      parseNumber(row.interval_seconds) ||
      parseNumber(row.seconds) ||
      inferDuration(timestamp, endTimestamp);

    if (!timestamp || !value) {
      continue;
    }

    readings.push({
      timestamp,
      value,
      unit,
      durationSeconds: durationSeconds ?? undefined,
    });
  }

  if (readings.length === 0) {
    console.warn("[green-button/upload] no readings parsed from CSV", { filename });
  }

  return readings;
}

function detectDelimiter(line: string): string {
  if (line.includes(",")) return ",";
  if (line.includes("\t")) return "\t";
  if (line.includes(";")) return ";";
  return ",";
}

function parseNumber(value?: string): number | null {
  if (!value) return null;
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) {
    return null;
  }
  return numeric;
}

function inferDuration(start: string, end: string): number | null {
  if (!start || !end) return null;
  const startDate = new Date(start);
  const endDate = new Date(end);
  if (Number.isNaN(startDate.getTime()) || Number.isNaN(endDate.getTime())) {
    return null;
  }
  const diff = Math.floor((endDate.getTime() - startDate.getTime()) / 1000);
  return diff > 0 ? diff : null;
}

export const dynamic = "force-dynamic";

export async function POST(request: NextRequest) {
  try {
    const formData = await request.formData();
    const file = formData.get("file");
    if (!file || !(file instanceof File)) {
      return NextResponse.json({ ok: false, error: "missing_file" }, { status: 400 });
    }
    const utilityName =
      typeof formData.get("utilityName") === "string" ? String(formData.get("utilityName")).trim() : null;
    const accountNumber =
      typeof formData.get("accountNumber") === "string" ? String(formData.get("accountNumber")).trim() : null;

    const arrayBuffer = await file.arrayBuffer();
    if (arrayBuffer.byteLength === 0) {
      return NextResponse.json({ ok: false, error: "empty_file" }, { status: 400 });
    }
    if (arrayBuffer.byteLength > 10 * 1024 * 1024) {
      return NextResponse.json({ ok: false, error: "file_too_large" }, { status: 413 });
    }

    const textContent = toUtf8String(arrayBuffer);
    const readings = parseGreenButtonContent(textContent, file.name);
    if (readings.length === 0) {
      return NextResponse.json({ ok: false, error: "no_readings" }, { status: 400 });
    }

    const normalized = normalizeGreenButtonReadingsTo15Min(readings);
    if (normalized.length === 0) {
      return NextResponse.json({ ok: false, error: "normalization_empty" }, { status: 400 });
    }

    const buffer = Buffer.from(arrayBuffer);
    const digest = createHash("sha256").update(buffer).digest("hex");

    let rawRecordId: string | null = null;
    try {
      const created = await usagePrisma.rawGreenButton.create({
        data: {
          content: buffer,
          filename: file.name,
          mimeType: file.type || "text/plain",
          sizeBytes: buffer.length,
          utilityName,
          accountNumber,
          sha256: digest,
          capturedAt: new Date(),
        },
        select: { id: true },
      });
      rawRecordId = created.id;
    } catch (error: any) {
      if (error && typeof error === "object" && "code" in error && error.code === "P2002") {
        const existing = await usagePrisma.rawGreenButton.findUnique({
          where: { sha256: digest },
          select: { id: true },
        });
        rawRecordId = existing?.id ?? null;
      } else {
        throw error;
      }
    }

    if (!rawRecordId) {
      return NextResponse.json({ ok: false, error: "raw_persist_failed" }, { status: 500 });
    }

    const intervalData = normalized.map((interval) => ({
      rawId: rawRecordId,
      timestamp: interval.timestamp,
      consumptionKwh: new Prisma.Decimal(interval.consumptionKwh),
      intervalMinutes: interval.intervalMinutes,
    }));

    await (usagePrisma as any).greenButtonInterval.createMany({
      data: intervalData,
    });

    const totalKwh = normalized.reduce((sum, row) => sum + row.consumptionKwh, 0);

    return NextResponse.json({
      ok: true,
      rawId: rawRecordId,
      intervalsCreated: normalized.length,
      totalKwh,
    });
  } catch (error) {
    console.error("[admin/green-button/upload] failed", error);
    return NextResponse.json({ ok: false, error: "upload_failed" }, { status: 500 });
  }
}

