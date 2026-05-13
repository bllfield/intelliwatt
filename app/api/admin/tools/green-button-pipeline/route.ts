import { createHash } from "node:crypto";
import { NextRequest, NextResponse } from "next/server";

import { requireAdmin } from "@/lib/auth/admin";
import { normalizeEmailSafe } from "@/lib/utils/email";
import { runGreenButtonUsagePipeline } from "@/lib/usage/greenButtonUsagePipeline";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 300;

const ADMIN_EMAILS = ["brian@intelliwatt.com", "brian@intellipath-solutions.com"];

function hasAdminSessionCookie(request: NextRequest): boolean {
  const raw = request.cookies.get("intelliwatt_admin")?.value ?? "";
  const email = normalizeEmailSafe(raw);
  return Boolean(email && ADMIN_EMAILS.includes(email));
}

function gateAdmin(request: NextRequest): NextResponse | null {
  if (hasAdminSessionCookie(request)) return null;
  const gate = requireAdmin(request);
  if (!gate.ok) return NextResponse.json(gate.body, { status: gate.status });
  return null;
}

export async function POST(request: NextRequest) {
  const denied = gateAdmin(request);
  if (denied) return denied;

  const formData = await request.formData();
  const file = formData.get("file");

  if (!file || !(file instanceof File)) {
    return NextResponse.json({ ok: false, error: "missing_file" }, { status: 400 });
  }

  const buffer = Buffer.from(await file.arrayBuffer());
  const sha256 = createHash("sha256").update(buffer).digest("hex");
  const result = runGreenButtonUsagePipeline({
    buffer,
    filename: file.name,
  });

  if (!result.ok) {
    return NextResponse.json(
      {
        ok: false,
        error: result.error,
        message: result.message,
        writeMode: "dry_run_no_database_writes",
        file: {
          name: file.name,
          sizeBytes: buffer.length,
          sha256,
        },
        parsed: result.parsed
          ? {
              format: result.parsed.format,
              totalRawReadings: result.parsed.metadata.totalReadings,
              warnings: result.parsed.warnings,
              errors: result.parsed.errors,
            }
          : null,
        normalizedIntervalsBeforeTrim: result.normalizedIntervals ?? null,
      },
      { status: 422 },
    );
  }

  const sample = result.trimmed.slice(0, 3).map((row) => ({
    timestamp: row.timestamp.toISOString(),
    consumptionKwh: Number(row.consumptionKwh.toFixed(6)),
    intervalMinutes: row.intervalMinutes,
  }));
  const tailSample = result.trimmed.slice(-3).map((row) => ({
    timestamp: row.timestamp.toISOString(),
    consumptionKwh: Number(row.consumptionKwh.toFixed(6)),
    intervalMinutes: row.intervalMinutes,
  }));

  return NextResponse.json({
    ok: true,
    writeMode: "dry_run_no_database_writes",
    pipelineEntryPoint: "runGreenButtonUsagePipeline",
    file: {
      name: file.name,
      type: file.type || null,
      sizeBytes: buffer.length,
      sha256,
    },
    parseSummary: result.summary,
    diagnostics: {
      format: result.parsed.format,
      sourceTitle: result.parsed.metadata.sourceTitle,
      meterSerialNumber: result.parsed.metadata.meterSerialNumber,
      timezoneOffsetSeconds: result.parsed.metadata.timezoneOffsetSeconds,
      rawReadings: result.parsed.metadata.totalReadings,
      normalizedIntervalsBeforeTrim: result.normalized.length,
      trimmedIntervals: result.trimmed.length,
      intervalsDroppedByWindow: Math.max(0, result.normalized.length - result.trimmed.length),
      coverageStart: result.earliest.toISOString(),
      coverageEnd: result.latest.toISOString(),
      coverageStartDateKey: result.startDateKey,
      coverageEndDateKey: result.endDateKey,
      warnings: result.parsed.warnings,
      sampleIntervals: sample,
      finalIntervals: tailSample,
    },
  });
}
