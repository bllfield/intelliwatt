import { prisma } from "@/lib/db";
import { anchorEndDateUtc, monthsEndingAt } from "@/modules/manualUsage/anchor";
import { canonicalWindow12Months } from "@/modules/usageSimulator/canonicalWindow";
import { normalizeStoredApplianceProfile } from "@/modules/applianceProfile/validation";
import { getApplianceProfileSimulatedByUserHouse } from "@/modules/applianceProfile/repo";
import { getHomeProfileSimulatedByUserHouse } from "@/modules/homeProfile/repo";
import { buildSimulatorInputs, travelRangesToExcludeDateKeys, type BaseKind, type BuildMode } from "@/modules/usageSimulator/build";
import { computeRequirements, type SimulatorMode } from "@/modules/usageSimulator/requirements";
import { chooseActualSource, hasActualIntervals } from "@/modules/realUsageAdapter/actual";
import { SMT_SHAPE_DERIVATION_VERSION } from "@/modules/realUsageAdapter/smt";
import { getActualUsageDatasetForHouse, getIntervalDataFingerprint } from "@/lib/usage/actualDatasetForHouse";
import { upsertSimulatedUsageBuckets } from "@/lib/usage/simulatedUsageBuckets";
import {
  buildSimulatedUsageDatasetFromBuildInputs,
  buildSimulatedUsageDatasetFromCurve,
  buildDisplayMonthlyFromIntervalsUtc,
  recomputePastAggregatesFromIntervals,
  type SimulatorBuildInputsV1,
} from "@/modules/usageSimulator/dataset";
import { computeBuildInputsHash } from "@/modules/usageSimulator/hash";
import { resolveWindowFromBuildInputsForPastIdentity } from "@/modules/usageSimulator/windowIdentity";
import { INTRADAY_TEMPLATE_VERSION } from "@/modules/simulatedUsage/intradayTemplates";
import { computeMonthlyOverlay, computePastOverlay, computeFutureOverlay } from "@/modules/usageScenario/overlay";
import { listLedgerRows } from "@/modules/upgradesLedger/repo";
import { buildOrderedLedgerEntriesForOverlay } from "@/modules/upgradesLedger/overlayEntries";
import { getHouseAddressForUserHouse, listHouseAddressesForUser, normalizeScenarioKey, upsertSimulatorBuild } from "@/modules/usageSimulator/repo";
import { getLatestUsageShapeProfile } from "@/modules/usageShapeProfile/repo";
import { saveIntervalSeries15m } from "@/lib/usage/intervalSeriesRepo";
import {
  computePastInputHash,
  getCachedPastDataset,
  getLatestCachedPastDatasetByScenario,
  saveCachedPastDataset,
  PAST_ENGINE_VERSION,
} from "@/modules/usageSimulator/pastCache";
import { encodeIntervalsV1, decodeIntervalsV1, INTERVAL_CODEC_V1 } from "@/modules/usageSimulator/intervalCodec";
import { IntervalSeriesKind } from "@/modules/usageSimulator/kinds";
import { billingPeriodsEndingAt } from "@/modules/manualUsage/billingPeriods";
import { normalizeMonthlyTotals, WEATHER_NORMALIZER_VERSION, type WeatherPreference } from "@/modules/weatherNormalization/normalizer";
import { ensureHouseWeatherStubbed } from "@/modules/weather/stubs";
import { getHouseWeatherDays } from "@/modules/weather/repo";
import { ensureHouseWeatherBackfill } from "@/modules/weather/backfill";
import { SOURCE_OF_DAY_SIMULATION_CORE } from "@/modules/simulatedUsage/pastDaySimulator";
import type { SimulatedDayResult } from "@/modules/simulatedUsage/pastDaySimulatorTypes";
import { canonicalIntervalKey, dateKeyInTimezone } from "@/lib/admin/gapfillLab";
import { buildAndSavePastForGapfillLab, inspectPastCacheArtifacts } from "@/lib/admin/gapfillLabPrime";
import { computePastWeatherIdentity } from "@/modules/weather/identity";
import { displayProfilesFromModelMeta } from "@/modules/usageSimulator/profileDisplay";
import { classifySimulationFailure, recordSimulationDataAlert } from "@/modules/usageSimulator/simulationDataAlerts";
import {
  simulatePastUsageDataset,
  getUsageShapeProfileIdentityForPast,
} from "@/modules/simulatedUsage/simulatePastUsageDataset";
import type { SimulatedCurve } from "@/modules/simulatedUsage/types";

type ManualUsagePayloadAny = any;

const WORKSPACE_PAST_NAME = "Past (Corrected)";
const WORKSPACE_FUTURE_NAME = "Future (What-if)";

async function reportSimulationDataIssue(args: {
  source: "GAPFILL_LAB" | "USER_SIMULATION" | "USAGE_DASHBOARD";
  userId: string;
  houseId: string;
  scenarioId?: string | null;
  code?: string | null;
  message?: string | null;
  context?: Record<string, unknown>;
}) {
  const classification = classifySimulationFailure({
    code: args.code ?? null,
    message: args.message ?? null,
  });
  if (!classification.shouldAlert) return;
  await recordSimulationDataAlert({
    source: args.source,
    userId: args.userId,
    houseId: args.houseId,
    scenarioId: args.scenarioId ?? null,
    reasonCode: classification.reasonCode,
    reasonMessage: classification.reasonMessage,
    missingData: classification.missingData,
    context: args.context ?? null,
  });
}

function validateSharedSimQuality(dataset: any): { ok: true } | { ok: false; message: string } {
  const meta = (dataset as any)?.meta ?? {};
  const datasetKind = String(meta?.datasetKind ?? "");
  if (datasetKind !== "SIMULATED") return { ok: true };

  const dayTotalSource = String(meta?.dayTotalSource ?? "");
  const profileReason = String(meta?.usageShapeProfileDiag?.reasonNotUsed ?? "");
  const weatherSourceSummary = String(meta?.weatherSourceSummary ?? "");

  if (dayTotalSource === "fallback_month_avg" || profileReason) {
    return {
      ok: false,
      message:
        "Shared simulation quality guard failed: usage-shape profile is missing/invalid (fallback_month_avg).",
    };
  }
  if (weatherSourceSummary && weatherSourceSummary !== "actual_only") {
    return {
      ok: false,
      message:
        "Shared simulation quality guard failed: modeled window is not backed by actual-only weather coverage.",
    };
  }
  return { ok: true };
}

type DateRange = { startDate: string; endDate: string };
type IntervalPoint = { timestamp: string; kwh: number };

export type GapfillCompareSimSharedResult =
  | {
      ok: true;
      artifactAutoRebuilt: boolean;
      artifactIntervals: IntervalPoint[];
      simulatedTestIntervals: IntervalPoint[];
      simulatedChartIntervals: IntervalPoint[];
      simulatedChartDaily: Array<{ date: string; simKwh: number; source: "ACTUAL" | "SIMULATED" }>;
      simulatedChartMonthly: Array<{ month: string; kwh: number }>;
      simulatedChartStitchedMonth: {
        mode: "PRIOR_YEAR_TAIL";
        yearMonth: string;
        haveDaysThrough: number;
        missingDaysFrom: number;
        missingDaysTo: number;
        borrowedFromYearMonth: string;
        completenessRule: string;
      } | null;
      modelAssumptions: any;
      homeProfileFromModel: any | null;
      applianceProfileFromModel: any | null;
    }
  | {
      ok: false;
      status: number;
      body: Record<string, unknown>;
    };

function round2Local(n: number) {
  return Math.round((Number(n) || 0) * 100) / 100;
}

function reconcileRestoredDatasetFromDecodedIntervals(args: {
  dataset: any;
  decodedIntervals: Array<{ timestamp: string; kwh: number }>;
  fallbackEndDate: string;
}) {
  const { dataset, decodedIntervals, fallbackEndDate } = args;
  if (!dataset || typeof dataset !== "object" || !Array.isArray(decodedIntervals) || decodedIntervals.length === 0) {
    return;
  }
  const lastDecodedTs = decodedIntervals[decodedIntervals.length - 1]?.timestamp;
  const curveEnd =
    (lastDecodedTs && String(lastDecodedTs).slice(0, 10)) ||
    String((dataset as any)?.summary?.end ?? fallbackEndDate).slice(0, 10);

  const simDateKeys = new Set<string>(
    (Array.isArray((dataset as any)?.daily) ? (dataset as any).daily : [])
      .filter((d: any) => String(d?.source ?? "").toUpperCase() === "SIMULATED")
      .map((d: any) => String(d?.date ?? "").slice(0, 10))
      .filter((dk: string) => /^\d{4}-\d{2}-\d{2}$/.test(dk))
  );
  const recomputed = recomputePastAggregatesFromIntervals({
    intervals: decodedIntervals,
    curveEndDate: curveEnd,
    simulatedDateKeys: simDateKeys,
  });
  (dataset as any).daily = recomputed.daily;
  if (recomputed.monthly.length > 0) {
    (dataset as any).monthly = recomputed.monthly;
    (dataset as any).usageBucketsByMonth = recomputed.usageBucketsByMonth;
  }

  if (!dataset.summary || typeof dataset.summary !== "object") (dataset as any).summary = {};
  (dataset.summary as any).totalKwh = recomputed.intervalSumKwh;
  if ((dataset.summary as any).intervalsCount == null) {
    (dataset.summary as any).intervalsCount = recomputed.intervalCount;
  }
  if (!dataset.totals || typeof dataset.totals !== "object") (dataset as any).totals = {};
  (dataset.totals as any).importKwh = recomputed.intervalSumKwh;
  (dataset.totals as any).netKwh = recomputed.intervalSumKwh;
}

function enumerateDateKeysInclusive(startDate: string, endDate: string): Set<string> {
  const out = new Set<string>();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(startDate) || !/^\d{4}-\d{2}-\d{2}$/.test(endDate)) return out;
  if (endDate < startDate) return out;
  let y = Number(startDate.slice(0, 4));
  let m = Number(startDate.slice(5, 7));
  let d = Number(startDate.slice(8, 10));
  const endY = Number(endDate.slice(0, 4));
  const endM = Number(endDate.slice(5, 7));
  const endD = Number(endDate.slice(8, 10));
  while (true) {
    const key = `${String(y).padStart(4, "0")}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
    out.add(key);
    if (y === endY && m === endM && d === endD) break;
    const next = new Date(Date.UTC(y, m - 1, d) + 24 * 60 * 60 * 1000);
    y = next.getUTCFullYear();
    m = next.getUTCMonth() + 1;
    d = next.getUTCDate();
  }
  return out;
}

export async function buildGapfillCompareSimShared(args: {
  userId: string;
  houseId: string;
  timezone: string;
  canonicalWindow: { startDate: string; endDate: string };
  testRangesUsed: DateRange[];
  testDateKeysLocal: Set<string>;
  fallbackSimulatedDateKeysLocal?: Set<string>;
  rebuildArtifact: boolean;
}): Promise<GapfillCompareSimSharedResult> {
  const {
    userId,
    houseId,
    timezone,
    canonicalWindow,
    testRangesUsed,
    testDateKeysLocal,
    fallbackSimulatedDateKeysLocal,
    rebuildArtifact,
  } = args;

  if (rebuildArtifact) {
    const rebuilt = await buildAndSavePastForGapfillLab({
      userId,
      houseId,
      rangesToMask: testRangesUsed,
      timezone,
    });
    if (!rebuilt.ok) {
      return {
        ok: false,
        status: 400,
        body: {
          ok: false,
          error: rebuilt.error,
          message: rebuilt.message,
          windowStartUtc: rebuilt.windowStartUtc ?? null,
          windowEndUtc: rebuilt.windowEndUtc ?? null,
          missingDateKeys: rebuilt.missingDateKeys ?? [],
          stubRowCount: rebuilt.stubRowCount ?? null,
          weatherSourceSummary: rebuilt.weatherSourceSummary ?? null,
          windowHelper: rebuilt.windowHelper ?? null,
        },
      };
    }
  } else {
    const inspect = await inspectPastCacheArtifacts({ houseId, scenarioId: "gapfill_lab" });
    if (inspect.count <= 0) {
      return {
        ok: false,
        status: 409,
        body: {
          ok: false,
          error: "artifact_missing_rebuild_required",
          message:
            "No saved gapfill_lab artifact found. Trigger explicit rebuildArtifact=true (or prime-past-cache action=rebuild) before inspect/read compare.",
          mode: "artifact_only",
          scenarioId: "gapfill_lab",
        },
      };
    }
  }

  const chartDateKeysLocal = enumerateDateKeysInclusive(canonicalWindow.startDate, canonicalWindow.endDate);
  const expectedChartIntervalCount = chartDateKeysLocal.size * 96;

  let simOut = await getSimulatedUsageForHouseScenario({
    userId,
    houseId,
    scenarioId: "gapfill_lab",
    readMode: "artifact_only",
  });
  let artifactAutoRebuilt = false;
  const initialIntervals15 =
    simOut.ok && Array.isArray(simOut.dataset?.series?.intervals15)
      ? (simOut.dataset.series.intervals15 as Array<{ timestamp: string; kwh: number }>)
      : [];

  if (
    !rebuildArtifact &&
    simOut.ok &&
    initialIntervals15.length > 0 &&
    initialIntervals15.length < expectedChartIntervalCount
  ) {
    return {
      ok: false,
      status: 409,
      body: {
        ok: false,
        error: "artifact_stale_rebuild_required",
        message:
          "Saved gapfill_lab artifact is stale/incomplete for this canonical window. Trigger explicit rebuildArtifact=true before inspect/read compare.",
        mode: "artifact_only",
        scenarioId: "gapfill_lab",
      },
    };
  }

  const expectedMaskedDayCount = fallbackSimulatedDateKeysLocal?.size ?? null;
  const expectedMaskedFingerprint =
    fallbackSimulatedDateKeysLocal != null ? Array.from(fallbackSimulatedDateKeysLocal).sort().join(",") : null;
  const observedMaskedDayCount =
    simOut.ok && simOut.dataset ? Number((simOut.dataset as any)?.meta?.excludedDateKeysCount ?? NaN) : Number.NaN;
  const observedMaskedFingerprint =
    simOut.ok && simOut.dataset ? String((simOut.dataset as any)?.meta?.excludedDateKeysFingerprint ?? "") : "";
  const needsMaskScopeRebuild =
    simOut.ok &&
    expectedMaskedDayCount != null &&
    expectedMaskedDayCount > 0 &&
    (!Number.isFinite(observedMaskedDayCount) ||
      observedMaskedDayCount !== expectedMaskedDayCount ||
      !observedMaskedFingerprint ||
      (expectedMaskedFingerprint != null && observedMaskedFingerprint !== expectedMaskedFingerprint));

  if (!rebuildArtifact && needsMaskScopeRebuild) {
    return {
      ok: false,
      status: 409,
      body: {
        ok: false,
        error: "artifact_scope_mismatch_rebuild_required",
        message:
          "Saved gapfill_lab artifact mask scope does not match requested ranges. Trigger explicit rebuildArtifact=true before inspect/read compare.",
        mode: "artifact_only",
        scenarioId: "gapfill_lab",
      },
    };
  }

  if (!simOut.ok || !simOut.dataset?.series?.intervals15) {
    const status = simOut.ok ? 500 : simOut.code === "ARTIFACT_MISSING" ? 409 : 500;
    return {
      ok: false,
      status,
      body: {
        ok: false,
        error: simOut.ok
          ? "artifact_read_failed"
          : simOut.code === "ARTIFACT_MISSING"
            ? "artifact_missing_rebuild_required"
            : "artifact_read_failed",
        message: simOut.ok
          ? "Saved artifact missing intervals15 series."
          : simOut.code === "ARTIFACT_MISSING"
            ? "No saved gapfill_lab artifact found. Trigger explicit rebuildArtifact=true before inspect/read compare."
            : simOut.message,
        code: simOut.ok ? "INTERNAL_ERROR" : simOut.code,
      },
    };
  }

  const artifactIntervals = (simOut.dataset.series.intervals15 as Array<{ timestamp: string; kwh: number }>).map((p) => ({
    timestamp: canonicalIntervalKey(String(p?.timestamp ?? "").trim()),
    kwh: Number(p?.kwh) || 0,
  }));
  const simulatedTestIntervals = artifactIntervals.filter((p) => testDateKeysLocal.has(dateKeyInTimezone(p.timestamp, timezone)));
  const simulatedChartIntervals = artifactIntervals.filter((p) => chartDateKeysLocal.has(dateKeyInTimezone(p.timestamp, timezone)));

  const daySourceFromDataset = new Map<string, "ACTUAL" | "SIMULATED">(
    (Array.isArray((simOut.dataset as any)?.daily) ? (simOut.dataset as any).daily : [])
      .map((d: any) => [String(d?.date ?? "").slice(0, 10), String(d?.source ?? "").toUpperCase() === "SIMULATED" ? "SIMULATED" : "ACTUAL"])
      .filter((entry: [string, "ACTUAL" | "SIMULATED"]) => /^\d{4}-\d{2}-\d{2}$/.test(entry[0]))
  );

  const simulatedChartDaily = Array.from(
    simulatedChartIntervals.reduce((acc, p) => {
      const dk = dateKeyInTimezone(p.timestamp, timezone);
      acc.set(dk, (acc.get(dk) ?? 0) + (Number(p.kwh) || 0));
      return acc;
    }, new Map<string, number>())
  )
    .sort((a, b) => (a[0] < b[0] ? -1 : 1))
    .map(([date, simKwh]) => ({
      date,
      simKwh: round2Local(simKwh),
      source: daySourceFromDataset.get(date) ?? (fallbackSimulatedDateKeysLocal?.has(date) ? "SIMULATED" : "ACTUAL"),
    }));

  const monthlyChartBuild = buildDisplayMonthlyFromIntervalsUtc(
    simulatedChartIntervals.map((p) => ({
      timestamp: String(p.timestamp ?? ""),
      consumption_kwh: Number(p.kwh) || 0,
    })),
    canonicalWindow.endDate
  );

  const modelAssumptions = (simOut.dataset as any)?.meta ?? null;
  const sharedProfiles = displayProfilesFromModelMeta(modelAssumptions);

  return {
    ok: true,
    artifactAutoRebuilt,
    artifactIntervals,
    simulatedTestIntervals,
    simulatedChartIntervals,
    simulatedChartDaily,
    simulatedChartMonthly: monthlyChartBuild.monthly,
    simulatedChartStitchedMonth: monthlyChartBuild.stitchedMonth,
    modelAssumptions,
    homeProfileFromModel: sharedProfiles.homeProfile,
    applianceProfileFromModel: sharedProfiles.applianceProfile,
  };
}

function normalizeScenarioTravelRanges(
  events: Array<{ kind: string; payloadJson: any }>,
): Array<{ startDate: string; endDate: string }> {
  return (events || [])
    .filter((e) => String(e?.kind ?? "") === "TRAVEL_RANGE")
    .map((e) => {
      const p = (e as any)?.payloadJson ?? {};
      const startDate = typeof p?.startDate === "string" ? String(p.startDate).slice(0, 10) : "";
      const endDate = typeof p?.endDate === "string" ? String(p.endDate).slice(0, 10) : "";
      return { startDate, endDate };
    })
    .filter((r) => /^\d{4}-\d{2}-\d{2}$/.test(r.startDate) && /^\d{4}-\d{2}-\d{2}$/.test(r.endDate));
}

function applyMonthlyOverlay(args: { base: number; mult?: unknown; add?: unknown }): number {
  const base = Number(args.base) || 0;
  const multNum = args.mult == null ? NaN : Number(args.mult);
  const mult = Number.isFinite(multNum) ? multNum : 1;
  const addNum = args.add == null ? NaN : Number(args.add);
  const add = Number.isFinite(addNum) ? addNum : 0;
  return Math.max(0, base * mult + add);
}

/** When actual Baseline dataset has empty or inconsistent monthly (e.g. sum << summary.totalKwh), fill from build so the dashboard shows correct monthly breakdown. */
function ensureBaselineMonthlyFromBuild(dataset: any, buildInputs: SimulatorBuildInputsV1): void {
  const canonicalMonths = (buildInputs as any).canonicalMonths as string[] | undefined;
  const byMonth = buildInputs.monthlyTotalsKwhByMonth;
  if (!Array.isArray(canonicalMonths) || canonicalMonths.length === 0 || !byMonth || typeof byMonth !== "object") return;
  const totalKwh = Number(dataset?.summary?.totalKwh) || 0;
  const monthly = Array.isArray(dataset?.monthly) ? dataset.monthly : [];
  const monthlySum = monthly.reduce((s: number, r: { kwh?: number }) => s + (Number(r?.kwh) || 0), 0);
  if (monthly.length > 0 && totalKwh > 0 && monthlySum >= totalKwh * 0.99) return;
  const built = canonicalMonths.map((ym) => ({
    month: String(ym).trim(),
    kwh: Math.round((Number(byMonth[ym]) || 0) * 100) / 100,
  }));
  dataset.monthly = built;
}

/** Canonical window as date range (YYYY-MM-DD) and day count for display and interval count. */
function canonicalWindowDateRange(canonicalMonths: string[]): { start: string; end: string; days: number } | null {
  if (!Array.isArray(canonicalMonths) || canonicalMonths.length === 0) return null;
  const first = String(canonicalMonths[0]).trim();
  const last = String(canonicalMonths[canonicalMonths.length - 1]).trim();
  if (!/^\d{4}-\d{2}$/.test(first) || !/^\d{4}-\d{2}$/.test(last)) return null;
  const start = `${first}-01`;
  const [y, m] = last.split("-").map(Number);
  const lastDay = new Date(Date.UTC(y, m, 0)).getUTCDate();
  const end = `${last}-${String(lastDay).padStart(2, "0")}`;
  const days = Math.round((new Date(end + "T12:00:00.000Z").getTime() - new Date(start + "T12:00:00.000Z").getTime()) / (24 * 60 * 60 * 1000)) + 1;
  return { start, end, days: Math.max(1, days) };
}

function monthsIntersectingTravelRanges(
  canonicalMonths: string[],
  travelRanges: Array<{ startDate: string; endDate: string }>
): Set<string> {
  const out = new Set<string>();
  const monthSet = new Set((canonicalMonths ?? []).map((m) => String(m)));
  for (const r of travelRanges ?? []) {
    const start = String(r?.startDate ?? "").slice(0, 10);
    const end = String(r?.endDate ?? "").slice(0, 10);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(start) || !/^\d{4}-\d{2}-\d{2}$/.test(end)) continue;
    const a = new Date(start + "T12:00:00.000Z");
    const b = new Date(end + "T12:00:00.000Z");
    if (!Number.isFinite(a.getTime()) || !Number.isFinite(b.getTime())) continue;
    const firstMs = Math.min(a.getTime(), b.getTime());
    const lastMs = Math.max(a.getTime(), b.getTime());
    let cur = new Date(firstMs);
    while (cur.getTime() <= lastMs) {
      const ym = cur.toISOString().slice(0, 7);
      if (monthSet.has(ym)) out.add(ym);
      cur = new Date(Date.UTC(cur.getUTCFullYear(), cur.getUTCMonth() + 1, 1, 12, 0, 0, 0));
    }
  }
  return out;
}

function canonicalMonthsForRecalc(args: { mode: SimulatorMode; manualUsagePayload: ManualUsagePayloadAny | null; now?: Date }) {
  const now = args.now ?? new Date();

  // V1 determinism: derive canonicalMonths from manual anchor when in manual mode, else platform default (last full month Chicago).
  if (args.mode === "MANUAL_TOTALS" && args.manualUsagePayload) {
    const p = args.manualUsagePayload as any;
    if (p?.mode === "MONTHLY") {
      const anchorEndDateKey = typeof p.anchorEndDate === "string" && /^\d{4}-\d{2}-\d{2}$/.test(p.anchorEndDate) ? String(p.anchorEndDate) : null;
      const legacyEndMonth = typeof p.anchorEndMonth === "string" && /^\d{4}-\d{2}$/.test(p.anchorEndMonth) ? String(p.anchorEndMonth) : null;
      const legacyBillEndDay = typeof p.billEndDay === "number" && Number.isFinite(p.billEndDay) ? Math.trunc(p.billEndDay) : 15;
      const endMonth = anchorEndDateKey
        ? anchorEndDateKey.slice(0, 7)
        : legacyEndMonth
          ? (anchorEndDateUtc(legacyEndMonth, legacyBillEndDay)?.toISOString().slice(0, 7) ?? legacyEndMonth)
          : null;
      if (endMonth) return { endMonth, months: monthsEndingAt(endMonth, 12) };
    }
    if (p?.mode === "ANNUAL") {
      const endKey =
        typeof p.anchorEndDate === "string" && /^\d{4}-\d{2}-\d{2}$/.test(p.anchorEndDate)
          ? String(p.anchorEndDate)
          : typeof p.endDate === "string" && /^\d{4}-\d{2}-\d{2}$/.test(p.endDate)
            ? String(p.endDate)
            : null;
      if (endKey) {
        const endMonth = endKey.slice(0, 7);
        return { endMonth, months: monthsEndingAt(endMonth, 12) };
      }
    }
  }

  return canonicalWindow12Months(now);
}

function baseKindFromMode(mode: SimulatorMode): BaseKind {
  if (mode === "MANUAL_TOTALS") return "MANUAL";
  if (mode === "NEW_BUILD_ESTIMATE") return "ESTIMATED";
  return "SMT_ACTUAL_BASELINE";
}

export type SimulatorRecalcOk = {
  ok: true;
  houseId: string;
  buildInputsHash: string;
  dataset: any;
};

export type SimulatorRecalcErr = {
  ok: false;
  error: string;
  missingItems?: string[];
};

export async function recalcSimulatorBuild(args: {
  userId: string;
  houseId: string;
  esiid: string | null;
  mode: SimulatorMode;
  scenarioId?: string | null;
  weatherPreference?: WeatherPreference;
  persistPastSimBaseline?: boolean;
  now?: Date;
}): Promise<SimulatorRecalcOk | SimulatorRecalcErr> {
  const { userId, houseId, esiid, mode } = args;
  const scenarioKey = normalizeScenarioKey(args.scenarioId);
  const scenarioId = scenarioKey === "BASELINE" ? null : scenarioKey;

  // Load persisted baseline inputs
  const [manualRec, homeRec, applianceRec] = await Promise.all([
    (prisma as any).manualUsageInput
      .findUnique({ where: { userId_houseId: { userId, houseId } }, select: { payload: true } })
      .catch(() => null),
    getHomeProfileSimulatedByUserHouse({ userId, houseId }),
    getApplianceProfileSimulatedByUserHouse({ userId, houseId }),
  ]);

  const manualUsagePayload = (manualRec?.payload as any) ?? null;
  const canonical = canonicalMonthsForRecalc({ mode, manualUsagePayload, now: args.now });

  const applianceProfile = normalizeStoredApplianceProfile((applianceRec?.appliancesJson as any) ?? null);
  const homeProfile = homeRec ? { ...homeRec } : null;

  const actualOk = await hasActualIntervals({ houseId, esiid: esiid ?? null, canonicalMonths: canonical.months });
  const actualSource = await chooseActualSource({ houseId, esiid: esiid ?? null });

  // Baseline ladder enforcement (V1): SMT_BASELINE requires actual 15-minute intervals (SMT or Green Button).
  if (mode === "SMT_BASELINE" && !actualOk) {
    return {
      ok: false,
      error: "requirements_unmet",
      missingItems: ["Actual 15-minute interval data required (Smart Meter Texas or Green Button upload)."],
    };
  }

  // Scenario must exist (and be house-scoped) when scenarioId is provided.
  let scenario: { id: string; name: string } | null = null;
  let scenarioEvents: Array<{ id: string; effectiveMonth: string; kind: string; payloadJson: any }> = [];
  if (scenarioId) {
    scenario = await (prisma as any).usageSimulatorScenario
      .findFirst({
        where: { id: scenarioId, userId, houseId, archivedAt: null },
        select: { id: true, name: true },
      })
      .catch(() => null);
    if (!scenario) return { ok: false, error: "scenario_not_found" };

    scenarioEvents = await (prisma as any).usageSimulatorScenarioEvent
      .findMany({
        where: { scenarioId: scenarioId },
        select: { id: true, effectiveMonth: true, kind: true, payloadJson: true },
        orderBy: [{ effectiveMonth: "asc" }, { createdAt: "asc" }, { id: "asc" }],
      })
      .catch(() => []);
  }

  const scenarioTravelRanges = scenarioId ? normalizeScenarioTravelRanges(scenarioEvents as any) : [];

  const isFutureScenario = Boolean(scenarioId) && scenario?.name === WORKSPACE_FUTURE_NAME;
  let pastTravelRanges: Array<{ startDate: string; endDate: string }> = [];
  let pastScenario: { id: string; name: string } | null = null;
  let pastEventsForOverlay: Array<{ id: string; effectiveMonth: string; kind: string; payloadJson: any }> = [];
  let pastOverlay: ReturnType<typeof computeMonthlyOverlay> | null = null;

  if (isFutureScenario) {
    pastScenario = await (prisma as any).usageSimulatorScenario
      .findFirst({
        where: { userId, houseId, name: WORKSPACE_PAST_NAME, archivedAt: null },
        select: { id: true, name: true },
      })
      .catch(() => null);
    if (pastScenario?.id) {
      pastEventsForOverlay = await (prisma as any).usageSimulatorScenarioEvent
        .findMany({
          where: { scenarioId: pastScenario.id },
          select: { id: true, effectiveMonth: true, kind: true, payloadJson: true },
          orderBy: [{ effectiveMonth: "asc" }, { createdAt: "asc" }, { id: "asc" }],
        })
        .catch(() => []);
      pastTravelRanges = normalizeScenarioTravelRanges(pastEventsForOverlay as any);
    }
  }

  // NEW_BUILD_ESTIMATE completeness enforcement uses existing validators via requirements.
  const req = computeRequirements(
    {
      manualUsagePayload: manualUsagePayload as any,
      homeProfile: homeProfile as any,
      applianceProfile: applianceProfile as any,
      hasActualIntervals: actualOk,
    },
    mode,
  );
  if (!req.canRecalc) return { ok: false, error: "requirements_unmet", missingItems: req.missingItems };

  if (!homeProfile) return { ok: false, error: "homeProfile_required" };
  if (!applianceProfile?.fuelConfiguration) return { ok: false, error: "applianceProfile_required" };

  // Enforce mode->baseKind mapping (no mismatches)
  const baseKind = baseKindFromMode(mode);

  // When recalc'ing a scenario (Past/Future), use the baseline build's canonical window so scenario and Usage tab stay aligned (e.g. both Mar 2025–Feb 2026).
  let canonicalForBuild = canonical;
  let baselineInputsForRecalc: any = null;
  if (scenarioId) {
    const baselineBuild = await (prisma as any).usageSimulatorBuild
      .findUnique({
        where: { userId_houseId_scenarioKey: { userId, houseId, scenarioKey: "BASELINE" } },
        select: { buildInputs: true },
      })
      .catch(() => null);
    const baselineInputs = baselineBuild?.buildInputs as any;
    baselineInputsForRecalc = baselineInputs;
    if (
      Array.isArray(baselineInputs?.canonicalMonths) &&
      baselineInputs.canonicalMonths.length > 0 &&
      typeof baselineInputs.canonicalEndMonth === "string"
    ) {
      canonicalForBuild = {
        endMonth: baselineInputs.canonicalEndMonth,
        months: baselineInputs.canonicalMonths,
      };
    }
  }

  const travelRangesForBuild = scenarioId ? [...pastTravelRanges, ...scenarioTravelRanges] : undefined;
  const built = await buildSimulatorInputs({
    mode: mode as BuildMode,
    manualUsagePayload: manualUsagePayload as any,
    homeProfile: homeProfile as any,
    applianceProfile: applianceProfile as any,
    esiidForSmt: esiid,
    houseIdForActual: houseId,
    baselineHomeProfile: homeProfile,
    baselineApplianceProfile: applianceProfile,
    canonicalMonths: canonicalForBuild.months,
    travelRanges: travelRangesForBuild,
    now: args.now,
  });

  // Safety: built.baseKind must match mode mapping in V1
  if (built.baseKind !== baseKind) {
    return { ok: false, error: "baseKind_mismatch" };
  }

  // Overlay: source of truth = UpgradeLedger (status ACTIVE); timeline order = scenario events. V1 = delta kWh only (additive).
  let overlay: ReturnType<typeof computeMonthlyOverlay> | null = null;
  if (scenarioId) {
    let ledgerRows: Awaited<ReturnType<typeof listLedgerRows>> = [];
    try {
      ledgerRows = await listLedgerRows(userId, { scenarioId, status: "ACTIVE" });
    } catch (_) {
      // Upgrades DB optional; fall back to event-based overlay
    }
    const entries = buildOrderedLedgerEntriesForOverlay(
      scenarioEvents.map((e) => ({
        id: e.id,
        effectiveMonth: e.effectiveMonth,
        payloadJson: e.payloadJson,
      })),
      ledgerRows
    );
    if (entries.length > 0 && scenario?.name === WORKSPACE_PAST_NAME) {
      overlay = computePastOverlay({
        canonicalMonths: built.canonicalMonths,
        entries,
        baselineMonthlyKwhByMonth: built.monthlyTotalsKwhByMonth,
      });
    } else if (entries.length > 0 && scenario?.name === WORKSPACE_FUTURE_NAME) {
      overlay = computeFutureOverlay({
        canonicalMonths: built.canonicalMonths,
        entries,
        baselineMonthlyKwhByMonth: built.monthlyTotalsKwhByMonth,
      });
    }
    // Fallback: event-based overlay only when no ledger entries. computeMonthlyOverlay applies MONTHLY_ADJUSTMENT only; UPGRADE_ACTION is excluded there, so no split-brain (upgrades never apply month-only here).
    if (overlay == null) {
      overlay = computeMonthlyOverlay({
        canonicalMonths: built.canonicalMonths,
        events: scenarioEvents as any,
      });
    }
  }

  // Past overlay for Future baseline: same rule (ledger ACTIVE, event order); Past = full-year or range (Option 1).
  if (isFutureScenario && pastScenario?.id) {
    let pastLedgerRows: Awaited<ReturnType<typeof listLedgerRows>> = [];
    try {
      pastLedgerRows = await listLedgerRows(userId, { scenarioId: pastScenario.id, status: "ACTIVE" });
    } catch (_) {}
    const pastEntries = buildOrderedLedgerEntriesForOverlay(
      pastEventsForOverlay.map((e) => ({ id: e.id, effectiveMonth: e.effectiveMonth, payloadJson: e.payloadJson })),
      pastLedgerRows
    );
    if (pastEntries.length > 0) {
      pastOverlay = computePastOverlay({
        canonicalMonths: built.canonicalMonths,
        entries: pastEntries,
        baselineMonthlyKwhByMonth: built.monthlyTotalsKwhByMonth,
      });
    } else if (pastEventsForOverlay.some((e) => String(e?.kind ?? "") === "MONTHLY_ADJUSTMENT" || String(e?.kind ?? "") === "TRAVEL_RANGE")) {
      pastOverlay = computeMonthlyOverlay({ canonicalMonths: built.canonicalMonths, events: pastEventsForOverlay as any });
    }
  }

  // Past curve = baseline + any Past adjustments. If Past is never touched, Past curve = baseline. Future always uses the final Past curve as its baseline, then applies Future changes.
  let pastCurveByMonth: Record<string, number> | null = null;
  if (isFutureScenario && pastScenario?.id) {
    const pastBuild = await (prisma as any).usageSimulatorBuild
      .findUnique({
        where: { userId_houseId_scenarioKey: { userId, houseId, scenarioKey: pastScenario.id } },
        select: { buildInputs: true },
      })
      .catch(() => null);
    const pastInputs = pastBuild?.buildInputs as any;
    if (pastInputs?.monthlyTotalsKwhByMonth && typeof pastInputs.monthlyTotalsKwhByMonth === "object") {
      pastCurveByMonth = pastInputs.monthlyTotalsKwhByMonth;
    }
  }

  // Future = Past curve + Future overlay. Always prefer stored Past curve when available (that is baseline + Past adjustments as saved); else baseline + pastOverlay; else baseline.
  let monthlyTotalsKwhByMonth: Record<string, number> = {};
  for (let i = 0; i < built.canonicalMonths.length; i++) {
    const ym = built.canonicalMonths[i];
    const base = Number(built.monthlyTotalsKwhByMonth?.[ym] ?? 0) || 0;
    const storedPastKwh =
      pastCurveByMonth != null && Object.prototype.hasOwnProperty.call(pastCurveByMonth, ym)
        ? Number(pastCurveByMonth[ym])
        : undefined;
    const pastCurve: number =
      Number.isFinite(storedPastKwh)
        ? Math.max(0, storedPastKwh ?? 0)
        : pastOverlay
          ? applyMonthlyOverlay({ base, mult: pastOverlay.monthlyMultipliersByMonth?.[ym], add: pastOverlay.monthlyAddersKwhByMonth?.[ym] })
          : Math.max(0, base);
    const curveForMonth: number = Number.isFinite(pastCurve) ? pastCurve : Math.max(0, base);
    const curveNum = typeof curveForMonth === "number" && Number.isFinite(curveForMonth) ? curveForMonth : 0;
    monthlyTotalsKwhByMonth[ym] = overlay ? applyMonthlyOverlay({ base: curveNum, mult: overlay.monthlyMultipliersByMonth?.[ym], add: overlay.monthlyAddersKwhByMonth?.[ym] }) : curveForMonth;
  }

  // Month-level uplift for travel exclusions: when travel days exclude usage, uplift remaining days to fill the month.
  // Past SMT patch baseline mode uses day-level patching and must not use month-level travel uplift.
  const allTravelRanges = scenarioId ? [...pastTravelRanges, ...scenarioTravelRanges] : [];
  const isPastSmtPatchMode = scenario?.name === WORKSPACE_PAST_NAME && mode === "SMT_BASELINE";
  if (allTravelRanges.length > 0 && !isPastSmtPatchMode) {
    const excludeSet = new Set(travelRangesToExcludeDateKeys(allTravelRanges));
    for (const ym of built.canonicalMonths) {
      const [y, m] = ym.split("-").map(Number);
      if (!Number.isFinite(y) || !Number.isFinite(m) || m < 1 || m > 12) continue;
      const daysInMonth = new Date(y, m, 0).getDate();
      let travelDays = 0;
      for (let d = 1; d <= daysInMonth; d++) {
        const key = `${y}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
        if (excludeSet.has(key)) travelDays++;
      }
      const nonTravelDays = daysInMonth - travelDays;
      if (travelDays > 0 && nonTravelDays <= 0) {
        return { ok: false, error: "travel_exclusions_cover_full_range" };
      }
      const baseMonthKwh = monthlyTotalsKwhByMonth[ym] ?? 0;
      if (baseMonthKwh > 0 && nonTravelDays > 0) {
        const factor = daysInMonth / nonTravelDays;
        monthlyTotalsKwhByMonth[ym] = baseMonthKwh * factor;
      }
    }
  }

  const notes = [...(built.notes ?? [])];
  if (scenarioId) {
    notes.push(`Scenario applied: ${scenario?.name ?? scenarioId}`);
    if ((overlay?.inactiveEventIds?.length ?? 0) > 0) notes.push(`Scenario: ${overlay!.inactiveEventIds.length} inactive event(s).`);
    if ((overlay?.warnings?.length ?? 0) > 0) notes.push(`Scenario: ${overlay!.warnings.length} warning(s).`);
  }
  if (isFutureScenario) {
    if (pastCurveByMonth != null || pastOverlay) {
      notes.push(`Future base: ${WORKSPACE_PAST_NAME} (Past curve = baseline + Past adjustments)`);
      if (pastOverlay) {
        if ((pastOverlay.inactiveEventIds?.length ?? 0) > 0) notes.push(`Past: ${pastOverlay.inactiveEventIds.length} inactive event(s).`);
        if ((pastOverlay.warnings?.length ?? 0) > 0) notes.push(`Past: ${pastOverlay.warnings.length} warning(s).`);
      }
    } else {
      notes.push("Future base: Past curve (= baseline; no Past adjustments)");
    }
  }

  const weatherPreference: WeatherPreference = args.weatherPreference ?? "NONE";
  const weatherNorm = normalizeMonthlyTotals({
    canonicalMonths: built.canonicalMonths,
    monthlyTotalsKwhByMonth,
    preference: weatherPreference,
  });
  monthlyTotalsKwhByMonth = weatherNorm.monthlyTotalsKwhByMonth;
  for (const n of weatherNorm.notes) notes.push(n);

  const versions = {
    estimatorVersion: "v1",
    reshapeCoeffVersion: "v1",
    intradayTemplateVersion: INTRADAY_TEMPLATE_VERSION,
    smtShapeDerivationVersion: SMT_SHAPE_DERIVATION_VERSION,
    weatherNormalizerVersion: WEATHER_NORMALIZER_VERSION,
  };

  const manualCanonicalPeriods =
    mode === "MANUAL_TOTALS" && manualUsagePayload
      ? (() => {
          const p = manualUsagePayload as any;
          const endKey =
            typeof p.anchorEndDate === "string" && /^\d{4}-\d{2}-\d{2}$/.test(p.anchorEndDate)
              ? String(p.anchorEndDate)
              : typeof p.endDate === "string" && /^\d{4}-\d{2}-\d{2}$/.test(p.endDate)
                ? String(p.endDate)
                : typeof p.anchorEndMonth === "string" && /^\d{4}-\d{2}$/.test(p.anchorEndMonth)
                  ? (anchorEndDateUtc(String(p.anchorEndMonth), Number(p.billEndDay) || 15)?.toISOString().slice(0, 10) ?? null)
                  : null;
          return endKey ? billingPeriodsEndingAt(endKey, 12) : [];
        })()
      : [];

  // SMT_BASELINE: use actual data's date range (anchor) so Baseline, Past, and Future all show the same dates (e.g. 02/18/2025 – 02/18/2026).
  let smtAnchorPeriods: Array<{ id: string; startDate: string; endDate: string }> | undefined;
  if (mode === "SMT_BASELINE") {
    try {
      const actualResult = await getActualUsageDatasetForHouse(houseId, esiid ?? null);
      const start = actualResult?.dataset?.summary?.start ? String(actualResult.dataset.summary.start).slice(0, 10) : null;
      const end = actualResult?.dataset?.summary?.end ? String(actualResult.dataset.summary.end).slice(0, 10) : null;
      if (start && end && /^\d{4}-\d{2}-\d{2}$/.test(start) && /^\d{4}-\d{2}-\d{2}$/.test(end)) {
        smtAnchorPeriods = [{ id: "anchor", startDate: start, endDate: end }];
      }
    } catch {
      smtAnchorPeriods = undefined;
    }
  }

  // Past with actual source: patch baseline by simulating only excluded + leading-missing days.
  /** Timezone for Past sim and stored build; set when building Past so getPastSimulatedDatasetForHouse and cache use same. */
  let timezoneForStoredBuild = (baselineInputsForRecalc as any)?.timezone ?? "America/Chicago";
  let pastSimulatedMonths: string[] | undefined;
  let pastPatchedCurve: SimulatedCurve | null = null;
  let pastSimulatedDayResults: SimulatedDayResult[] | undefined;
  if (
    scenario?.name === WORKSPACE_PAST_NAME &&
    mode === "SMT_BASELINE"
  ) {
    try {
      const canonicalWindow = canonicalWindowDateRange(built.canonicalMonths);
      const startDate = smtAnchorPeriods?.[0]?.startDate ?? canonicalWindow?.start ?? `${built.canonicalMonths[0]}-01`;
      const endDate =
        smtAnchorPeriods?.[smtAnchorPeriods.length - 1]?.endDate ??
        canonicalWindow?.end ??
        `${built.canonicalMonths[built.canonicalMonths.length - 1]}-28`;
      const recalcBuildInputs: SimulatorBuildInputsV1 = {
        version: 1,
        mode,
        baseKind: built.baseKind,
        canonicalEndMonth: built.canonicalMonths[built.canonicalMonths.length - 1] ?? "",
        canonicalMonths: built.canonicalMonths,
        monthlyTotalsKwhByMonth: built.monthlyTotalsKwhByMonth,
        intradayShape96: built.intradayShape96,
        notes: built.notes ?? [],
        filledMonths: built.filledMonths ?? [],
        snapshots: { homeProfile, applianceProfile },
      };
      const result = await simulatePastUsageDataset({
        houseId,
        userId,
        esiid: esiid ?? null,
        startDate,
        endDate,
        timezone: timezoneForStoredBuild,
        travelRanges: allTravelRanges,
        buildInputs: recalcBuildInputs,
        buildPathKind: "recalc",
      });
      if (result.dataset !== null && result.stitchedCurve) {
        pastPatchedCurve = result.stitchedCurve;
        pastSimulatedDayResults = result.simulatedDayResults;
        const byMonth: Record<string, number> = {};
        for (const m of result.stitchedCurve.monthlyTotals) {
          const ym = String(m?.month ?? "").trim();
          if (/^\d{4}-\d{2}$/.test(ym) && typeof m?.kwh === "number" && Number.isFinite(m.kwh)) byMonth[ym] = m.kwh;
        }
        if (Object.keys(byMonth).length > 0) monthlyTotalsKwhByMonth = byMonth;
        pastSimulatedMonths = [];
        notes.push("Past: baseline patched for excluded + leading-missing days");
      }
    } catch (e) {
      console.warn("[usageSimulator] Past stitched curve failed, using monthly curve", e);
    }
  }

  const buildInputs: SimulatorBuildInputsV1 & {
    scenarioKey?: string;
    scenarioId?: string | null;
    versions?: typeof versions;
    pastSimulatedMonths?: string[];
    timezone?: string;
  } = {
    version: 1,
    mode,
    baseKind,
    canonicalEndMonth: canonicalForBuild.endMonth,
    canonicalMonths: built.canonicalMonths,
    canonicalPeriods: manualCanonicalPeriods.length ? manualCanonicalPeriods : smtAnchorPeriods ?? undefined,
    weatherPreference,
    weatherNormalizerVersion: WEATHER_NORMALIZER_VERSION,
    monthlyTotalsKwhByMonth,
    intradayShape96: built.intradayShape96,
    weekdayWeekendShape96: built.weekdayWeekendShape96,
    travelRanges: scenarioId ? [...pastTravelRanges, ...scenarioTravelRanges] : [],
    timezone: timezoneForStoredBuild,
    notes,
    filledMonths: built.filledMonths,
    ...(pastSimulatedMonths != null ? { pastSimulatedMonths } : {}),
    snapshots: {
      manualUsagePayload: manualUsagePayload ?? null,
      homeProfile,
      applianceProfile,
      baselineHomeProfile: homeProfile,
      baselineApplianceProfile: applianceProfile,
      actualSource: built.source?.actualSource ?? actualSource ?? undefined,
      actualMonthlyAnchorsByMonth: built.source?.actualMonthlyAnchorsByMonth ?? undefined,
      actualIntradayShape96: built.source?.actualIntradayShape96 ?? undefined,
      smtMonthlyAnchorsByMonth: built.source?.smtMonthlyAnchorsByMonth ?? undefined,
      smtIntradayShape96: built.source?.smtIntradayShape96 ?? undefined,
      scenario: scenario ? { id: scenario.id, name: scenario.name } : null,
      scenarioEvents: scenarioEvents ?? [],
      scenarioOverlay: overlay ?? null,
      pastScenario: pastOverlay ? pastScenario : null,
      pastScenarioEvents: pastOverlay ? pastEventsForOverlay : [],
    } as any,
    scenarioKey,
    scenarioId,
    versions,
  };

  // V1 hash: stable JSON of a deterministic object.
  const eventsForHash = (pastOverlay ? [...pastEventsForOverlay, ...(scenarioEvents ?? [])] : (scenarioEvents ?? []))
    .map((e) => {
      const p = (e as any)?.payloadJson ?? {};
      const multiplier = typeof p?.multiplier === "number" && Number.isFinite(p.multiplier) ? p.multiplier : null;
      const adderKwh = typeof p?.adderKwh === "number" && Number.isFinite(p.adderKwh) ? p.adderKwh : null;
      const startDate = typeof p?.startDate === "string" ? String(p.startDate).slice(0, 10) : null;
      const endDate = typeof p?.endDate === "string" ? String(p.endDate).slice(0, 10) : null;
      return {
        id: String(e?.id ?? ""),
        effectiveMonth: String(e?.effectiveMonth ?? ""),
        kind: String(e?.kind ?? ""),
        multiplier,
        adderKwh,
        startDate,
        endDate,
      };
    })
    .sort((a, b) => {
      if (a.effectiveMonth !== b.effectiveMonth) return a.effectiveMonth < b.effectiveMonth ? -1 : 1;
      if (a.kind !== b.kind) return a.kind < b.kind ? -1 : 1;
      return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
    });

  const buildInputsHash = computeBuildInputsHash({
    canonicalMonths: buildInputs.canonicalMonths,
    mode: buildInputs.mode,
    baseKind: buildInputs.baseKind,
    scenarioKey,
    baseScenarioKey: pastOverlay ? String(pastScenario?.id ?? "") : null,
    scenarioEvents: eventsForHash,
    weatherPreference,
    versions,
  });

  const dataset =
    pastPatchedCurve != null
      ? buildSimulatedUsageDatasetFromCurve(pastPatchedCurve, {
          baseKind: buildInputs.baseKind,
          mode: buildInputs.mode,
          canonicalEndMonth: buildInputs.canonicalEndMonth,
          notes: buildInputs.notes,
          filledMonths: buildInputs.filledMonths,
        }, {
          timezone: (buildInputs as any).timezone ?? undefined,
          useUtcMonth: true,
          simulatedDayResults: pastSimulatedDayResults,
        })
      : buildSimulatedUsageDatasetFromBuildInputs(buildInputs);
  const filledSet = new Set<string>((buildInputs.filledMonths ?? []).map(String));
  const monthProvenanceByMonth: Record<string, "ACTUAL" | "SIMULATED"> = {};
  for (const ym of buildInputs.canonicalMonths ?? []) {
    monthProvenanceByMonth[String(ym)] =
      mode === "SMT_BASELINE" && !scenarioId && !filledSet.has(String(ym)) ? "ACTUAL" : "SIMULATED";
  }
  dataset.meta = {
    ...(dataset.meta ?? {}),
    buildInputsHash,
    lastBuiltAt: new Date().toISOString(),
    scenarioKey,
    scenarioId,
    monthProvenanceByMonth,
    actualSource: built.source?.actualSource ?? actualSource ?? null,
  };

  await upsertSimulatorBuild({
    userId,
    houseId,
    scenarioKey,
    mode,
    baseKind,
    canonicalEndMonth: buildInputs.canonicalEndMonth,
    canonicalMonths: buildInputs.canonicalMonths,
    buildInputs,
    buildInputsHash,
    versions,
  });

  // Persist usage buckets for Past/Future so plan costing can use simulated usage.
  if (
    scenarioKey !== "BASELINE" &&
    dataset?.usageBucketsByMonth &&
    Object.keys(dataset.usageBucketsByMonth).length > 0
  ) {
    await upsertSimulatedUsageBuckets({
      homeId: houseId,
      scenarioKey,
      scenarioId: scenarioId ?? null,
      usageBucketsByMonth: dataset.usageBucketsByMonth,
    }).catch(() => {});
  }

  const shouldPersistPastSeries =
    args.persistPastSimBaseline === true &&
    mode === "SMT_BASELINE" &&
    scenario?.name === WORKSPACE_PAST_NAME;
  if (shouldPersistPastSeries) {
    const intervals15 = Array.isArray(dataset?.series?.intervals15) ? dataset.series.intervals15 : [];
    if (intervals15.length > 0) {
      const validIntervals = intervals15
        .map((row: any) => {
          const tsUtc = String(row?.timestamp ?? "");
          const tsDate = new Date(tsUtc);
          if (!Number.isFinite(tsDate.getTime())) return null;
          return {
            tsUtc,
            tsDate,
            kwh: Number(row?.kwh ?? 0),
          };
        })
        .filter((row: { tsUtc: string; tsDate: Date; kwh: number } | null): row is { tsUtc: string; tsDate: Date; kwh: number } => row != null)
        .sort((a, b) => a.tsDate.getTime() - b.tsDate.getTime());
      if (validIntervals.length > 0) {
        const derivationVersion = String(
          (buildInputs as any)?.versions?.smtShapeDerivationVersion ??
            (buildInputs as any)?.versions?.intradayTemplateVersion ??
            "v1"
        );
        try {
          await saveIntervalSeries15m({
            userId,
            houseId,
            kind: IntervalSeriesKind.PAST_SIM_BASELINE,
            scenarioId,
            anchorStartUtc: validIntervals[0].tsDate,
            anchorEndUtc: validIntervals[validIntervals.length - 1].tsDate,
            derivationVersion,
            buildInputsHash,
            intervals15: validIntervals.map((row) => ({ tsUtc: row.tsUtc, kwh: row.kwh })),
          });
        } catch (e) {
          // Persistence of derived interval artifacts must not block recalc responses.
          console.error("[usageSimulator/service] failed to persist PAST_SIM_BASELINE interval series", {
            userId,
            houseId,
            scenarioId,
            error: e instanceof Error ? e.message : String(e),
          });
        }
      }
    }
  }

  return { ok: true, houseId, buildInputsHash, dataset };
}

export type SimulatedUsageHouseRow = {
  houseId: string;
  label: string | null;
  address: { line1: string; city: string | null; state: string | null };
  esiid: string | null;
  dataset: any | null;
  alternatives: { smt: null; greenButton: null };
  datasetError?: {
    code: string;
    explanation: string;
  } | null;
};

/**
 * Builds the same Past stitched dataset that production "Past simulated usage" UI uses.
 * Uses actual intervals for the window and simulated fill only for excluded (travel/vacant) days.
 * Single canonical source for lab parity: lab must call this (not buildSimulatedUsageDatasetFromBuildInputs).
 */
export async function getPastSimulatedDatasetForHouse(args: {
  userId: string;
  houseId: string;
  esiid: string | null;
  travelRanges: Array<{ startDate: string; endDate: string }>;
  buildInputs: SimulatorBuildInputsV1;
  startDate: string;
  endDate: string;
  /** When set, excluded days use weekday/weekend avg from UsageShapeProfile (local timezone). */
  timezone?: string;
  /** Optional: cold_build (default), recalc, or lab_validation. */
  buildPathKind?: "cold_build" | "recalc" | "lab_validation";
  /** Explicit caller intent; defaults true to preserve current behavior. */
  includeSimulatedDayResults?: boolean;
}): Promise<
  | {
      dataset: Awaited<ReturnType<typeof buildSimulatedUsageDatasetFromCurve>>;
      simulatedDayResults?: SimulatedDayResult[];
      error?: undefined;
    }
  | { dataset: null; error: string }
> {
  const {
    userId,
    houseId,
    esiid,
    travelRanges,
    buildInputs,
    startDate,
    endDate,
    timezone,
    buildPathKind = "cold_build",
    includeSimulatedDayResults = true,
  } = args;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(startDate) || !/^\d{4}-\d{2}-\d{2}$/.test(endDate)) {
    return { dataset: null, error: "Invalid startDate or endDate (expect YYYY-MM-DD)." };
  }
  try {
    const result = await simulatePastUsageDataset({
      houseId,
      userId,
      esiid,
      startDate,
      endDate,
      timezone,
      travelRanges,
      buildInputs,
      buildPathKind,
      includeSimulatedDayResults,
    });
    if (result.dataset === null) {
      return { dataset: null, error: (result as { error: string }).error ?? "simulatePastUsageDataset failed" };
    }
    const dataset = result.dataset;
    // Keep cold build on the stitched saved artifact only; no second overlay pass.
    const actualWxByDateKey = result.actualWxByDateKey;
    if (dataset && actualWxByDateKey && actualWxByDateKey.size > 0) {
      (dataset as any).dailyWeather = Object.fromEntries(
        Array.from(actualWxByDateKey.entries()).map(([dateKey, w]) => [
          dateKey,
          {
            tAvgF: w.tAvgF,
            tMinF: w.tMinF,
            tMaxF: w.tMaxF,
            hdd65: w.hdd65,
            cdd65: w.cdd65,
            source: String(w?.source ?? "").trim() || "unknown",
          },
        ])
      );
    }
    return { dataset, simulatedDayResults: result.simulatedDayResults };
  } catch (e) {
    const err = e instanceof Error ? e : new Error(String(e));
    console.warn("[usageSimulator/service] getPastSimulatedDatasetForHouse failed", { houseId, err: e });
    return { dataset: null, error: err.message };
  }
}

export async function getSimulatedUsageForUser(args: {
  userId: string;
}): Promise<{ ok: true; houses: SimulatedUsageHouseRow[] } | { ok: false; error: string }> {
  try {
    const houses = await listHouseAddressesForUser({ userId: args.userId });

    const results: SimulatedUsageHouseRow[] = [];
    for (let i = 0; i < houses.length; i++) {
      const h = houses[i];
      const buildRec = await (prisma as any).usageSimulatorBuild
        .findUnique({
          where: { userId_houseId_scenarioKey: { userId: args.userId, houseId: h.id, scenarioKey: "BASELINE" } },
          select: { buildInputs: true, buildInputsHash: true, lastBuiltAt: true },
        })
        .catch(() => null);

      let dataset: any | null = null;
      let datasetError: { code: string; explanation: string } | null = null;
      if (buildRec?.buildInputs) {
        try {
          const buildInputs = buildRec.buildInputs as SimulatorBuildInputsV1;
          const mode = (buildInputs as any).mode;
          const actualSource = (buildInputs as any)?.snapshots?.actualSource ?? null;
          const useActualBaseline =
            mode === "SMT_BASELINE" &&
            (actualSource === "SMT" || actualSource === "GREEN_BUTTON");

          if (useActualBaseline) {
            const actualResult = await getActualUsageDatasetForHouse(h.id, h.esiid ?? null);
            if (actualResult?.dataset) {
              const filledSet = new Set<string>(((buildInputs as any).filledMonths ?? []).map(String));
              const monthProvenanceByMonth: Record<string, "ACTUAL" | "SIMULATED"> = {};
              const canonicalMonths = (buildInputs as any).canonicalMonths ?? [];
              for (const ym of canonicalMonths) {
                monthProvenanceByMonth[String(ym)] =
                  !filledSet.has(String(ym)) ? "ACTUAL" : "SIMULATED";
              }
              const actualSummary = actualResult.dataset.summary ?? {};
              dataset = {
                ...actualResult.dataset,
                summary: {
                  ...actualSummary,
                  source: "SIMULATED" as const,
                },
                meta: {
                  buildInputsHash: String(buildRec.buildInputsHash ?? ""),
                  lastBuiltAt: buildRec.lastBuiltAt ? new Date(buildRec.lastBuiltAt).toISOString() : null,
                  datasetKind: "SIMULATED" as const,
                  monthProvenanceByMonth,
                  actualSource,
                },
              };
              // Keep actual monthly as source of truth so simulation page Usage matches Usage dashboard.
              // Do not overwrite with build's curve-based monthly (ensureBaselineMonthlyFromBuild).
            }
          }
          if (!dataset) {
            dataset = buildSimulatedUsageDatasetFromBuildInputs(buildInputs);
            const monthProvenanceByMonth: Record<string, "ACTUAL" | "SIMULATED"> = {};
            // This branch always returns simulated data (built curve); mark all months as SIMULATED for correct provenance.
            for (const ym of (buildInputs as any).canonicalMonths ?? []) {
              monthProvenanceByMonth[String(ym)] = "SIMULATED";
            }
            dataset.meta = {
              ...(dataset.meta ?? {}),
              buildInputsHash: String(buildRec.buildInputsHash ?? ""),
              lastBuiltAt: buildRec.lastBuiltAt ? new Date(buildRec.lastBuiltAt).toISOString() : null,
              monthProvenanceByMonth,
              actualSource: (buildInputs as any)?.snapshots?.actualSource ?? null,
            };
          }
        } catch (error) {
          const classification = classifySimulationFailure({
            code: "INTERNAL_ERROR",
            message: String((error as any)?.message ?? "simulated dataset build failed"),
          });
          if (classification.shouldAlert) {
            await recordSimulationDataAlert({
              source: "USER_SIMULATION",
              userId: args.userId,
              houseId: h.id,
              houseLabel: h.label || h.addressLine1 || h.id,
              reasonCode: classification.reasonCode,
              reasonMessage: classification.reasonMessage,
              missingData: classification.missingData,
              context: { stage: "getSimulatedUsageForUser" },
            });
          }
          datasetError = {
            code: "SIM_BUILD_FAILED",
            explanation:
              "We could not rebuild this simulated dataset because required inputs were unavailable or invalid.",
          };
          dataset = null;
        }
      }

      if (dataset && Array.isArray(dataset.daily) && dataset.daily.length > 0 && !dataset.dailyWeather) {
        try {
          const dateKeys = dataset.daily.map((d: { date: string }) => d.date);
          const wxMap = await getHouseWeatherDays({
            houseId: h.id,
            dateKeys,
            kind: "ACTUAL_LAST_YEAR",
          });
          if (wxMap.size > 0) {
            (dataset as any).dailyWeather = Object.fromEntries(
              Array.from(wxMap.entries()).map(([dateKey, w]) => [
                dateKey,
                { tAvgF: w.tAvgF, tMinF: w.tMinF, tMaxF: w.tMaxF, hdd65: w.hdd65, cdd65: w.cdd65 },
              ])
            );
          }
        } catch {
          // optional: leave dailyWeather unset
        }
      }

      results.push({
        houseId: h.id,
        label: h.label || h.addressLine1,
        address: { line1: h.addressLine1, city: h.addressCity, state: h.addressState },
        esiid: h.esiid,
        dataset,
        alternatives: { smt: null, greenButton: null },
        datasetError,
      });
    }

    return { ok: true, houses: results };
  } catch (e) {
    console.error("[usageSimulator/service] getSimulatedUsageForUser failed", e);
    return { ok: false, error: "Internal error" };
  }
}

export async function getSimulatedUsageForHouseScenario(args: {
  userId: string;
  houseId: string;
  scenarioId?: string | null;
  readMode?: "artifact_only" | "allow_rebuild";
}): Promise<
  | { ok: true; houseId: string; scenarioKey: string; scenarioId: string | null; dataset: any }
  | {
      ok: false;
      code: "NO_BUILD" | "SCENARIO_NOT_FOUND" | "HOUSE_NOT_FOUND" | "INTERNAL_ERROR" | "ARTIFACT_MISSING";
      message: string;
      inputHash?: string;
      engineVersion?: string;
    }
> {
  try {
    const scenarioKey = normalizeScenarioKey(args.scenarioId);
    const scenarioId = scenarioKey === "BASELINE" ? null : scenarioKey;
    const readMode = args.readMode ?? "allow_rebuild";

    const house = await getHouseAddressForUserHouse({ userId: args.userId, houseId: args.houseId });
    if (!house) return { ok: false, code: "HOUSE_NOT_FOUND", message: "House not found for user" };

    if (readMode === "artifact_only") {
      const scenarioIdForCache = scenarioId ?? "BASELINE";
      // Backward-compatible artifact-only support for gapfill_lab, which does not have a usageSimulatorBuild row.
      if (scenarioIdForCache === "gapfill_lab") {
        const latestCached = await getLatestCachedPastDatasetByScenario({
          houseId: args.houseId,
          scenarioId: scenarioIdForCache,
        });
        if (!latestCached || latestCached.intervalsCodec !== INTERVAL_CODEC_V1) {
          return {
            ok: false,
            code: "ARTIFACT_MISSING",
            message: "Persisted artifact not found for this house/scenario. Run explicit rebuild first.",
            engineVersion: PAST_ENGINE_VERSION,
          };
        }
        const decoded = decodeIntervalsV1(latestCached.intervalsCompressed);
        const restored = {
          ...latestCached.datasetJson,
          series: {
            ...(typeof (latestCached.datasetJson as any).series === "object" &&
            (latestCached.datasetJson as any).series !== null
              ? (latestCached.datasetJson as any).series
              : {}),
            intervals15: decoded,
          },
        };
        reconcileRestoredDatasetFromDecodedIntervals({
          dataset: restored,
          decodedIntervals: decoded,
          fallbackEndDate: String((latestCached.datasetJson as any)?.summary?.end ?? "").slice(0, 10),
        });
        const restoredAny = restored as any;
        if (!restoredAny.meta || typeof restoredAny.meta !== "object") restoredAny.meta = {};
        restoredAny.meta.artifactReadMode = "artifact_only";
        restoredAny.meta.artifactSource = "past_cache";
        restoredAny.meta.artifactInputHash = latestCached.inputHash;
        restoredAny.meta.artifactUpdatedAt = latestCached.updatedAt
          ? latestCached.updatedAt.toISOString()
          : null;
        restoredAny.meta.artifactRecomputed = false;
        const quality = validateSharedSimQuality(restored);
        if (!quality.ok) {
          await reportSimulationDataIssue({
            source: "GAPFILL_LAB",
            userId: args.userId,
            houseId: args.houseId,
            scenarioId,
            code: "INTERNAL_ERROR",
            message: quality.message,
            context: { readMode: "artifact_only" },
          });
          return { ok: false, code: "INTERNAL_ERROR", message: quality.message };
        }
        return { ok: true, houseId: args.houseId, scenarioKey, scenarioId, dataset: restored };
      }

      const buildRec = await (prisma as any).usageSimulatorBuild
        .findUnique({
          where: { userId_houseId_scenarioKey: { userId: args.userId, houseId: args.houseId, scenarioKey } },
          select: { buildInputs: true },
        })
        .catch(() => null);
      if (!buildRec?.buildInputs) {
        return {
          ok: false,
          code: "ARTIFACT_MISSING",
          message: "Persisted artifact not found for this house/scenario identity. Run explicit rebuild first.",
          engineVersion: PAST_ENGINE_VERSION,
        };
      }

      const buildInputs = buildRec.buildInputs as Record<string, unknown>;
      const window = resolveWindowFromBuildInputsForPastIdentity(buildInputs);
      if (!window) {
        return {
          ok: false,
          code: "ARTIFACT_MISSING",
          message: "Persisted artifact identity window is unavailable for this house/scenario.",
          engineVersion: PAST_ENGINE_VERSION,
        };
      }
      const travelRanges = (Array.isArray((buildInputs as any)?.travelRanges) ? (buildInputs as any).travelRanges : []) as Array<{ startDate: string; endDate: string }>;
      const timezone = String((buildInputs as any)?.timezone ?? "America/Chicago");
      const intervalDataFingerprint = await getIntervalDataFingerprint({
        houseId: args.houseId,
        esiid: house.esiid ?? null,
        startDate: window.startDate,
        endDate: window.endDate,
      });
      const usageShapeProfileIdentity = await getUsageShapeProfileIdentityForPast(args.houseId);
      const weatherIdentity = await computePastWeatherIdentity({
        houseId: args.houseId,
        startDate: window.startDate,
        endDate: window.endDate,
      });
      const inputHash = computePastInputHash({
        engineVersion: PAST_ENGINE_VERSION,
        windowStartUtc: window.startDate,
        windowEndUtc: window.endDate,
        timezone,
        travelRanges,
        buildInputs: buildInputs as Record<string, unknown>,
        intervalDataFingerprint,
        usageShapeProfileId: usageShapeProfileIdentity.usageShapeProfileId,
        usageShapeProfileVersion: usageShapeProfileIdentity.usageShapeProfileVersion,
        usageShapeProfileDerivedAt: usageShapeProfileIdentity.usageShapeProfileDerivedAt,
        usageShapeProfileSimHash: usageShapeProfileIdentity.usageShapeProfileSimHash,
        weatherIdentity,
      });

      const exactCached = await getCachedPastDataset({
        houseId: args.houseId,
        scenarioId: scenarioIdForCache,
        inputHash,
      });
      if (!exactCached || exactCached.intervalsCodec !== INTERVAL_CODEC_V1) {
        return {
          ok: false,
          code: "ARTIFACT_MISSING",
          message: "Persisted artifact not found for this house/scenario identity. Run explicit rebuild first.",
          inputHash,
          engineVersion: PAST_ENGINE_VERSION,
        };
      }
      const decoded = decodeIntervalsV1(exactCached.intervalsCompressed);
      const restored = {
        ...exactCached.datasetJson,
        series: {
          ...(typeof (exactCached.datasetJson as any).series === "object" &&
          (exactCached.datasetJson as any).series !== null
            ? (exactCached.datasetJson as any).series
            : {}),
          intervals15: decoded,
        },
      };
      reconcileRestoredDatasetFromDecodedIntervals({
        dataset: restored,
        decodedIntervals: decoded,
        fallbackEndDate: window.endDate,
      });
      const restoredAny = restored as any;
      if (!restoredAny.meta || typeof restoredAny.meta !== "object") restoredAny.meta = {};
      restoredAny.meta.artifactReadMode = "artifact_only";
      restoredAny.meta.artifactSource = "past_cache";
      restoredAny.meta.artifactInputHash = inputHash;
      restoredAny.meta.artifactRecomputed = false;
      const quality = validateSharedSimQuality(restored);
      if (!quality.ok) {
        await reportSimulationDataIssue({
          source: "USER_SIMULATION",
          userId: args.userId,
          houseId: args.houseId,
          scenarioId,
          code: "INTERNAL_ERROR",
          message: quality.message,
          context: { readMode: "artifact_only" },
        });
        return { ok: false, code: "INTERNAL_ERROR", message: quality.message };
      }
      return { ok: true, houseId: args.houseId, scenarioKey, scenarioId, dataset: restored };
    }

    let scenarioRow: { id: string; name: string } | null = null;
    if (scenarioId) {
      scenarioRow = await (prisma as any).usageSimulatorScenario
        .findFirst({
          where: { id: scenarioId, userId: args.userId, houseId: args.houseId, archivedAt: null },
          select: { id: true, name: true },
        })
        .catch(() => null);
      if (!scenarioRow) return { ok: false, code: "SCENARIO_NOT_FOUND", message: "Scenario not found for user/house" };
    }

    // Future always recomputed from current Past (or Baseline when no Past): no cache. Every time Future is opened we recalc so it uses the latest Past curve.
    const isFutureScenarioForRecalc = Boolean(scenarioId) && scenarioRow?.name === WORKSPACE_FUTURE_NAME;
    if (isFutureScenarioForRecalc) {
      const baselineBuild = await (prisma as any).usageSimulatorBuild
        .findUnique({
          where: { userId_houseId_scenarioKey: { userId: args.userId, houseId: args.houseId, scenarioKey: "BASELINE" } },
          select: { buildInputs: true },
        })
        .catch(() => null);
      let mode = (baselineBuild?.buildInputs as any)?.mode;
      let weatherPreference = (baselineBuild?.buildInputs as any)?.weatherPreference ?? "NONE";
      if (!mode) {
        const existingFuture = await (prisma as any).usageSimulatorBuild
          .findUnique({
            where: { userId_houseId_scenarioKey: { userId: args.userId, houseId: args.houseId, scenarioKey } },
            select: { buildInputs: true },
          })
          .catch(() => null);
        mode = (existingFuture?.buildInputs as any)?.mode;
        if ((existingFuture?.buildInputs as any)?.weatherPreference != null) weatherPreference = (existingFuture.buildInputs as any).weatherPreference;
      }
      if (mode) {
        const recalcResult = await recalcSimulatorBuild({
          userId: args.userId,
          houseId: args.houseId,
          esiid: house.esiid ?? null,
          mode,
          scenarioId,
          weatherPreference,
        });
        if (!recalcResult.ok) {
          return {
            ok: false,
            code: "INTERNAL_ERROR",
            message: recalcResult.error ?? "Failed to update Future from latest Past.",
          };
        }
      }
    }

    const buildRec = await (prisma as any).usageSimulatorBuild
      .findUnique({
        where: { userId_houseId_scenarioKey: { userId: args.userId, houseId: args.houseId, scenarioKey } },
        select: { buildInputs: true, buildInputsHash: true, lastBuiltAt: true },
      })
      .catch(() => null);
    if (!buildRec?.buildInputs) {
      return { ok: false, code: "NO_BUILD", message: "Recalculate to generate this scenario." };
    }

    const buildInputs = buildRec.buildInputs as SimulatorBuildInputsV1;
    const mode = (buildInputs as any).mode;
    const actualSource = (buildInputs as any)?.snapshots?.actualSource ?? null;
    const snapshotScenarioName = String((buildInputs as any)?.snapshots?.scenario?.name ?? "");
    const isSmtBaselineMode = mode === "SMT_BASELINE";
    const isFutureWorkspaceScenario =
      Boolean(scenarioId) &&
      (scenarioRow?.name === WORKSPACE_FUTURE_NAME || snapshotScenarioName === WORKSPACE_FUTURE_NAME);
    // Treat any non-baseline, non-future scenario as Past to avoid brittle name-only gating.
    const isPastScenario = Boolean(scenarioId) && !isFutureWorkspaceScenario;
    const useActualBaseline =
      scenarioKey === "BASELINE" &&
      isSmtBaselineMode;

    // Backfill house weather for the usage window (e.g. 366 days) when missing; runs on every simulated fetch.
    const canonicalMonthsForWx = (buildInputs as any).canonicalMonths ?? [];
    const windowForWx = canonicalMonthsForWx.length > 0 ? canonicalWindowDateRange(canonicalMonthsForWx) : null;
    if (windowForWx?.start && windowForWx?.end) {
      ensureHouseWeatherBackfill({
        houseId: args.houseId,
        startDate: windowForWx.start,
        endDate: windowForWx.end,
      }).catch(() => {});
    }

    let dataset: any;
    if (useActualBaseline) {
      const actualResult = await getActualUsageDatasetForHouse(args.houseId, house.esiid ?? null);
      if (actualResult?.dataset) {
        const filledSet = new Set<string>(((buildInputs as any).filledMonths ?? []).map(String));
        const monthProvenanceByMonth: Record<string, "ACTUAL" | "SIMULATED"> = {};
        const canonicalMonths = (buildInputs as any).canonicalMonths ?? [];
        for (const ym of canonicalMonths) {
          monthProvenanceByMonth[String(ym)] = !filledSet.has(String(ym)) ? "ACTUAL" : "SIMULATED";
        }
        const actualSummary = actualResult.dataset.summary ?? {};
        const summarySource = actualSummary.source === "SMT" || actualSummary.source === "GREEN_BUTTON" ? actualSummary.source : (actualSource === "SMT" || actualSource === "GREEN_BUTTON" ? actualSource : "SIMULATED");
        dataset = {
          ...actualResult.dataset,
          summary: {
            ...actualSummary,
            source: summarySource as "SMT" | "GREEN_BUTTON" | "SIMULATED",
          },
          meta: {
            buildInputsHash: String(buildRec.buildInputsHash ?? ""),
            lastBuiltAt: buildRec.lastBuiltAt ? new Date(buildRec.lastBuiltAt).toISOString() : null,
            datasetKind: summarySource === "SIMULATED" ? ("SIMULATED" as const) : ("ACTUAL" as const),
            scenarioKey,
            scenarioId,
            monthProvenanceByMonth,
            actualSource,
          },
        };
        // Keep actual monthly as source of truth so simulation page Usage matches Usage dashboard.
        // Do not call ensureBaselineMonthlyFromBuild when we have actual data.
      } else {
        // Actual fetch failed; for SMT_BASELINE BASELINE, use filledSet: unfilled ACTUAL, filled SIMULATED (aligns with else-branch).
        dataset = buildSimulatedUsageDatasetFromBuildInputs(buildInputs);
        const filledSet = new Set<string>(((buildInputs as any).filledMonths ?? []).map(String));
        const monthProvenanceByMonth: Record<string, "ACTUAL" | "SIMULATED"> = {};
        for (const ym of (buildInputs as any).canonicalMonths ?? []) {
          monthProvenanceByMonth[String(ym)] =
            mode === "SMT_BASELINE" && scenarioKey === "BASELINE" && !filledSet.has(String(ym)) ? "ACTUAL" : "SIMULATED";
        }
        dataset.meta = {
          ...(dataset.meta ?? {}),
          buildInputsHash: String(buildRec.buildInputsHash ?? ""),
          lastBuiltAt: buildRec.lastBuiltAt ? new Date(buildRec.lastBuiltAt).toISOString() : null,
          scenarioKey,
          scenarioId,
          monthProvenanceByMonth,
          actualSource,
        };
      }
    } else {
      const pastSimulatedList = (buildInputs as any).pastSimulatedMonths;
      // Never return raw actual for Past + SMT/GB so completeActualIntervalsV1 always runs (Travel/Vacant + missing intervals fill).
      const pastHasNoEvents =
        isPastScenario &&
        (pastSimulatedList == null || !Array.isArray(pastSimulatedList) || pastSimulatedList.length === 0) &&
        !isSmtBaselineMode;
      if (pastHasNoEvents) {
        const actualResult = await getActualUsageDatasetForHouse(args.houseId, house.esiid ?? null, {
          skipFullYearIntervalFetch: true,
        });
        if (actualResult?.dataset) {
          const filledSet = new Set<string>(((buildInputs as any).filledMonths ?? []).map(String));
          const monthProvenanceByMonth: Record<string, "ACTUAL" | "SIMULATED"> = {};
          for (const ym of (buildInputs as any).canonicalMonths ?? []) {
            monthProvenanceByMonth[String(ym)] = !filledSet.has(String(ym)) ? "ACTUAL" : "SIMULATED";
          }
          const actualSummary = actualResult.dataset.summary ?? {};
          const summarySource = actualSummary.source === "SMT" || actualSummary.source === "GREEN_BUTTON" ? actualSummary.source : (actualSource === "SMT" || actualSource === "GREEN_BUTTON" ? actualSource : "SIMULATED");
          dataset = {
            ...actualResult.dataset,
            summary: {
              ...actualSummary,
              source: summarySource as "SMT" | "GREEN_BUTTON" | "SIMULATED",
            },
            meta: {
              buildInputsHash: String(buildRec.buildInputsHash ?? ""),
              lastBuiltAt: buildRec.lastBuiltAt ? new Date(buildRec.lastBuiltAt).toISOString() : null,
              datasetKind: summarySource === "SIMULATED" ? ("SIMULATED" as const) : ("ACTUAL" as const),
              scenarioKey,
              scenarioId,
              monthProvenanceByMonth,
              actualSource,
            },
          };
          ensureBaselineMonthlyFromBuild(dataset, buildInputs);
        }
      }
      // Always build stitched curve for Past + SMT/GB so Travel/Vacant and missing/incomplete intervals are filled.
      const isPastStitched =
        !dataset &&
        isPastScenario &&
        isSmtBaselineMode;
      if (isPastStitched) {
        // Use buildInputs.canonicalMonths for window so we avoid getActualUsageDatasetForHouse (and its full-year
        // getActualIntervalsForRange) before the cache check. One full-year fetch in getPastSimulatedDatasetForHouse is enough.
        let canonicalMonths = (buildInputs as any).canonicalMonths ?? [];
        let canonicalEndMonthForMeta = buildInputs.canonicalEndMonth;
        let sourceOfWindow: "buildInputs" | "baselineBuild" | "actualSummaryFallback" = "buildInputs";
        let periodsForStitch: Array<{ id: string; startDate: string; endDate: string }> | undefined =
          Array.isArray((buildInputs as any).canonicalPeriods) &&
          (buildInputs as any).canonicalPeriods.length > 0
            ? ((buildInputs as any).canonicalPeriods as Array<{ id?: string; startDate?: string; endDate?: string }>)
                .map((p, idx) => ({
                  id: String(p?.id ?? `p${idx + 1}`),
                  startDate: String(p?.startDate ?? "").slice(0, 10),
                  endDate: String(p?.endDate ?? "").slice(0, 10),
                }))
                .filter((p) => /^\d{4}-\d{2}-\d{2}$/.test(p.startDate) && /^\d{4}-\d{2}-\d{2}$/.test(p.endDate))
            : undefined;
        if (canonicalMonths.length === 0 && scenarioKey !== "BASELINE") {
          const baselineBuild = await (prisma as any).usageSimulatorBuild
            .findUnique({
              where: { userId_houseId_scenarioKey: { userId: args.userId, houseId: args.houseId, scenarioKey: "BASELINE" } },
              select: { buildInputs: true },
            })
            .catch(() => null);
          const baselineInputs = baselineBuild?.buildInputs as any;
          if (Array.isArray(baselineInputs?.canonicalMonths) && baselineInputs.canonicalMonths.length > 0) {
            canonicalMonths = baselineInputs.canonicalMonths;
            if (typeof baselineInputs.canonicalEndMonth === "string") {
              canonicalEndMonthForMeta = baselineInputs.canonicalEndMonth;
            }
            sourceOfWindow = "baselineBuild";
          }
        }
        if (canonicalMonths.length === 0) {
          try {
            const actualResult = await getActualUsageDatasetForHouse(args.houseId, house.esiid ?? null, { skipFullYearIntervalFetch: true });
            const summaryStart = String(actualResult?.dataset?.summary?.start ?? "").slice(0, 10);
            const summaryEnd = String(actualResult?.dataset?.summary?.end ?? "").slice(0, 10);
            if (/^\d{4}-\d{2}-\d{2}$/.test(summaryStart) && /^\d{4}-\d{2}-\d{2}$/.test(summaryEnd)) {
              periodsForStitch = [{ id: "anchor", startDate: summaryStart, endDate: summaryEnd }];
            }
            const actualMonths = Array.isArray(actualResult?.dataset?.monthly)
              ? (actualResult!.dataset.monthly as Array<{ month?: string }>)
                  .map((m) => String(m?.month ?? "").trim())
                  .filter((ym) => /^\d{4}-\d{2}$/.test(ym))
              : [];
            if (actualMonths.length > 0) {
              canonicalMonths = Array.from(new Set(actualMonths)).sort((a, b) => (a < b ? -1 : 1));
              canonicalEndMonthForMeta = canonicalMonths[canonicalMonths.length - 1] ?? canonicalEndMonthForMeta;
              sourceOfWindow = "actualSummaryFallback";
            }
          } catch {
            /* keep canonicalMonths from build or baseline */
          }
        }
        const window = canonicalWindowDateRange(canonicalMonths);
        let startDate = periodsForStitch?.[0]?.startDate ?? window?.start;
        let endDate = periodsForStitch?.[periodsForStitch.length - 1]?.endDate ?? window?.end;
        // Align 12-month display to end with actual data (e.g. March 2026) so chart/table show Apr..Mar, not Mar..Feb.
        if (startDate && endDate && window?.end) {
          try {
            const actualForWindow = await getActualUsageDatasetForHouse(args.houseId, house.esiid ?? null, { skipFullYearIntervalFetch: true });
            const actualEnd = actualForWindow?.dataset?.summary?.end;
            const actualStart = actualForWindow?.dataset?.summary?.start;
            if (typeof actualEnd === "string" && /^\d{4}-\d{2}-\d{2}$/.test(actualEnd.slice(0, 10))) {
              const actualEndDate = actualEnd.slice(0, 10);
              if (actualEndDate > endDate) endDate = actualEndDate;
            }
            if (typeof actualStart === "string" && /^\d{4}-\d{2}-\d{2}$/.test(actualStart.slice(0, 10))) {
              const actualStartDate = actualStart.slice(0, 10);
              if (actualStartDate < startDate) startDate = actualStartDate;
            }
          } catch {
            /* keep window-based start/end */
          }
        }
        const pastWindowDiag = {
          canonicalMonthsLen: canonicalMonths.length,
          firstMonth: canonicalMonths[0] ?? null,
          lastMonth: canonicalMonths.length > 0 ? canonicalMonths[canonicalMonths.length - 1] ?? null : null,
          windowStartUtc: startDate ?? null,
          windowEndUtc: endDate ?? null,
          sourceOfWindow,
        };
        if (startDate && endDate) {
          const travelRanges = ((buildInputs as any).travelRanges ?? []) as Array<{ startDate: string; endDate: string }>;
          const timezone = (buildInputs as any).timezone ?? "America/Chicago";
          const usageShapeProfileIdentity = await getUsageShapeProfileIdentityForPast(args.houseId);
          const weatherIdentity = await computePastWeatherIdentity({
            houseId: args.houseId,
            startDate,
            endDate,
          });
          const intervalDataFingerprint = await getIntervalDataFingerprint({
            houseId: args.houseId,
            esiid: house.esiid ?? null,
            startDate,
            endDate,
          });
          const inputHash = computePastInputHash({
            engineVersion: PAST_ENGINE_VERSION,
            windowStartUtc: startDate,
            windowEndUtc: endDate,
            timezone,
            travelRanges,
            buildInputs: buildInputs as Record<string, unknown>,
            intervalDataFingerprint,
            usageShapeProfileId: usageShapeProfileIdentity.usageShapeProfileId,
            usageShapeProfileVersion: usageShapeProfileIdentity.usageShapeProfileVersion,
            usageShapeProfileDerivedAt: usageShapeProfileIdentity.usageShapeProfileDerivedAt,
            usageShapeProfileSimHash: usageShapeProfileIdentity.usageShapeProfileSimHash,
            weatherIdentity,
          });
          const scenarioIdForCache = scenarioId ?? "BASELINE";
          const cacheKeyDiag = {
            inputHash,
            engineVersion: PAST_ENGINE_VERSION,
            intervalDataFingerprint,
            usageShapeProfileId: usageShapeProfileIdentity.usageShapeProfileId,
            usageShapeProfileVersion: usageShapeProfileIdentity.usageShapeProfileVersion,
            scenarioId: scenarioIdForCache,
          };
          const cached = await getCachedPastDataset({
            houseId: args.houseId,
            scenarioId: scenarioIdForCache,
            inputHash,
          });
          if (cached && cached.intervalsCodec === INTERVAL_CODEC_V1) {
            const decoded = decodeIntervalsV1(cached.intervalsCompressed);
            const restored = {
              ...cached.datasetJson,
              series: {
                ...(typeof (cached.datasetJson as any).series === "object" && (cached.datasetJson as any).series !== null
                  ? (cached.datasetJson as any).series
                  : {}),
                intervals15: decoded,
              },
            };
            dataset = restored;
            reconcileRestoredDatasetFromDecodedIntervals({
              dataset,
              decodedIntervals: decoded,
              fallbackEndDate: endDate,
            });
            // Keep cache restore on the saved stitched artifact only; no second overlay pass.
            if (!dataset.meta || typeof dataset.meta !== "object") (dataset as any).meta = {};
            (dataset.meta as any).pastWindowDiag = pastWindowDiag;
            (dataset.meta as any).pastBuildIntervalsFetchCount = 0;
            (dataset.meta as any).cacheKeyDiag = cacheKeyDiag;
            (dataset.meta as any).sourceOfDaySimulationCore = SOURCE_OF_DAY_SIMULATION_CORE;
            (dataset.meta as any).buildPathKind = "cache_restore";
            if ((dataset.meta as any).weatherSourceSummary == null || (dataset.meta as any).weatherSourceSummary === "") {
              (dataset.meta as any).weatherSourceSummary = "unknown";
            }
            if ((dataset.meta as any).weatherFallbackReason == null || (dataset.meta as any).weatherFallbackReason === "") {
              (dataset.meta as any).weatherFallbackReason =
                (dataset.meta as any).weatherSourceSummary === "actual_only" ? null : "unknown";
            }
            (dataset.meta as any).dailyRowCount = Array.isArray(dataset.daily) ? dataset.daily.length : 0;
            (dataset.meta as any).intervalCount = Array.isArray(dataset?.series?.intervals15) ? dataset.series.intervals15.length : 0;
            (dataset.meta as any).coverageStart = dataset?.summary?.start ?? startDate;
            (dataset.meta as any).coverageEnd = dataset?.summary?.end ?? endDate;
          } else {
            const pastResult = await getPastSimulatedDatasetForHouse({
              userId: args.userId,
              houseId: args.houseId,
              esiid: house.esiid ?? null,
              travelRanges,
              buildInputs,
              startDate,
              endDate,
              timezone,
            });
            if (pastResult.dataset === null) {
              await reportSimulationDataIssue({
                source: scenarioId === "gapfill_lab" ? "GAPFILL_LAB" : "USER_SIMULATION",
                userId: args.userId,
                houseId: args.houseId,
                scenarioId,
                code: "INTERNAL_ERROR",
                message: pastResult.error ?? "past_sim_build_failed",
                context: { stage: "past_sim_build" },
              });
              return {
                ok: false,
                code: "INTERNAL_ERROR",
                message: pastResult.error ?? "past_sim_build_failed",
                inputHash,
                engineVersion: PAST_ENGINE_VERSION,
              };
            }
            dataset = pastResult.dataset;
            if (dataset) {
              if (!dataset.meta || typeof dataset.meta !== "object") (dataset as any).meta = {};
              (dataset.meta as any).pastWindowDiag = pastWindowDiag;
              (dataset.meta as any).pastBuildIntervalsFetchCount = 1;
              (dataset.meta as any).cacheKeyDiag = cacheKeyDiag;
              (dataset.meta as any).sourceOfDaySimulationCore = SOURCE_OF_DAY_SIMULATION_CORE;
              (dataset.meta as any).dailyRowCount = Array.isArray(dataset.daily) ? dataset.daily.length : 0;
              (dataset.meta as any).intervalCount = Array.isArray(dataset?.series?.intervals15) ? dataset.series.intervals15.length : 0;
              (dataset.meta as any).coverageStart = dataset?.summary?.start ?? startDate;
              (dataset.meta as any).coverageEnd = dataset?.summary?.end ?? endDate;
            }
            const intervals15 = Array.isArray(dataset?.series?.intervals15) ? dataset.series.intervals15 : [];
            const { bytes } = encodeIntervalsV1(intervals15);
            const datasetJsonForStorage = {
              ...dataset,
              series: { ...(dataset.series ?? {}), intervals15: [] },
            };
            await saveCachedPastDataset({
              houseId: args.houseId,
              scenarioId: scenarioIdForCache,
              inputHash,
              engineVersion: PAST_ENGINE_VERSION,
              windowStartUtc: startDate,
              windowEndUtc: endDate,
              datasetJson: datasetJsonForStorage as Record<string, unknown>,
              intervalsCodec: INTERVAL_CODEC_V1,
              intervalsCompressed: bytes,
            });
          }
        }
      }
      if (!dataset) {
        dataset = buildSimulatedUsageDatasetFromBuildInputs(buildInputs);
      }
      const filledSet = new Set<string>(((buildInputs as any).filledMonths ?? []).map(String));
      const pastSimulatedSet = new Set<string>((buildInputs as any).pastSimulatedMonths ?? []);
      const travelMonths = monthsIntersectingTravelRanges(
        ((buildInputs as any).canonicalMonths ?? []) as string[],
        ((buildInputs as any).travelRanges ?? []) as Array<{ startDate: string; endDate: string }>
      );
      for (const ym of Array.from(travelMonths)) pastSimulatedSet.delete(ym);
      const monthProvenanceByMonth: Record<string, "ACTUAL" | "SIMULATED"> = {};
      for (const ym of (buildInputs as any).canonicalMonths ?? []) {
        const key = String(ym);
        monthProvenanceByMonth[key] =
          pastSimulatedSet.size > 0 && pastSimulatedSet.has(key)
            ? "SIMULATED"
            : pastSimulatedSet.size > 0
              ? "ACTUAL" // Past stitched: not in pastSimulatedSet = uses actual 15-min intervals
              : scenarioKey === "BASELINE" && !filledSet.has(key)
                ? "ACTUAL"
                : "SIMULATED";
      }
      dataset.meta = {
        ...(dataset.meta ?? {}),
        buildInputsHash: String(buildRec.buildInputsHash ?? ""),
        lastBuiltAt: buildRec.lastBuiltAt ? new Date(buildRec.lastBuiltAt).toISOString() : null,
        scenarioKey,
        scenarioId,
        monthProvenanceByMonth,
        actualSource: (buildInputs as any)?.snapshots?.actualSource ?? null,
      };
    }

    // Past and Future: show the same date range as SMT/Green Button anchor (e.g. 02/18/2025 – 02/18/2026), not calendar-month window.
    if (
      scenarioKey !== "BASELINE" &&
      mode === "SMT_BASELINE" &&
      isSmtBaselineMode &&
      dataset?.summary
    ) {
      try {
        const actualResult = await getActualUsageDatasetForHouse(args.houseId, house.esiid ?? null, {
          skipFullYearIntervalFetch: true,
        });
        const actualSummary = actualResult?.dataset?.summary;
        if (actualSummary?.start != null && actualSummary?.end != null) {
          dataset.summary.start = actualSummary.start;
          dataset.summary.end = actualSummary.end;
          dataset.summary.latest = actualSummary.latest ?? actualSummary.end;
        }
      } catch {
        /* ignore; keep built curve dates */
      }
    }

    // Past and Future baseload come from the built curve (buildSimulatedUsageDatasetFromBuildInputs), which already
    // computes baseload from curve.intervals after overlay/upgrades/vacant fill; no overwrite from actual usage.

    const quality = validateSharedSimQuality(dataset);
    if (!quality.ok) {
      await reportSimulationDataIssue({
        source: scenarioId === "gapfill_lab" ? "GAPFILL_LAB" : "USER_SIMULATION",
        userId: args.userId,
        houseId: args.houseId,
        scenarioId,
        code: "INTERNAL_ERROR",
        message: quality.message,
        context: { readMode: "allow_rebuild" },
      });
      return { ok: false, code: "INTERNAL_ERROR", message: quality.message };
    }
    return { ok: true, houseId: args.houseId, scenarioKey, scenarioId, dataset };
  } catch (e) {
    console.error("[usageSimulator/service] getSimulatedUsageForHouseScenario failed", e);
    return { ok: false, code: "INTERNAL_ERROR", message: "Internal error" };
  }
}

export async function listSimulatedBuildAvailability(args: {
  userId: string;
  houseId: string;
}): Promise<
  | {
      ok: true;
      houseId: string;
      builds: Array<{
        scenarioKey: string;
        scenarioId: string | null;
        scenarioName: string;
        mode: string;
        baseKind: string;
        buildInputsHash: string;
        lastBuiltAt: string | null;
        canonicalEndMonth: string;
        weatherPreference?: string | null;
      }>;
    }
  | { ok: false; error: string }
> {
  const house = await getHouseAddressForUserHouse({ userId: args.userId, houseId: args.houseId }).catch(() => null);
  if (!house) return { ok: false, error: "house_not_found" };

  const rows = await (prisma as any).usageSimulatorBuild
    .findMany({
      where: { userId: args.userId, houseId: args.houseId },
      select: {
        scenarioKey: true,
        mode: true,
        baseKind: true,
        buildInputsHash: true,
        lastBuiltAt: true,
        canonicalEndMonth: true,
        buildInputs: true,
      },
      orderBy: [{ lastBuiltAt: "desc" }, { updatedAt: "desc" }],
    })
    .catch(() => []);

  const scenarioIds = rows.map((r: any) => String(r?.scenarioKey ?? "")).filter((k: string) => k && k !== "BASELINE");
  const scenarioNameById = new Map<string, string>();
  if (scenarioIds.length) {
    const scenRows = await (prisma as any).usageSimulatorScenario
      .findMany({
        where: { id: { in: scenarioIds }, userId: args.userId, houseId: args.houseId },
        select: { id: true, name: true },
      })
      .catch(() => []);
    for (const s of scenRows) scenarioNameById.set(String(s.id), String(s.name ?? ""));
  }

  const builds = rows.map((r: any) => {
    const scenarioKey = String(r?.scenarioKey ?? "BASELINE");
    const scenarioId = scenarioKey === "BASELINE" ? null : scenarioKey;
    return {
      scenarioKey,
      scenarioId,
      scenarioName: scenarioKey === "BASELINE" ? "Baseline" : scenarioNameById.get(scenarioKey) ?? "Scenario",
      mode: String(r?.mode ?? ""),
      baseKind: String(r?.baseKind ?? ""),
      buildInputsHash: String(r?.buildInputsHash ?? ""),
      lastBuiltAt: r?.lastBuiltAt ? new Date(r.lastBuiltAt).toISOString() : null,
      canonicalEndMonth: String(r?.canonicalEndMonth ?? ""),
      weatherPreference: (r as any)?.buildInputs?.weatherPreference ?? null,
    };
  });

  return { ok: true, houseId: args.houseId, builds };
}

function isYearMonth(s: unknown): s is string {
  return typeof s === "string" && /^\d{4}-\d{2}$/.test(s.trim());
}

async function requireHouseForUser(args: { userId: string; houseId: string }) {
  const h = await getHouseAddressForUserHouse({ userId: args.userId, houseId: args.houseId });
  return h ?? null;
}

export async function listScenarios(args: { userId: string; houseId: string }) {
  const house = await requireHouseForUser(args);
  if (!house) return { ok: false as const, error: "house_not_found" };
  const scenarios = await (prisma as any).usageSimulatorScenario
    .findMany({
      where: { userId: args.userId, houseId: args.houseId, archivedAt: null },
      select: { id: true, name: true, createdAt: true, updatedAt: true },
      orderBy: [{ updatedAt: "desc" }, { createdAt: "desc" }],
    })
    .catch(() => []);
  return { ok: true as const, scenarios };
}

export async function createScenario(args: { userId: string; houseId: string; name: string }) {
  const house = await requireHouseForUser(args);
  if (!house) return { ok: false as const, error: "house_not_found" };
  const name = String(args.name ?? "").trim();
  if (!name) return { ok: false as const, error: "name_required" };

  const scenario = await (prisma as any).usageSimulatorScenario
    .create({
      data: { userId: args.userId, houseId: args.houseId, name },
      select: { id: true, name: true, createdAt: true, updatedAt: true },
    })
    .catch((e: any) => {
      // Unique constraint on (userId, houseId, name)
      if (String(e?.code ?? "") === "P2002") return null;
      throw e;
    });
  if (!scenario) return { ok: false as const, error: "name_not_unique" };
  return { ok: true as const, scenario };
}

export async function renameScenario(args: { userId: string; houseId: string; scenarioId: string; name: string }) {
  const house = await requireHouseForUser(args);
  if (!house) return { ok: false as const, error: "house_not_found" };
  const name = String(args.name ?? "").trim();
  if (!name) return { ok: false as const, error: "name_required" };

  const existing = await (prisma as any).usageSimulatorScenario
    .findFirst({ where: { id: args.scenarioId, userId: args.userId, houseId: args.houseId, archivedAt: null }, select: { id: true } })
    .catch(() => null);
  if (!existing) return { ok: false as const, error: "scenario_not_found" };

  const scenario = await (prisma as any).usageSimulatorScenario
    .update({
      where: { id: args.scenarioId },
      data: { name },
      select: { id: true, name: true, createdAt: true, updatedAt: true },
    })
    .catch((e: any) => {
      if (String(e?.code ?? "") === "P2002") return null;
      throw e;
    });
  if (!scenario) return { ok: false as const, error: "name_not_unique" };
  return { ok: true as const, scenario };
}

export async function archiveScenario(args: { userId: string; houseId: string; scenarioId: string }) {
  const house = await requireHouseForUser(args);
  if (!house) return { ok: false as const, error: "house_not_found" };

  const existing = await (prisma as any).usageSimulatorScenario
    .findFirst({ where: { id: args.scenarioId, userId: args.userId, houseId: args.houseId, archivedAt: null }, select: { id: true } })
    .catch(() => null);
  if (!existing) return { ok: false as const, error: "scenario_not_found" };

  await (prisma as any).usageSimulatorScenario.update({ where: { id: args.scenarioId }, data: { archivedAt: new Date() } }).catch(() => null);
  return { ok: true as const };
}

function eventSortKey(e: { effectiveMonth: string; kind: string; payloadJson: any; id: string }): string {
  const p = e?.payloadJson ?? {};
  const effectiveDate = typeof p.effectiveDate === "string" && /^\d{4}-\d{2}-\d{2}$/.test(p.effectiveDate) ? p.effectiveDate : null;
  const ym = effectiveDate ? effectiveDate.slice(0, 7) : String(e?.effectiveMonth ?? "");
  return `${ym}-${effectiveDate ?? e?.effectiveMonth ?? ""}-${e?.id ?? ""}`;
}

export async function listScenarioEvents(args: { userId: string; houseId: string; scenarioId: string }) {
  const scenario = await (prisma as any).usageSimulatorScenario
    .findFirst({ where: { id: args.scenarioId, userId: args.userId, houseId: args.houseId, archivedAt: null }, select: { id: true } })
    .catch(() => null);
  if (!scenario) return { ok: false as const, error: "scenario_not_found" };

  const raw = await (prisma as any).usageSimulatorScenarioEvent
    .findMany({
      where: { scenarioId: args.scenarioId },
      select: { id: true, scenarioId: true, effectiveMonth: true, kind: true, payloadJson: true, createdAt: true, updatedAt: true },
      orderBy: [{ effectiveMonth: "asc" }, { createdAt: "asc" }, { id: "asc" }],
    })
    .catch(() => []);
  const events = (raw as any[]).slice().sort((a, b) => eventSortKey(a).localeCompare(eventSortKey(b)));
  return { ok: true as const, events };
}

export async function addScenarioEvent(args: {
  userId: string;
  houseId: string;
  scenarioId: string;
  effectiveMonth: string;
  kind: string;
  payloadJson: any;
}) {
  const scenario = await (prisma as any).usageSimulatorScenario
    .findFirst({ where: { id: args.scenarioId, userId: args.userId, houseId: args.houseId, archivedAt: null }, select: { id: true } })
    .catch(() => null);
  if (!scenario) return { ok: false as const, error: "scenario_not_found" };

  const effectiveMonth = String(args.effectiveMonth ?? "").trim();
  if (!isYearMonth(effectiveMonth)) return { ok: false as const, error: "effectiveMonth_invalid" };

  const kind = String(args.kind ?? "").trim() || "MONTHLY_ADJUSTMENT";
  const payloadJson = args.payloadJson ?? {};

  let event: any = null;
  try {
    const sanitizedPayload =
      payloadJson != null && typeof payloadJson === "object"
        ? JSON.parse(JSON.stringify(payloadJson))
        : {};
    event = await (prisma as any).usageSimulatorScenarioEvent.create({
      data: { scenarioId: args.scenarioId, effectiveMonth, kind, payloadJson: sanitizedPayload },
      select: { id: true, scenarioId: true, effectiveMonth: true, kind: true, payloadJson: true, createdAt: true, updatedAt: true },
    });
  } catch (err) {
    console.error("[usageSimulator] addScenarioEvent create failed", err);
  }
  if (!event) return { ok: false as const, error: "event_create_failed" };
  return { ok: true as const, event };
}

export async function updateScenarioEvent(args: {
  userId: string;
  houseId: string;
  scenarioId: string;
  eventId: string;
  effectiveMonth?: string;
  kind?: string;
  payloadJson?: any;
}) {
  const scenario = await (prisma as any).usageSimulatorScenario
    .findFirst({ where: { id: args.scenarioId, userId: args.userId, houseId: args.houseId, archivedAt: null }, select: { id: true } })
    .catch(() => null);
  if (!scenario) return { ok: false as const, error: "scenario_not_found" };

  const data: any = {};
  if (args.effectiveMonth !== undefined) {
    const effectiveMonth = String(args.effectiveMonth ?? "").trim();
    if (!isYearMonth(effectiveMonth)) return { ok: false as const, error: "effectiveMonth_invalid" };
    data.effectiveMonth = effectiveMonth;
  }
  if (args.kind !== undefined) data.kind = String(args.kind ?? "").trim() || "MONTHLY_ADJUSTMENT";
  if (args.payloadJson !== undefined) data.payloadJson = args.payloadJson ?? {};

  const event = await (prisma as any).usageSimulatorScenarioEvent
    .update({
      where: { id: String(args.eventId ?? "") },
      data,
      select: { id: true, scenarioId: true, effectiveMonth: true, kind: true, payloadJson: true, createdAt: true, updatedAt: true },
    })
    .catch(() => null);
  if (!event || String(event.scenarioId) !== args.scenarioId) return { ok: false as const, error: "event_not_found" };
  return { ok: true as const, event };
}

export async function deleteScenarioEvent(args: { userId: string; houseId: string; scenarioId: string; eventId: string }) {
  const scenario = await (prisma as any).usageSimulatorScenario
    .findFirst({ where: { id: args.scenarioId, userId: args.userId, houseId: args.houseId, archivedAt: null }, select: { id: true } })
    .catch(() => null);
  if (!scenario) return { ok: false as const, error: "scenario_not_found" };

  const event = await (prisma as any).usageSimulatorScenarioEvent
    .delete({ where: { id: String(args.eventId ?? "") }, select: { id: true, scenarioId: true } })
    .catch(() => null);
  if (!event || String(event.scenarioId) !== args.scenarioId) return { ok: false as const, error: "event_not_found" };
  return { ok: true as const };
}

export async function getSimulatorRequirements(args: { userId: string; houseId: string; mode: SimulatorMode; now?: Date }) {
  const house = await getHouseAddressForUserHouse({ userId: args.userId, houseId: args.houseId }).catch(() => null);
  if (!house) return { ok: false as const, error: "house_not_found" };

  const [manualRec, homeRec, applianceRec] = await Promise.all([
    (prisma as any).manualUsageInput
      .findUnique({ where: { userId_houseId: { userId: args.userId, houseId: args.houseId } }, select: { payload: true } })
      .catch(() => null),
    getHomeProfileSimulatedByUserHouse({ userId: args.userId, houseId: args.houseId }),
    getApplianceProfileSimulatedByUserHouse({ userId: args.userId, houseId: args.houseId }),
  ]);

  const manualUsagePayload = (manualRec?.payload as any) ?? null;
  const canonical = canonicalMonthsForRecalc({ mode: args.mode, manualUsagePayload, now: args.now });

  const applianceProfile = normalizeStoredApplianceProfile((applianceRec?.appliancesJson as any) ?? null);
  const homeProfile = homeRec ? { ...homeRec } : null;

  const hasActual = await hasActualIntervals({ houseId: args.houseId, esiid: house.esiid ?? null, canonicalMonths: canonical.months });
  const actualSource = await chooseActualSource({ houseId: args.houseId, esiid: house.esiid ?? null });
  const req = computeRequirements(
    { manualUsagePayload: manualUsagePayload as any, homeProfile: homeProfile as any, applianceProfile: applianceProfile as any, hasActualIntervals: hasActual },
    args.mode,
  );

  return {
    ok: true as const,
    canRecalc: req.canRecalc,
    missingItems: req.missingItems,
    hasActualIntervals: hasActual,
    actualSource,
    canonicalEndMonth: canonical.endMonth,
  };
}