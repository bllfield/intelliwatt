"use client";

import type { ValidationCompareRowWeather } from "@/modules/usageSimulator/compareProjection";

export type ValidationCompareDisplayRow = {
  localDate: string;
  dayType: "weekday" | "weekend";
  actualDayKwh: number;
  simulatedDayKwh: number;
  errorKwh: number;
  percentError: number | null;
  weather?: ValidationCompareRowWeather;
};

export type ValidationCompareDisplay = {
  rows: ValidationCompareDisplayRow[];
  metrics: Record<string, unknown>;
};

function normalizeCompareWeather(value: unknown): ValidationCompareRowWeather | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) return undefined;
  const row = value as Record<string, unknown>;
  const num = (input: unknown) =>
    typeof input === "number" && Number.isFinite(input) ? input : null;
  return {
    tAvgF: num(row.tAvgF),
    tMinF: num(row.tMinF),
    tMaxF: num(row.tMaxF),
    hdd65: num(row.hdd65),
    cdd65: num(row.cdd65),
    source:
      typeof row.source === "string" && row.source.trim()
        ? row.source.trim()
        : null,
    weatherMissing: row.weatherMissing === true,
  };
}

function normalizeCompareRow(
  value: Record<string, unknown> & { dayType?: string; weather?: unknown }
): ValidationCompareDisplayRow {
  const weather = normalizeCompareWeather(value.weather);
  return {
    localDate: String(value.localDate ?? "").slice(0, 10),
    dayType: value.dayType === "weekend" ? "weekend" : "weekday",
    actualDayKwh: Number(value.actualDayKwh ?? 0) || 0,
    simulatedDayKwh:
      Number(value.simulatedDayKwh ?? value.freshCompareSimDayKwh ?? 0) || 0,
    errorKwh: Number(value.errorKwh ?? value.actualVsFreshErrorKwh ?? 0) || 0,
    percentError:
      value.percentError == null ? null : Number(value.percentError) || 0,
    ...(weather ? { weather } : {}),
  };
}

export function buildValidationCompareDisplay(args: {
  compareProjection?: { rows?: unknown; metrics?: unknown } | null;
  dataset?: { meta?: Record<string, unknown> | null } | null;
}): ValidationCompareDisplay {
  const datasetMeta =
    args.dataset?.meta && typeof args.dataset.meta === "object"
      ? args.dataset.meta
      : null;
  const sidecarRows = Array.isArray(args.compareProjection?.rows)
    ? args.compareProjection.rows
    : [];
  const metaRows = Array.isArray(datasetMeta?.validationCompareRows)
    ? datasetMeta.validationCompareRows
    : [];
  const rawRows = sidecarRows.length > 0 ? sidecarRows : metaRows;
  const rows = rawRows
    .filter(
      (row): row is Record<string, unknown> & { dayType?: string; weather?: unknown } =>
        !!row && typeof row === "object" && !Array.isArray(row)
    )
    .map((row) => normalizeCompareRow(row));
  const metrics =
    (sidecarRows.length > 0 ? args.compareProjection?.metrics : undefined) ??
    (metaRows.length > 0 &&
    datasetMeta?.validationCompareMetrics &&
    typeof datasetMeta.validationCompareMetrics === "object"
      ? datasetMeta.validationCompareMetrics
      : undefined) ??
    args.compareProjection?.metrics ??
    {};
  return {
    rows,
    metrics:
      metrics && typeof metrics === "object"
        ? (metrics as Record<string, unknown>)
        : {},
  };
}
