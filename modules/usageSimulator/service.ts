import { prisma } from "@/lib/db";
import { anchorEndDateUtc, monthsEndingAt, lastFullMonthChicago } from "@/modules/manualUsage/anchor";
import { normalizeStoredApplianceProfile } from "@/modules/applianceProfile/validation";
import { getApplianceProfileSimulatedByUserHouse } from "@/modules/applianceProfile/repo";
import { getHomeProfileSimulatedByUserHouse } from "@/modules/homeProfile/repo";
import { buildSimulatorInputs, travelRangesToExcludeDateKeys, type BaseKind, type BuildMode } from "@/modules/usageSimulator/build";
import { computeRequirements, type SimulatorMode } from "@/modules/usageSimulator/requirements";
import { chooseActualSource, hasActualIntervals } from "@/modules/realUsageAdapter/actual";
import { SMT_SHAPE_DERIVATION_VERSION } from "@/modules/realUsageAdapter/smt";
import { getActualUsageDatasetForHouse, getActualIntervalsForRange, getIntervalDataFingerprint } from "@/lib/usage/actualDatasetForHouse";
import { upsertSimulatedUsageBuckets } from "@/lib/usage/simulatedUsageBuckets";
import { buildPastSimulatedBaselineV1 } from "@/modules/simulatedUsage/engine";
import { dateKeyFromTimestamp, enumerateDayStartsMsForWindow, getDayGridTimestamps } from "@/modules/usageSimulator/pastStitchedCurve";
import {
  buildSimulatedUsageDatasetFromBuildInputs,
  buildSimulatedUsageDatasetFromCurve,
  buildDisplayMonthlyFromIntervalsUtc,
  buildDailyFromIntervals,
  type SimulatorBuildInputsV1,
} from "@/modules/usageSimulator/dataset";
import { computeBuildInputsHash } from "@/modules/usageSimulator/hash";
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
  saveCachedPastDataset,
  PAST_ENGINE_VERSION,
} from "@/modules/usageSimulator/pastCache";
import { encodeIntervalsV1, decodeIntervalsV1, INTERVAL_CODEC_V1 } from "@/modules/usageSimulator/intervalCodec";
import { IntervalSeriesKind } from "@/modules/usageSimulator/kinds";
import { billingPeriodsEndingAt } from "@/modules/manualUsage/billingPeriods";
import { normalizeMonthlyTotals, WEATHER_NORMALIZER_VERSION, type WeatherPreference } from "@/modules/weatherNormalization/normalizer";
import { ensureHouseWeatherStubbed } from "@/modules/weather/stubs";
import { getHouseWeatherDays, upsertHouseWeatherDays, findMissingHouseWeatherDateKeys } from "@/modules/weather/repo";
import { ensureHouseWeatherBackfill } from "@/modules/weather/backfill";
import { SOURCE_OF_DAY_SIMULATION_CORE } from "@/modules/simulatedUsage/pastDaySimulator";
import { getWeatherForRange, hourlyRowsToDayWxMap } from "@/lib/sim/weatherProvider";
import type { SimulatedCurve } from "@/modules/simulatedUsage/types";

type ManualUsagePayloadAny = any;

const WORKSPACE_PAST_NAME = "Past (Corrected)";
const WORKSPACE_FUTURE_NAME = "Future (What-if)";

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

function dateKeysFromCanonicalDayStarts(canonicalDayStartsMs: number[]): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  for (const dayStartMs of canonicalDayStartsMs ?? []) {
    if (!Number.isFinite(dayStartMs)) continue;
    const dayTs = getDayGridTimestamps(dayStartMs);
    if (!dayTs.length) continue;
    const dateKey = dateKeyFromTimestamp(dayTs[0]);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(dateKey) || seen.has(dateKey)) continue;
    seen.add(dateKey);
    out.push(dateKey);
  }
  return out;
}

function buildCurveFromPatchedIntervals(args: {
  startDate: string;
  endDate: string;
  intervals: Array<{ timestamp: string; kwh: number }>;
}): SimulatedCurve {
  const rows = (args.intervals ?? [])
    .map((p) => ({ timestamp: String(p?.timestamp ?? ""), consumption_kwh: Number(p?.kwh) || 0, interval_minutes: 15 as const }))
    .filter((p) => p.timestamp.length > 0)
    .sort((a, b) => (a.timestamp < b.timestamp ? -1 : a.timestamp > b.timestamp ? 1 : 0));

  const monthlyTotalsMap = new Map<string, number>();
  for (const iv of rows) {
    const ym = iv.timestamp.slice(0, 7);
    if (!/^\d{4}-\d{2}$/.test(ym)) continue;
    monthlyTotalsMap.set(ym, (monthlyTotalsMap.get(ym) ?? 0) + (Number(iv.consumption_kwh) || 0));
  }
  const monthlyTotals = Array.from(monthlyTotalsMap.entries())
    .map(([month, kwh]) => ({ month, kwh: Math.round(kwh * 100) / 100 }))
    .sort((a, b) => (a.month < b.month ? -1 : 1));
  const annualTotalKwh = monthlyTotals.reduce((s, m) => s + m.kwh, 0);

  return {
    start: String(args.startDate).slice(0, 10),
    end: String(args.endDate).slice(0, 10),
    intervals: rows,
    monthlyTotals,
    annualTotalKwh: Math.round(annualTotalKwh * 100) / 100,
    meta: { excludedDays: 0, renormalized: false },
  };
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

  const endMonth = lastFullMonthChicago(now);
  return { endMonth, months: monthsEndingAt(endMonth, 12) };
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
  if (scenarioId) {
    const baselineBuild = await (prisma as any).usageSimulatorBuild
      .findUnique({
        where: { userId_houseId_scenarioKey: { userId, houseId, scenarioKey: "BASELINE" } },
        select: { buildInputs: true },
      })
      .catch(() => null);
    const baselineInputs = baselineBuild?.buildInputs as any;
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
  let pastSimulatedMonths: string[] | undefined;
  let pastPatchedCurve: SimulatedCurve | null = null;
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
      const actualIntervals = await getActualIntervalsForRange({
        houseId,
        esiid: esiid ?? null,
        startDate,
        endDate,
      });
      const excludedDateKeys = new Set(travelRangesToExcludeDateKeys(allTravelRanges));
      const canonicalDayStartsMs = enumerateDayStartsMsForWindow(startDate, endDate);
      const canonicalDateKeys = dateKeysFromCanonicalDayStarts(canonicalDayStartsMs);
      let actualWxByDateKey: Awaited<ReturnType<typeof getHouseWeatherDays>>;
      let normalWxByDateKey: Awaited<ReturnType<typeof getHouseWeatherDays>>;
      const houseForWx = await (prisma as any).houseAddress.findUnique({ where: { id: houseId }, select: { lat: true, lng: true } }).catch(() => null);
      const lat = houseForWx?.lat != null && Number.isFinite(houseForWx.lat) ? houseForWx.lat : null;
      const lon = houseForWx?.lng != null && Number.isFinite(houseForWx.lng) ? houseForWx.lng : null;
      if (lat != null && lon != null) {
        await ensureHouseWeatherStubbed({ houseId, dateKeys: canonicalDateKeys });
        [actualWxByDateKey, normalWxByDateKey] = await Promise.all([
          getHouseWeatherDays({ houseId, dateKeys: canonicalDateKeys, kind: "ACTUAL_LAST_YEAR" }),
          getHouseWeatherDays({ houseId, dateKeys: canonicalDateKeys, kind: "NORMAL_AVG" }),
        ]);
        const missingActual = await findMissingHouseWeatherDateKeys({ houseId, dateKeys: canonicalDateKeys, kind: "ACTUAL_LAST_YEAR" });
        if (missingActual.length > 0) {
          const weatherResult = await getWeatherForRange(lat, lon, startDate, endDate);
          if (!weatherResult.fromStub && weatherResult.rows.length > 0) {
            const fetchedMap = hourlyRowsToDayWxMap(weatherResult.rows, houseId);
            const toPersist = missingActual.filter((dk) => fetchedMap.has(dk)).map((dk) => fetchedMap.get(dk)!);
            if (toPersist.length > 0) await upsertHouseWeatherDays({ rows: toPersist }).catch(() => 0);
            [actualWxByDateKey, normalWxByDateKey] = await Promise.all([
              getHouseWeatherDays({ houseId, dateKeys: canonicalDateKeys, kind: "ACTUAL_LAST_YEAR" }),
              getHouseWeatherDays({ houseId, dateKeys: canonicalDateKeys, kind: "NORMAL_AVG" }),
            ]);
          }
        }
      } else {
        await ensureHouseWeatherStubbed({ houseId, dateKeys: canonicalDateKeys });
        [actualWxByDateKey, normalWxByDateKey] = await Promise.all([
          getHouseWeatherDays({ houseId, dateKeys: canonicalDateKeys, kind: "ACTUAL_LAST_YEAR" }),
          getHouseWeatherDays({ houseId, dateKeys: canonicalDateKeys, kind: "NORMAL_AVG" }),
        ]);
      }
      const patchedIntervals = buildPastSimulatedBaselineV1({
        actualIntervals,
        canonicalDayStartsMs,
        excludedDateKeys,
        dateKeyFromTimestamp,
        getDayGridTimestamps,
        homeProfile,
        applianceProfile,
        actualWxByDateKey,
        _normalWxByDateKey: normalWxByDateKey,
      });
      const stitchedCurve = buildCurveFromPatchedIntervals({
        startDate,
        endDate,
        intervals: patchedIntervals,
      });
      pastPatchedCurve = stitchedCurve;
      const byMonth: Record<string, number> = {};
      for (const m of stitchedCurve.monthlyTotals) {
        const ym = String(m?.month ?? "").trim();
        if (/^\d{4}-\d{2}$/.test(ym) && typeof m?.kwh === "number" && Number.isFinite(m.kwh)) byMonth[ym] = m.kwh;
      }
      if (Object.keys(byMonth).length > 0) monthlyTotalsKwhByMonth = byMonth;
      pastSimulatedMonths = [];
      notes.push("Past: baseline patched for excluded + leading-missing days");
    } catch (e) {
      console.warn("[usageSimulator] Past stitched curve failed, using monthly curve", e);
    }
  }

  const buildInputs: SimulatorBuildInputsV1 & {
    scenarioKey?: string;
    scenarioId?: string | null;
    versions?: typeof versions;
    pastSimulatedMonths?: string[];
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
        }, { timezone: (buildInputs as any).timezone ?? undefined })
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
}): Promise<
  | { dataset: Awaited<ReturnType<typeof buildSimulatedUsageDatasetFromCurve>>; error?: undefined }
  | { dataset: null; error: string }
> {
  const { userId, houseId, esiid, travelRanges, buildInputs, startDate, endDate, timezone } = args;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(startDate) || !/^\d{4}-\d{2}-\d{2}$/.test(endDate)) {
    return { dataset: null, error: "Invalid startDate or endDate (expect YYYY-MM-DD)." };
  }
  try {
    const actualIntervals = await getActualIntervalsForRange({
      houseId,
      esiid,
      startDate,
      endDate,
    });
    const excludedDateKeys = new Set(travelRangesToExcludeDateKeys(travelRanges));
    const canonicalDayStartsMs = enumerateDayStartsMsForWindow(startDate, endDate);
    const canonicalDateKeys = dateKeysFromCanonicalDayStarts(canonicalDayStartsMs);
    let actualWxByDateKey: Awaited<ReturnType<typeof getHouseWeatherDays>>;
    let normalWxByDateKey: Awaited<ReturnType<typeof getHouseWeatherDays>>;
    const houseForWx = await (prisma as any).houseAddress.findUnique({ where: { id: houseId }, select: { lat: true, lng: true } }).catch(() => null);
    const lat = houseForWx?.lat != null && Number.isFinite(houseForWx.lat) ? houseForWx.lat : null;
    const lon = houseForWx?.lng != null && Number.isFinite(houseForWx.lng) ? houseForWx.lng : null;
    if (lat != null && lon != null) {
      await ensureHouseWeatherStubbed({ houseId, dateKeys: canonicalDateKeys });
      [actualWxByDateKey, normalWxByDateKey] = await Promise.all([
        getHouseWeatherDays({ houseId, dateKeys: canonicalDateKeys, kind: "ACTUAL_LAST_YEAR" }),
        getHouseWeatherDays({ houseId, dateKeys: canonicalDateKeys, kind: "NORMAL_AVG" }),
      ]);
      const missingActual = await findMissingHouseWeatherDateKeys({ houseId, dateKeys: canonicalDateKeys, kind: "ACTUAL_LAST_YEAR" });
      if (missingActual.length > 0) {
        const weatherResult = await getWeatherForRange(lat, lon, startDate, endDate);
        if (!weatherResult.fromStub && weatherResult.rows.length > 0) {
          const fetchedMap = hourlyRowsToDayWxMap(weatherResult.rows, houseId);
          const toPersist = missingActual.filter((dk) => fetchedMap.has(dk)).map((dk) => fetchedMap.get(dk)!);
          if (toPersist.length > 0) await upsertHouseWeatherDays({ rows: toPersist }).catch(() => 0);
          [actualWxByDateKey, normalWxByDateKey] = await Promise.all([
            getHouseWeatherDays({ houseId, dateKeys: canonicalDateKeys, kind: "ACTUAL_LAST_YEAR" }),
            getHouseWeatherDays({ houseId, dateKeys: canonicalDateKeys, kind: "NORMAL_AVG" }),
          ]);
        }
      }
    } else {
      await ensureHouseWeatherStubbed({ houseId, dateKeys: canonicalDateKeys });
      [actualWxByDateKey, normalWxByDateKey] = await Promise.all([
        getHouseWeatherDays({ houseId, dateKeys: canonicalDateKeys, kind: "ACTUAL_LAST_YEAR" }),
        getHouseWeatherDays({ houseId, dateKeys: canonicalDateKeys, kind: "NORMAL_AVG" }),
      ]);
    }
    const [homeRecForPast, applianceRecForPast, shapeProfileRow] = await Promise.all([
      getHomeProfileSimulatedByUserHouse({ userId, houseId }),
      getApplianceProfileSimulatedByUserHouse({ userId, houseId }),
      getLatestUsageShapeProfile(houseId).catch(() => null),
    ]);
    const homeProfileForPast = homeRecForPast ? { ...homeRecForPast } : (buildInputs as any)?.snapshots?.homeProfile ?? null;
    const applianceProfileForPast =
      normalizeStoredApplianceProfile((applianceRecForPast?.appliancesJson as any) ?? null)?.fuelConfiguration
        ? normalizeStoredApplianceProfile((applianceRecForPast?.appliancesJson as any) ?? null)
        : normalizeStoredApplianceProfile((buildInputs as any)?.snapshots?.applianceProfile ?? null);

    const canonicalMonths = ((buildInputs as any).canonicalMonths ?? []) as string[];
    let usageShapeProfileSnap: { weekdayAvgByMonthKey: Record<string, number>; weekendAvgByMonthKey: Record<string, number> } | null = null;
    let reasonNotUsed: string | null = null;
    if (!shapeProfileRow) {
      reasonNotUsed = "profile_not_found";
    } else if (!timezone) {
      reasonNotUsed = "missing_timezone";
    } else if (!shapeProfileRow.shapeByMonth96) {
      reasonNotUsed = "no_shapeByMonth96";
    } else if (shapeProfileRow.avgKwhPerDayWeekdayByMonth == null || shapeProfileRow.avgKwhPerDayWeekendByMonth == null) {
      reasonNotUsed = "missing_arrays";
    }
    if (timezone && shapeProfileRow?.shapeByMonth96 && shapeProfileRow?.avgKwhPerDayWeekdayByMonth != null && shapeProfileRow?.avgKwhPerDayWeekendByMonth != null) {
      const shapeByMonth = shapeProfileRow.shapeByMonth96 as Record<string, unknown>;
      const profileMonthKeys = Object.keys(shapeByMonth ?? {}).filter((k) => /^\d{4}-\d{2}$/.test(k)).sort();
      const wd = Array.isArray(shapeProfileRow.avgKwhPerDayWeekdayByMonth) ? (shapeProfileRow.avgKwhPerDayWeekdayByMonth as number[]) : [];
      const we = Array.isArray(shapeProfileRow.avgKwhPerDayWeekendByMonth) ? (shapeProfileRow.avgKwhPerDayWeekendByMonth as number[]) : [];
      const weekdayAvgByMonthKey: Record<string, number> = {};
      const weekendAvgByMonthKey: Record<string, number> = {};
      for (let i = 0; i < profileMonthKeys.length; i++) {
        const ym = profileMonthKeys[i];
        if (!ym) continue;
        const vWd = wd[i];
        const vWe = we[i];
        if (vWd != null && Number.isFinite(vWd) && vWd > 0) weekdayAvgByMonthKey[ym] = vWd;
        if (vWe != null && Number.isFinite(vWe) && vWe > 0) weekendAvgByMonthKey[ym] = vWe;
      }
      if (Object.keys(weekdayAvgByMonthKey).length > 0 || Object.keys(weekendAvgByMonthKey).length > 0) {
        usageShapeProfileSnap = { weekdayAvgByMonthKey, weekendAvgByMonthKey };
        reasonNotUsed = null;
      } else {
        reasonNotUsed = reasonNotUsed ?? "no_positive_values";
      }
    }
    const usageShapeProfileDiag = {
      found: !!shapeProfileRow,
      id: shapeProfileRow?.id ?? null,
      version: shapeProfileRow?.version ?? null,
      derivedAt: shapeProfileRow?.derivedAt != null ? String(shapeProfileRow.derivedAt) : null,
      windowStartUtc: shapeProfileRow?.windowStartUtc != null ? String(shapeProfileRow.windowStartUtc) : null,
      windowEndUtc: shapeProfileRow?.windowEndUtc != null ? String(shapeProfileRow.windowEndUtc) : null,
      profileMonthKeys: shapeProfileRow?.shapeByMonth96
        ? Object.keys((shapeProfileRow.shapeByMonth96 as Record<string, unknown>) ?? {}).filter((k) => /^\d{4}-\d{2}$/.test(k)).sort()
        : [],
      weekdayAvgLen: shapeProfileRow?.avgKwhPerDayWeekdayByMonth != null
        ? (Array.isArray(shapeProfileRow.avgKwhPerDayWeekdayByMonth) ? shapeProfileRow.avgKwhPerDayWeekdayByMonth.length : null)
        : null,
      weekendAvgLen: shapeProfileRow?.avgKwhPerDayWeekendByMonth != null
        ? (Array.isArray(shapeProfileRow.avgKwhPerDayWeekendByMonth) ? shapeProfileRow.avgKwhPerDayWeekendByMonth.length : null)
        : null,
      canonicalMonths,
      canonicalMonthsLen: canonicalMonths.length,
      reasonNotUsed,
    };

    const pastDayCounts: { totalDays?: number; excludedDays?: number; leadingMissingDays?: number; simulatedDays?: number } = {};
    const patchedIntervals = buildPastSimulatedBaselineV1({
      actualIntervals: actualIntervals.map((p) => ({ timestamp: p.timestamp, kwh: p.kwh })),
      canonicalDayStartsMs,
      excludedDateKeys,
      dateKeyFromTimestamp,
      getDayGridTimestamps,
      homeProfile: homeProfileForPast,
      applianceProfile: applianceProfileForPast,
      usageShapeProfile: usageShapeProfileSnap ?? undefined,
      timezoneForProfile: timezone ?? undefined,
      actualWxByDateKey,
      _normalWxByDateKey: normalWxByDateKey,
      debug: { out: pastDayCounts as any },
    });
    const stitchedCurve = buildCurveFromPatchedIntervals({
      startDate,
      endDate,
      intervals: patchedIntervals,
    });
    const dataset = buildSimulatedUsageDatasetFromCurve(stitchedCurve, {
      baseKind: buildInputs.baseKind,
      mode: buildInputs.mode,
      canonicalEndMonth: buildInputs.canonicalEndMonth,
      notes: buildInputs.notes ?? [],
      filledMonths: buildInputs.filledMonths ?? [],
    }, { timezone: timezone ?? undefined, useUtcMonth: true });
    if (dataset && typeof dataset.meta === "object") {
      dataset.meta = {
        ...dataset.meta,
        weekdayWeekendSplitUsed: !!usageShapeProfileSnap,
        dayTotalSource: usageShapeProfileSnap ? "usageShapeProfile_avgKwhPerDayByMonth" : "fallback_month_avg",
        usageShapeProfileDiag,
        sourceOfDaySimulationCore: SOURCE_OF_DAY_SIMULATION_CORE,
        dailyRowCount: Array.isArray(dataset.daily) ? dataset.daily.length : 0,
        intervalCount: Array.isArray(dataset?.series?.intervals15) ? dataset.series.intervals15.length : 0,
        coverageStart: dataset?.summary?.start ?? startDate,
        coverageEnd: dataset?.summary?.end ?? endDate,
        actualDayCount:
          typeof pastDayCounts.totalDays === "number" && typeof pastDayCounts.simulatedDays === "number"
            ? pastDayCounts.totalDays - pastDayCounts.simulatedDays
            : undefined,
        simulatedDayCount: pastDayCounts.simulatedDays,
        stitchedDayCount: pastDayCounts.excludedDays != null ? pastDayCounts.excludedDays : undefined,
      };
    }
    try {
      const actualForOverlay = await getActualUsageDatasetForHouse(houseId, esiid, { skipFullYearIntervalFetch: true });
      if (dataset?.monthly && actualForOverlay?.dataset?.monthly && Array.isArray(dataset.monthly)) {
        const travelMonthsSet = monthsIntersectingTravelRanges(
          ((buildInputs as any).canonicalMonths ?? []) as string[],
          travelRanges
        );
        const actualByMonth = new Map<string, number>();
        const actualMonthly = actualForOverlay.dataset.monthly as Array<{ month?: string; kwh?: number }>;
        for (const row of actualMonthly) {
          const ym = String(row?.month ?? "").trim();
          if (/^\d{4}-\d{2}$/.test(ym)) actualByMonth.set(ym, Number(row?.kwh) || 0);
        }
        dataset.monthly = dataset.monthly.map((m: { month?: string; kwh?: number }) => {
          const ym = String(m?.month ?? "").trim();
          if (!/^\d{4}-\d{2}$/.test(ym)) return { month: m?.month ?? "", kwh: Number(m?.kwh) || 0 };
          if (travelMonthsSet.has(ym)) return { month: ym, kwh: Number(m?.kwh) || 0 };
          const actualKwh = actualByMonth.get(ym);
          if (typeof actualKwh !== "number" || !Number.isFinite(actualKwh)) return { month: ym, kwh: Number(m?.kwh) || 0 };
          return { month: ym, kwh: actualKwh };
        });
        const overlaySum = (dataset.monthly as Array<{ kwh?: number }>).reduce((s, r) => s + (Number(r?.kwh) || 0), 0);
        if (dataset.summary && typeof dataset.summary === "object") {
          (dataset.summary as any).totalKwh = Math.round(overlaySum * 100) / 100;
        }
      }
    } catch {
      /* keep curve without overlay */
    }
    if (dataset && actualWxByDateKey && actualWxByDateKey.size > 0) {
      (dataset as any).dailyWeather = Object.fromEntries(
        Array.from(actualWxByDateKey.entries()).map(([dateKey, w]) => [
          dateKey,
          { tAvgF: w.tAvgF, tMinF: w.tMinF, tMaxF: w.tMaxF, hdd65: w.hdd65, cdd65: w.cdd65 },
        ])
      );
    }
    return { dataset };
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
        } catch {
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
}): Promise<
  | { ok: true; houseId: string; scenarioKey: string; scenarioId: string | null; dataset: any }
  | {
      ok: false;
      code: "NO_BUILD" | "SCENARIO_NOT_FOUND" | "HOUSE_NOT_FOUND" | "INTERNAL_ERROR";
      message: string;
      inputHash?: string;
      engineVersion?: string;
    }
> {
  try {
    const scenarioKey = normalizeScenarioKey(args.scenarioId);
    const scenarioId = scenarioKey === "BASELINE" ? null : scenarioKey;

    const house = await getHouseAddressForUserHouse({ userId: args.userId, houseId: args.houseId });
    if (!house) return { ok: false, code: "HOUSE_NOT_FOUND", message: "House not found for user" };

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
      if (isPastScenario && isSmtBaselineMode && scenarioId) {
        const pastEventCount = await (prisma as any).usageSimulatorScenarioEvent
          .count({ where: { scenarioId } })
          .catch(() => 0);
        if (!pastEventCount || pastEventCount <= 0) {
          const baselineRes = await getSimulatedUsageForHouseScenario({
            userId: args.userId,
            houseId: args.houseId,
            scenarioId: null,
          });
          if (baselineRes.ok) {
            dataset = baselineRes.dataset;
            dataset.meta = {
              ...(dataset.meta ?? {}),
              scenarioKey,
              scenarioId,
              mirroredFromBaseline: true,
            };
          }
        }
      }

      const pastSimulatedList = (buildInputs as any).pastSimulatedMonths;
      // Never return raw actual for Past + SMT/GB so completeActualIntervalsV1 always runs (Travel/Vacant + missing intervals fill).
      const pastHasNoEvents =
        isPastScenario &&
        (pastSimulatedList == null || !Array.isArray(pastSimulatedList) || pastSimulatedList.length === 0) &&
        !isSmtBaselineMode;
      if (pastHasNoEvents) {
        const actualResult = await getActualUsageDatasetForHouse(args.houseId, house.esiid ?? null);
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
          });
          const scenarioIdForCache = scenarioId ?? "BASELINE";
          const cacheKeyDiag = {
            inputHash,
            engineVersion: PAST_ENGINE_VERSION,
            intervalDataFingerprint,
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
            // Recompute monthly from decoded intervals (UTC month) so totals match daily and no zeros from stale cache.
            const curveEnd = String((cached.datasetJson as any)?.summary?.end ?? endDate).slice(0, 10);
            if (/^\d{4}-\d{2}-\d{2}$/.test(curveEnd) && Array.isArray(decoded) && decoded.length > 0) {
              const intervalsForMonthly = decoded.map((p: { timestamp: string; kwh: number }) => ({
                timestamp: String(p?.timestamp ?? ""),
                consumption_kwh: Number(p?.kwh) || 0,
              }));
              const { monthly: recomputedMonthly, usageBucketsByMonth: recomputedBuckets } =
                buildDisplayMonthlyFromIntervalsUtc(intervalsForMonthly, curveEnd);
              (dataset as any).monthly = recomputedMonthly;
              (dataset as any).usageBucketsByMonth = recomputedBuckets;
              const sumKwh = recomputedMonthly.reduce((s: number, m: { kwh?: number }) => s + (Number(m?.kwh) || 0), 0);
              if (dataset.summary && typeof dataset.summary === "object") {
                (dataset.summary as any).totalKwh = Math.round(sumKwh * 100) / 100;
              }
              if (dataset.totals && typeof dataset.totals === "object") {
                const r = Math.round(sumKwh * 100) / 100;
                (dataset.totals as any).importKwh = r;
                (dataset.totals as any).netKwh = r;
              }
              const recomputedDaily = buildDailyFromIntervals(decoded);
              (dataset as any).daily = recomputedDaily;
            }
            if (!dataset.meta || typeof dataset.meta !== "object") (dataset as any).meta = {};
            (dataset.meta as any).pastWindowDiag = pastWindowDiag;
            (dataset.meta as any).pastBuildIntervalsFetchCount = 0;
            (dataset.meta as any).cacheKeyDiag = cacheKeyDiag;
            (dataset.meta as any).sourceOfDaySimulationCore = SOURCE_OF_DAY_SIMULATION_CORE;
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
        const actualResult = await getActualUsageDatasetForHouse(args.houseId, house.esiid ?? null);
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