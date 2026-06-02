import { convertGreenButtonPersistedRowsToHome } from "@/lib/time/greenButtonPersistedIntervalConvert";
import {
  homeProjectedIntervalFromRecord,
  type HomeProjectedIntervalPoint,
} from "@/lib/time/actualIntervalCalendar";
import { resolveCanonicalUsage365CoverageWindow } from "@/lib/usage/canonicalMetadataWindow";
import { filterOutDstAmbiguousLocalDateKeys } from "@/lib/usage/dstAmbiguousLocalDateKey";
import { resolveGreenButtonPastSimTrustedHomeDateKeys } from "@/lib/usage/greenButtonPastTrustedPool";
import {
  resolveCanonicalPastValidationDayCount,
  resolvePastSmtValidationPolicy,
} from "@/lib/usage/pastValidationPolicy";
import { localDateKeysInRange } from "@/lib/admin/gapfillLab";
import {
  selectValidationDayKeys,
  type ValidationDaySelectionDiagnostics,
} from "@/modules/usageSimulator/validationSelection";
import {
  readGreenButtonTrustedHomeDateKeysFromPastMeta,
  resolveGreenButtonTrustedHomeDateKeysFromDecodedIntervals,
} from "@/lib/usage/greenButtonPastTrustedPool";

function asDateKey(value: unknown): string | null {
  const text = String(value ?? "").slice(0, 10);
  return /^\d{4}-\d{2}-\d{2}$/.test(text) ? text : null;
}

function dateKeyInRange(dateKey: string, startDate: string, endDate: string): boolean {
  return dateKey >= startDate && dateKey <= endDate;
}

/**
 * Stratified validation pool for Green Button Past Sim: home-local trusted days in the
 * coverage window (not Chicago 96/96 on raw UTC-grid timestamps).
 */
export function resolveGreenButtonPastValidationCandidateDateKeys(args: {
  trustedUtcDateKeys: readonly string[];
  intervals: ReadonlyArray<{ timestamp: string; kwh: number }>;
  timezone: string;
  windowStart: string;
  windowEnd: string;
  travelDateKeys?: ReadonlySet<string>;
  /** When set (e.g. from `loadGreenButtonPastProducerIntervals`), use producer home-local trust directly. */
  trustedHomeDateKeys?: Iterable<string>;
}): string[] {
  const windowStart = asDateKey(args.windowStart);
  const windowEnd = asDateKey(args.windowEnd);
  if (!windowStart || !windowEnd) return [];

  const trustedHome =
    args.trustedHomeDateKeys != null
      ? new Set(
          Array.from(args.trustedHomeDateKeys)
            .map((dk) => asDateKey(dk))
            .filter((dk): dk is string => Boolean(dk))
        )
      : (() => {
          const projected: HomeProjectedIntervalPoint[] = convertGreenButtonPersistedRowsToHome(
            args.intervals.map((row) => ({
              timestamp: new Date(row.timestamp),
              consumptionKwh: Number(row.kwh) || 0,
            })),
            args.timezone
          ).intervals.map(homeProjectedIntervalFromRecord);

          return resolveGreenButtonPastSimTrustedHomeDateKeys({
            trustedUtcDateKeys: args.trustedUtcDateKeys,
            intervals: projected,
            timezone: args.timezone,
          });
        })();

  const travel = args.travelDateKeys ?? new Set<string>();
  return filterOutDstAmbiguousLocalDateKeys(
    Array.from(trustedHome).filter((dk) => dateKeyInRange(dk, windowStart, windowEnd) && !travel.has(dk)),
    args.timezone
  );
}

/** Home-local actual daily totals for validation compare (Green Button Past). */
export function buildGreenButtonActualDailyKwhByHomeDateKey(args: {
  intervals: ReadonlyArray<{ timestamp: string; kwh: number; homeDateKey?: string }>;
  dateKeysLocal: Iterable<string>;
  timezone: string;
}): Record<string, number> {
  const wanted = new Set(
    Array.from(args.dateKeysLocal)
      .map((dk) => asDateKey(dk))
      .filter((dk): dk is string => Boolean(dk))
  );
  if (wanted.size === 0) return {};

  const totals = new Map<string, number>();
  const hasHomeDateKeys = args.intervals.some((row) => asDateKey(row.homeDateKey));
  if (hasHomeDateKeys) {
    for (const row of args.intervals) {
      const dk = asDateKey(row.homeDateKey);
      if (!dk || !wanted.has(dk)) continue;
      totals.set(dk, (totals.get(dk) ?? 0) + Math.max(0, Number(row.kwh) || 0));
    }
    return Object.fromEntries(
      Array.from(totals.entries())
        .map(([date, kwh]) => [date, Math.round(kwh * 100) / 100] as const)
        .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
    );
  }

  const projected = convertGreenButtonPersistedRowsToHome(
    args.intervals.map((row) => ({
      timestamp: new Date(row.timestamp),
      consumptionKwh: Number(row.kwh) || 0,
    })),
    args.timezone
  ).intervals.map(homeProjectedIntervalFromRecord);

  for (const row of projected) {
    const dk = asDateKey(row.homeDateKey);
    if (!dk || !wanted.has(dk)) continue;
    totals.set(dk, (totals.get(dk) ?? 0) + Math.max(0, Number(row.kwh) || 0));
  }

  return Object.fromEntries(
    Array.from(totals.entries())
      .map(([date, kwh]) => [date, Math.round(kwh * 100) / 100] as const)
      .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
  );
}

function trustedHomeDateKeysFromRecords(
  meta?: Record<string, unknown> | null,
  buildInputs?: Record<string, unknown> | null
): string[] {
  const raw =
    (Array.isArray(meta?.greenButtonTrustedHomeDateKeysLocal)
      ? (meta.greenButtonTrustedHomeDateKeysLocal as unknown[])
      : null) ??
    (Array.isArray(buildInputs?.greenButtonTrustedHomeDateKeysLocal)
      ? (buildInputs.greenButtonTrustedHomeDateKeysLocal as unknown[])
      : null) ??
    [];
  return raw
    .map((dk) => asDateKey(dk))
    .filter((dk): dk is string => Boolean(dk));
}

function travelDateKeysFromBuildInputs(
  buildInputs: Record<string, unknown> | null | undefined,
  timezone: string
): Set<string> {
  const ranges = Array.isArray(buildInputs?.travelRanges)
    ? (buildInputs.travelRanges as Array<{ startDate?: string; endDate?: string }>)
    : [];
  return new Set(
    ranges.flatMap((range) => localDateKeysInRange(String(range.startDate ?? ""), String(range.endDate ?? ""), timezone))
  );
}

/**
 * Artifact-only Past read: auto-pick validation days from persisted GB trusted pool when
 * build/run omitted validationOnlyDateKeysLocal (One Path admin / user Past read).
 */
export function resolveGreenButtonPastValidationOnlyDateKeysAtRead(args: {
  existingKeys: string[];
  meta?: Record<string, unknown> | null;
  buildInputs?: Record<string, unknown> | null;
  engineInput?: Record<string, unknown> | null;
  houseId?: string;
  timezone?: string;
}): string[] {
  if (args.existingKeys.length > 0) return args.existingKeys;
  const meta = args.meta ?? null;
  if (meta?.actualSource !== "GREEN_BUTTON") return [];

  const trustedHome = trustedHomeDateKeysFromRecords(meta, args.buildInputs ?? null);
  if (trustedHome.length === 0) return [];

  const coverage = resolveCanonicalUsage365CoverageWindow();
  const timezone =
    String(args.timezone ?? meta?.timezone ?? args.buildInputs?.timezone ?? "America/Chicago").trim() ||
    "America/Chicago";
  const travelDateKeys = travelDateKeysFromBuildInputs(args.buildInputs ?? null, timezone);
  const candidates = resolveGreenButtonPastValidationCandidateDateKeys({
    trustedUtcDateKeys: [],
    trustedHomeDateKeys: trustedHome,
    intervals: [],
    timezone,
    windowStart: coverage.startDate,
    windowEnd: coverage.endDate,
    travelDateKeys,
  });
  if (candidates.length === 0) return [];

  const selectionModeRaw =
    String(
      args.engineInput?.validationSelectionMode ??
        args.buildInputs?.effectiveValidationSelectionMode ??
        args.buildInputs?.validationSelectionMode ??
        ""
    ).trim() || null;
  const validationDayCount =
    typeof args.engineInput?.validationDayCount === "number"
      ? args.engineInput.validationDayCount
      : typeof args.buildInputs?.validationDayCount === "number"
        ? (args.buildInputs.validationDayCount as number)
        : null;
  const policy = resolvePastSmtValidationPolicy({
    surface: "user_site",
    validationSelectionMode: selectionModeRaw,
    validationDayCount,
  });
  const manualKeys = Array.isArray(args.engineInput?.validationOnlyDateKeysLocal)
    ? (args.engineInput.validationOnlyDateKeysLocal as unknown[])
    : Array.isArray(args.buildInputs?.validationOnlyDateKeysLocal)
      ? (args.buildInputs.validationOnlyDateKeysLocal as unknown[])
      : [];
  const selection = selectValidationDayKeys({
    mode: policy.selectionMode,
    targetCount: resolveCanonicalPastValidationDayCount(policy.validationDayCount),
    candidateDateKeys: candidates,
    travelDateKeysSet: travelDateKeys,
    timezone,
    seed: `${String(args.houseId ?? "house")}-${coverage.endDate}`,
    manualDateKeys: manualKeys.map((v) => String(v ?? "").slice(0, 10)),
  });
  return selection.selectedDateKeys;
}

export type GreenButtonPastValidationSelectionResult = {
  validationOnlyDateKeysLocal: string[];
  validationActualDailyKwhByDateLocal: Record<string, number>;
  effectiveValidationSelectionMode: string;
  validationSelectionDiagnostics: ValidationDaySelectionDiagnostics;
  greenButtonTrustedHomeDateKeysLocal: string[];
};

/**
 * After Past sim when pre-recalc validation selection produced zero candidates: derive trusted
 * home-local days from artifact meta / stitched intervals, then select validation compare keys.
 */
export function resolveGreenButtonPastValidationSelectionAfterSim(args: {
  existingSelectedKeys: readonly string[];
  datasetMeta: Record<string, unknown> | null | undefined;
  decodedIntervals15: ReadonlyArray<{
    timestamp: string;
    kwh?: number;
    consumption_kwh?: number;
    homeDateKey?: string;
  }>;
  timezone: string;
  houseId: string;
  travelRanges?: Array<{ startDate: string; endDate: string }>;
  validationDayCount?: number | null;
  validationSelectionMode?: string | null;
  trustedUtcDateKeys?: readonly string[];
}): GreenButtonPastValidationSelectionResult | null {
  if (args.existingSelectedKeys.length > 0) return null;
  const meta = args.datasetMeta ?? null;
  if (meta?.actualSource !== "GREEN_BUTTON") return null;
  if (!args.decodedIntervals15.length) return null;

  const coverage = resolveCanonicalUsage365CoverageWindow();
  const timezone =
    String(args.timezone ?? meta?.timezone ?? "America/Chicago").trim() || "America/Chicago";
  const travelDateKeys = new Set(
    (args.travelRanges ?? []).flatMap((range) =>
      localDateKeysInRange(String(range.startDate ?? ""), String(range.endDate ?? ""), timezone)
    )
  );

  let trustedHome = readGreenButtonTrustedHomeDateKeysFromPastMeta(meta);
  if (trustedHome.size === 0) {
    trustedHome = resolveGreenButtonTrustedHomeDateKeysFromDecodedIntervals({
      decodedIntervals: args.decodedIntervals15.map((row) => ({
        timestamp: String(row.timestamp ?? ""),
        kwh: Number(row.kwh ?? row.consumption_kwh) || 0,
      })),
      trustedUtcDateKeys: args.trustedUtcDateKeys ?? [],
      timezone,
    });
  }
  if (trustedHome.size === 0) return null;

  const intervalsForValidation = args.decodedIntervals15.map((row) => ({
    timestamp: String(row.timestamp ?? ""),
    kwh: Number(row.kwh ?? row.consumption_kwh) || 0,
    homeDateKey: String(row.homeDateKey ?? "").slice(0, 10) || undefined,
  }));

  const candidates = resolveGreenButtonPastValidationCandidateDateKeys({
    trustedUtcDateKeys: args.trustedUtcDateKeys ?? [],
    trustedHomeDateKeys: trustedHome,
    intervals: intervalsForValidation,
    timezone,
    windowStart: coverage.startDate,
    windowEnd: coverage.endDate,
    travelDateKeys,
  });
  if (candidates.length === 0) return null;

  const policy = resolvePastSmtValidationPolicy({
    surface: "user_site",
    validationSelectionMode: args.validationSelectionMode ?? null,
    validationDayCount: args.validationDayCount ?? null,
  });
  const selection = selectValidationDayKeys({
    mode: policy.selectionMode,
    targetCount: resolveCanonicalPastValidationDayCount(policy.validationDayCount),
    candidateDateKeys: candidates,
    travelDateKeysSet: travelDateKeys,
    timezone,
    seed: `${String(args.houseId ?? "house")}-${coverage.endDate}`,
  });
  if (selection.selectedDateKeys.length === 0) return null;

  const selectedSet = new Set(selection.selectedDateKeys);
  return {
    validationOnlyDateKeysLocal: selection.selectedDateKeys,
    validationActualDailyKwhByDateLocal: buildGreenButtonActualDailyKwhByHomeDateKey({
      intervals: intervalsForValidation,
      dateKeysLocal: selectedSet,
      timezone,
    }),
    effectiveValidationSelectionMode: policy.selectionMode,
    validationSelectionDiagnostics: selection.diagnostics,
    greenButtonTrustedHomeDateKeysLocal: Array.from(trustedHome).sort(),
  };
}
