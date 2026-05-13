import { trimGreenButtonIntervalsToLatestLocalDays } from "@/lib/usage/greenButtonCoverage";
import { normalizeGreenButtonReadingsTo15Min, type GreenButton15MinInterval } from "@/lib/usage/greenButtonNormalize";
import { parseGreenButtonBuffer, type ParsedGreenButtonResult } from "@/lib/usage/greenButtonParser";

export const GREEN_BUTTON_USAGE_PIPELINE_WINDOW_DAYS = 365;
export const GREEN_BUTTON_USAGE_MAX_KWH_PER_INTERVAL = 10;

export type GreenButtonUsagePipelineSummary = {
  format: ParsedGreenButtonResult["format"];
  totalRawReadings: number;
  normalizedIntervals: number;
  totalKwh: number;
  appliedWindowDays: number;
  coverageStartDateKey: string;
  coverageEndDateKey: string;
  warnings: string[];
};

export type GreenButtonUsagePipelineSuccess = {
  ok: true;
  parsed: ParsedGreenButtonResult;
  normalized: GreenButton15MinInterval[];
  trimmed: GreenButton15MinInterval[];
  startDateKey: string;
  endDateKey: string;
  earliest: Date;
  latest: Date;
  totalKwh: number;
  summary: GreenButtonUsagePipelineSummary;
};

export type GreenButtonUsagePipelineFailure = {
  ok: false;
  error: "parse_errors" | "no_readings" | "normalization_empty" | "no_recent_readings";
  message: string;
  parseStatus: "error" | "empty";
  parsed?: ParsedGreenButtonResult;
  normalizedIntervals?: number;
};

export type GreenButtonUsagePipelineResult =
  | GreenButtonUsagePipelineSuccess
  | GreenButtonUsagePipelineFailure;

export function runGreenButtonUsagePipeline(args: {
  buffer: Buffer;
  filename?: string | null;
  windowDays?: number;
  maxKwhPerInterval?: number | null;
}): GreenButtonUsagePipelineResult {
  const windowDays = args.windowDays ?? GREEN_BUTTON_USAGE_PIPELINE_WINDOW_DAYS;
  const maxKwhPerInterval = args.maxKwhPerInterval ?? GREEN_BUTTON_USAGE_MAX_KWH_PER_INTERVAL;
  const parsed = parseGreenButtonBuffer(args.buffer, args.filename);

  if (parsed.errors.length > 0) {
    return {
      ok: false,
      error: "parse_errors",
      message: parsed.errors.join("; "),
      parseStatus: "error",
      parsed,
    };
  }

  if (parsed.readings.length === 0) {
    return {
      ok: false,
      error: "no_readings",
      message: "File parsed but no interval data was found.",
      parseStatus: "empty",
      parsed,
    };
  }

  const normalized = normalizeGreenButtonReadingsTo15Min(parsed.readings, {
    maxKwhPerInterval,
  });

  if (normalized.length === 0) {
    return {
      ok: false,
      error: "normalization_empty",
      message: "Readings were parsed but could not be normalized to 15-minute intervals.",
      parseStatus: "empty",
      parsed,
      normalizedIntervals: 0,
    };
  }

  const { trimmed, startDateKey, endDateKey } = trimGreenButtonIntervalsToLatestLocalDays(normalized, windowDays);
  const earliest = trimmed[0]?.timestamp ?? null;
  const latest = trimmed[trimmed.length - 1]?.timestamp ?? null;

  if (trimmed.length === 0 || !startDateKey || !endDateKey || !earliest || !latest) {
    return {
      ok: false,
      error: "no_recent_readings",
      message: "Unable to determine a Chicago-local 365-day coverage window for intervals.",
      parseStatus: "error",
      parsed,
      normalizedIntervals: normalized.length,
    };
  }

  const totalKwh = trimmed.reduce((sum, row) => sum + row.consumptionKwh, 0);
  const summary = {
    format: parsed.format,
    totalRawReadings: parsed.metadata.totalReadings,
    normalizedIntervals: trimmed.length,
    totalKwh: Number(totalKwh.toFixed(6)),
    appliedWindowDays: windowDays,
    coverageStartDateKey: startDateKey,
    coverageEndDateKey: endDateKey,
    warnings: parsed.warnings,
  };

  return {
    ok: true,
    parsed,
    normalized,
    trimmed,
    startDateKey,
    endDateKey,
    earliest,
    latest,
    totalKwh,
    summary,
  };
}
