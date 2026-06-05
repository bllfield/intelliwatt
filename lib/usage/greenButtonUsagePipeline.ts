import {
  resolveGreenButtonDataAvailableDateKeys,
  resolveGreenButtonDisplayWindow,
  trimGreenButtonIntervalsToLatestLocalDays,
} from "@/lib/usage/greenButtonCoverage";
import {
  GREEN_BUTTON_INTERVAL_INGEST_VERSION,
  type GreenButtonUploadParseSummary,
} from "@/lib/usage/greenButtonIngestContract";
import {
  GREEN_BUTTON_NORMALIZE_READINGS_PER_CHUNK,
  normalizeGreenButtonReadingsTo15MinChunked,
  type GreenButton15MinInterval,
  type GreenButtonNormalizeChunkProgress,
} from "@/lib/usage/greenButtonNormalize";
import { parseGreenButtonBuffer, type ParsedGreenButtonResult } from "@/lib/usage/greenButtonParser";

export const GREEN_BUTTON_USAGE_PIPELINE_WINDOW_DAYS = 365;
export const GREEN_BUTTON_USAGE_MAX_KWH_PER_INTERVAL = 10;

export type GreenButtonUsagePipelineSummary = GreenButtonUploadParseSummary & {
  format: ParsedGreenButtonResult["format"];
  totalRawReadings: number;
  normalizedIntervals: number;
  totalKwh: number;
  appliedWindowDays: number;
  coverageStartDateKey: string;
  coverageEndDateKey: string;
  warnings: string[];
  intervalIngestVersion: number;
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

export type GreenButtonUsagePipelineStage = "parse" | "normalize" | "normalize_repair" | "trim";

export type GreenButtonUsagePipelineStageDetail = {
  stage: GreenButtonUsagePipelineStage;
  ms: number;
  rawReadings?: number;
  normalizedIntervals?: number;
  trimmedIntervals?: number;
  parseMode?: "xml_full_tree" | "xml_interval_blocks";
  chunkCount?: number;
};

export type { GreenButtonNormalizeChunkProgress };

export function runGreenButtonUsagePipeline(args: {
  buffer: Buffer;
  filename?: string | null;
  windowDays?: number;
  maxKwhPerInterval?: number | null;
  readingsPerChunk?: number;
  onStageComplete?: (detail: GreenButtonUsagePipelineStageDetail) => void;
  onNormalizeChunkStart?: (progress: Pick<GreenButtonNormalizeChunkProgress, "chunkIndex" | "chunkCount" | "readingsInChunk">) => void;
  onNormalizeChunkComplete?: (progress: GreenButtonNormalizeChunkProgress) => void;
  onXmlParseProgress?: (detail: { blocksScanned: number; readingsFound: number }) => void;
}): GreenButtonUsagePipelineResult {
  const windowDays = args.windowDays ?? GREEN_BUTTON_USAGE_PIPELINE_WINDOW_DAYS;
  const maxKwhPerInterval = args.maxKwhPerInterval ?? GREEN_BUTTON_USAGE_MAX_KWH_PER_INTERVAL;

  let stageStart = Date.now();
  const parsed = parseGreenButtonBuffer(args.buffer, args.filename, {
    onXmlParseProgress: args.onXmlParseProgress,
  });
  args.onStageComplete?.({
    stage: "parse",
    ms: Date.now() - stageStart,
    rawReadings: parsed.metadata.totalReadings,
    parseMode: parsed.metadata.parseMode,
  });

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

  const readingsPerChunk = args.readingsPerChunk ?? GREEN_BUTTON_NORMALIZE_READINGS_PER_CHUNK;
  const chunkCount = Math.max(1, Math.ceil(parsed.readings.length / readingsPerChunk));

  stageStart = Date.now();
  const normalized = normalizeGreenButtonReadingsTo15MinChunked(parsed.readings, {
    maxKwhPerInterval,
    readingsPerChunk,
    onChunkStart: (progress) => args.onNormalizeChunkStart?.(progress),
    onChunkComplete: (progress) => args.onNormalizeChunkComplete?.(progress),
    onRepairComplete: (detail) => {
      args.onStageComplete?.({
        stage: "normalize_repair",
        ms: detail.ms,
        rawReadings: parsed.metadata.totalReadings,
        chunkCount,
        normalizedIntervals: detail.bucketsBefore,
      });
    },
  });
  args.onStageComplete?.({
    stage: "normalize",
    ms: Date.now() - stageStart,
    rawReadings: parsed.metadata.totalReadings,
    chunkCount,
    normalizedIntervals: normalized.length,
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

  stageStart = Date.now();
  const { trimmed, startDateKey, endDateKey } = trimGreenButtonIntervalsToLatestLocalDays(normalized, windowDays);
  args.onStageComplete?.({
    stage: "trim",
    ms: Date.now() - stageStart,
    normalizedIntervals: normalized.length,
    trimmedIntervals: trimmed.length,
  });
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
  const dataAvailable = resolveGreenButtonDataAvailableDateKeys(normalized);
  const displayWindow = resolveGreenButtonDisplayWindow(endDateKey, windowDays);
  const summary: GreenButtonUsagePipelineSummary = {
    format: parsed.format,
    totalRawReadings: parsed.metadata.totalReadings,
    normalizedIntervals: trimmed.length,
    normalizedBeforeTrim: normalized.length,
    totalKwh: Number(totalKwh.toFixed(6)),
    appliedWindowDays: windowDays,
    coverageStartDateKey: startDateKey,
    coverageEndDateKey: endDateKey,
    displayWindowStartDateKey: displayWindow?.startDate,
    displayWindowEndDateKey: displayWindow?.endDate,
    dataAvailableStartDateKey: dataAvailable.startDateKey ?? undefined,
    dataAvailableEndDateKey: dataAvailable.endDateKey ?? undefined,
    warnings: parsed.warnings,
    intervalIngestVersion: GREEN_BUTTON_INTERVAL_INGEST_VERSION,
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
