import { NextRequest, NextResponse } from "next/server";

import { requireAdmin } from "@/lib/auth/admin";
import { prisma } from "@/lib/db";
import { normalizeEmailSafe } from "@/lib/utils/email";
import { getActualIntervalsForRangeWithSource } from "@/lib/usage/actualDatasetForHouse";
import { getIntervalDataFingerprint } from "@/lib/usage/actualDatasetForHouse";
import { normalizeStoredApplianceProfile } from "@/modules/applianceProfile/validation";
import { getApplianceProfileSimulatedByUserHouse } from "@/modules/applianceProfile/repo";
import { getHomeProfileSimulatedByUserHouse } from "@/modules/homeProfile/repo";
import { buildPastSimulatedBaselineV1, type PastSimulationDebug } from "@/modules/simulatedUsage/engine";
import { getUsageShapeProfileIdentityForPast } from "@/modules/simulatedUsage/simulatePastUsageDataset";
import { getHouseWeatherDays } from "@/modules/weather/repo";
import { computePastWeatherIdentity } from "@/modules/weather/identity";
import { enumerateDayStartsMsForWindow, dateKeyFromTimestamp, getDayGridTimestamps } from "@/modules/usageSimulator/pastStitchedCurve";
import { recalcSimulatorBuild, getSimulatedUsageForHouseScenario } from "@/modules/usageSimulator/service";
import { travelRangesToExcludeDateKeys } from "@/modules/usageSimulator/build";
import { computePastInputHash, PAST_ENGINE_VERSION } from "@/modules/usageSimulator/pastCache";
import { resolveWindowFromBuildInputsForPastIdentity } from "@/modules/usageSimulator/windowIdentity";

export const dynamic = "force-dynamic";

const WORKSPACE_PAST_NAME = "Past (Corrected)";
const WORKSPACE_FUTURE_NAME = "Future (What-if)";
const INSPECT_INTERVAL_LIMIT = 96;

function toBool(v: string | null): boolean {
  const s = String(v ?? "").trim().toLowerCase();
  return s === "1" || s === "true" || s === "yes";
}

function datasetDebugView(dataset: any, includeSeries: boolean): any {
  if (!dataset || typeof dataset !== "object") return null;
  const intervals15 = Array.isArray(dataset?.series?.intervals15) ? dataset.series.intervals15 : [];
  const hourly = Array.isArray(dataset?.series?.hourly) ? dataset.series.hourly : [];
  const daily = Array.isArray(dataset?.series?.daily) ? dataset.series.daily : [];
  const monthly = Array.isArray(dataset?.series?.monthly) ? dataset.series.monthly : [];

  if (includeSeries) return dataset;

  return {
    summary: dataset.summary ?? null,
    totals: dataset.totals ?? null,
    meta: dataset.meta ?? null,
    monthly: Array.isArray(dataset.monthly) ? dataset.monthly : [],
    insights: dataset.insights ?? null,
    seriesDebug: {
      intervals15Count: intervals15.length,
      hourlyCount: hourly.length,
      dailyCount: daily.length,
      monthlyCount: monthly.length,
      intervals15Sample: intervals15.slice(0, 96),
      hourlySample: hourly.slice(0, 24),
      dailySample: daily.slice(0, 31),
      monthlySample: monthly.slice(0, 24),
    },
  };
}

function summarizeIntervalsSlice(
  intervals: Array<{ timestamp: string; kwh: number }>,
  includeAll: boolean
): {
  rows: Array<{ timestamp: string; kwh: number }>;
  coverageStart: string | null;
  coverageEnd: string | null;
  intervalCount: number;
  truncated: boolean;
  truncationLimit: number;
} {
  const sorted = (intervals ?? [])
    .map((p) => ({ timestamp: String(p?.timestamp ?? ""), kwh: Number(p?.kwh) || 0 }))
    .filter((p) => p.timestamp.length > 0)
    .sort((a, b) => (a.timestamp < b.timestamp ? -1 : a.timestamp > b.timestamp ? 1 : 0));
  const truncationLimit = includeAll ? sorted.length : INSPECT_INTERVAL_LIMIT;
  const rows = includeAll ? sorted : sorted.slice(0, INSPECT_INTERVAL_LIMIT);
  return {
    rows,
    coverageStart: sorted[0]?.timestamp ?? null,
    coverageEnd: sorted[sorted.length - 1]?.timestamp ?? null,
    intervalCount: sorted.length,
    truncated: sorted.length > rows.length,
    truncationLimit,
  };
}

function dayTotalFromIntervalsUtc(
  intervals: Array<{ timestamp: string; kwh: number }>,
  dateKey: string | null
): number | null {
  if (!dateKey) return null;
  const sum = (intervals ?? []).reduce((acc, p) => {
    const ts = String(p?.timestamp ?? "");
    if (ts.slice(0, 10) !== dateKey) return acc;
    return acc + (Number(p?.kwh) || 0);
  }, 0);
  return Math.round(sum * 100) / 100;
}

export async function GET(req: NextRequest) {
  const gate = requireAdmin(req);
  if (!gate.ok) return NextResponse.json(gate.body, { status: gate.status });

  try {
    const url = new URL(req.url);
    const email = normalizeEmailSafe(url.searchParams.get("email"));
    if (!email) {
      return NextResponse.json({ ok: false, error: "Valid email is required." }, { status: 400 });
    }

    const requestedHouseId = String(url.searchParams.get("houseId") ?? "").trim();
    const selector = String(url.searchParams.get("scenario") ?? "past").trim().toLowerCase();
    const requestedScenarioId = String(url.searchParams.get("scenarioId") ?? "").trim();
    const includeSeries = toBool(url.searchParams.get("includeSeries"));
    const includeBuildInputsRaw = toBool(url.searchParams.get("includeBuildInputsRaw"));
    const includeDayDiagnosticsParam = url.searchParams.get("includeDayDiagnostics");
    const includeDayDiagnostics = includeDayDiagnosticsParam == null ? true : toBool(includeDayDiagnosticsParam);
    const dayDiagnosticsLimitParam = Number(url.searchParams.get("dayDiagnosticsLimit"));
    const dayDiagnosticsLimit = Number.isFinite(dayDiagnosticsLimitParam)
      ? Math.max(10, Math.min(2000, Math.trunc(dayDiagnosticsLimitParam)))
      : 400;
    const doRecalc = toBool(url.searchParams.get("recalc"));

    const modeRaw = String(url.searchParams.get("mode") ?? "").trim();
    const weatherPreferenceRaw = String(url.searchParams.get("weatherPreference") ?? "").trim();

    const user = await prisma.user.findUnique({
      where: { email },
      select: { id: true, email: true },
    });
    if (!user?.id) {
      return NextResponse.json({ ok: false, error: "User not found for email." }, { status: 404 });
    }

    const houses = await prisma.houseAddress.findMany({
      where: { userId: user.id, archivedAt: null },
      select: {
        id: true,
        label: true,
        addressLine1: true,
        addressCity: true,
        addressState: true,
        esiid: true,
        isPrimary: true,
        updatedAt: true,
      },
      orderBy: [{ isPrimary: "desc" }, { updatedAt: "desc" }],
    });

    if (!houses.length) {
      return NextResponse.json({ ok: false, error: "No active houses found for this user." }, { status: 404 });
    }

    const selectedHouse =
      (requestedHouseId ? houses.find((h) => h.id === requestedHouseId) : null) ??
      houses[0];

    const scenarios = await prisma.usageSimulatorScenario.findMany({
      where: { userId: user.id, houseId: selectedHouse.id, archivedAt: null },
      select: { id: true, name: true, createdAt: true, updatedAt: true },
      orderBy: [{ updatedAt: "desc" }, { createdAt: "desc" }],
    });

    let scenarioId: string | null = null;
    if (requestedScenarioId) {
      const byId = scenarios.find((s) => s.id === requestedScenarioId);
      if (!byId) {
        return NextResponse.json({ ok: false, error: "scenarioId does not belong to this house/user." }, { status: 400 });
      }
      scenarioId = byId.id;
    } else if (selector === "baseline") {
      scenarioId = null;
    } else if (selector === "future") {
      scenarioId = scenarios.find((s) => s.name === WORKSPACE_FUTURE_NAME)?.id ?? null;
    } else {
      scenarioId = scenarios.find((s) => s.name === WORKSPACE_PAST_NAME)?.id ?? null;
    }

    const scenarioKey = scenarioId ?? "BASELINE";

    if (doRecalc) {
      const baselineBuild = await (prisma as any).usageSimulatorBuild
        .findUnique({
          where: {
            userId_houseId_scenarioKey: {
              userId: user.id,
              houseId: selectedHouse.id,
              scenarioKey: "BASELINE",
            },
          },
          select: { buildInputs: true },
        })
        .catch(() => null);
      const fallbackMode = String((baselineBuild?.buildInputs as any)?.mode ?? "SMT_BASELINE");
      const mode =
        modeRaw === "MANUAL_TOTALS" || modeRaw === "NEW_BUILD_ESTIMATE" || modeRaw === "SMT_BASELINE"
          ? modeRaw
          : fallbackMode;
      const weatherPreference =
        weatherPreferenceRaw === "NONE" ||
        weatherPreferenceRaw === "LAST_YEAR_WEATHER" ||
        weatherPreferenceRaw === "LONG_TERM_AVERAGE"
          ? weatherPreferenceRaw
          : undefined;

      await recalcSimulatorBuild({
        userId: user.id,
        houseId: selectedHouse.id,
        esiid: selectedHouse.esiid ?? null,
        mode: mode as any,
        scenarioId,
        weatherPreference: weatherPreference as any,
        persistPastSimBaseline: false,
      });
    }

    const simulation = await getSimulatedUsageForHouseScenario({
      userId: user.id,
      houseId: selectedHouse.id,
      scenarioId,
    });

    if (!simulation.ok) {
      return NextResponse.json(
        {
          ok: false,
          error: "simulation_fetch_failed",
          detail: simulation.message,
          code: simulation.code,
        },
        { status: 400 }
      );
    }

    const [buildRec, events, homeProfileLive, applianceRecLive] = await Promise.all([
      (prisma as any).usageSimulatorBuild
        .findUnique({
          where: {
            userId_houseId_scenarioKey: {
              userId: user.id,
              houseId: selectedHouse.id,
              scenarioKey,
            },
          },
          select: { buildInputs: true, buildInputsHash: true, lastBuiltAt: true, mode: true, baseKind: true },
        })
        .catch(() => null),
      scenarioId
        ? prisma.usageSimulatorScenarioEvent.findMany({
            where: { scenarioId },
            select: { id: true, effectiveMonth: true, kind: true, payloadJson: true, createdAt: true, updatedAt: true },
            orderBy: [{ effectiveMonth: "asc" }, { createdAt: "asc" }],
          })
        : Promise.resolve([]),
      getHomeProfileSimulatedByUserHouse({ userId: user.id, houseId: selectedHouse.id }),
      getApplianceProfileSimulatedByUserHouse({ userId: user.id, houseId: selectedHouse.id }),
    ]);

    const buildInputs = (buildRec?.buildInputs as any) ?? null;
    const window = resolveWindowFromBuildInputsForPastIdentity(buildInputs as Record<string, unknown>);

    let weatherContext: any = null;
    let pastPatchPayload: any = null;
    let pastEngineDebug: PastSimulationDebug | null = null;
    let identityContext: any = null;
    let rawActualIntervalsMeta: any = null;
    let rawActualIntervals: Array<{ timestamp: string; kwh: number }> = [];
    let stitchedPastIntervalsMeta: any = null;
    let stitchedPastIntervals: Array<{ timestamp: string; kwh: number }> = [];
    let firstActualOnlyDayComparison: any = null;
    if (window) {
      const travelRanges = Array.isArray(buildInputs?.travelRanges) ? buildInputs.travelRanges : [];
      const timezone = typeof buildInputs?.timezone === "string" ? buildInputs.timezone : "America/Chicago";
      const [intervalDataFingerprint, usageShapeProfileIdentity, weatherIdentity] = await Promise.all([
        getIntervalDataFingerprint({
          houseId: selectedHouse.id,
          esiid: selectedHouse.esiid ?? null,
          startDate: window.startDate,
          endDate: window.endDate,
        }),
        getUsageShapeProfileIdentityForPast(selectedHouse.id),
        computePastWeatherIdentity({
          houseId: selectedHouse.id,
          startDate: window.startDate,
          endDate: window.endDate,
        }),
      ]);
      const inputHash = computePastInputHash({
        engineVersion: PAST_ENGINE_VERSION,
        windowStartUtc: window.startDate,
        windowEndUtc: window.endDate,
        timezone,
        travelRanges,
        buildInputs: (buildInputs ?? {}) as Record<string, unknown>,
        intervalDataFingerprint,
        usageShapeProfileId: usageShapeProfileIdentity.usageShapeProfileId,
        usageShapeProfileVersion: usageShapeProfileIdentity.usageShapeProfileVersion,
        usageShapeProfileDerivedAt: usageShapeProfileIdentity.usageShapeProfileDerivedAt,
        usageShapeProfileSimHash: usageShapeProfileIdentity.usageShapeProfileSimHash,
        weatherIdentity,
      });
      identityContext = {
        windowStartUtc: window.startDate,
        windowEndUtc: window.endDate,
        timezone,
        inputHash,
        engineVersion: PAST_ENGINE_VERSION,
        intervalDataFingerprint,
        weatherIdentity,
        usageShapeProfileIdentity,
      };
    }
    if (window) {
      const canonicalDayStartsMs = enumerateDayStartsMsForWindow(window.startDate, window.endDate);
      const canonicalDateKeys = canonicalDayStartsMs
        .map((ms) => getDayGridTimestamps(ms)[0])
        .map((ts) => dateKeyFromTimestamp(ts))
        .filter((dk) => /^\d{4}-\d{2}-\d{2}$/.test(dk));
      const excludedDateKeys = new Set(
        travelRangesToExcludeDateKeys(Array.isArray(buildInputs?.travelRanges) ? buildInputs.travelRanges : [])
      );

      const [actualWxByDateKey, normalWxByDateKey, rawActualFetch] = await Promise.all([
        getHouseWeatherDays({ houseId: selectedHouse.id, dateKeys: canonicalDateKeys, kind: "ACTUAL_LAST_YEAR" }),
        getHouseWeatherDays({ houseId: selectedHouse.id, dateKeys: canonicalDateKeys, kind: "NORMAL_AVG" }),
        getActualIntervalsForRangeWithSource({
          houseId: selectedHouse.id,
          esiid: selectedHouse.esiid ?? null,
          startDate: window.startDate,
          endDate: window.endDate,
        }),
      ]);
      const actualIntervals = rawActualFetch.intervals ?? [];

      const actualKeys = new Set(Array.from(actualWxByDateKey.keys()));
      const normalKeys = new Set(Array.from(normalWxByDateKey.keys()));
      const missingActual = canonicalDateKeys.filter((dk) => !actualKeys.has(dk));
      const missingNormal = canonicalDateKeys.filter((dk) => !normalKeys.has(dk));

      weatherContext = {
        canonicalDateKeys: canonicalDateKeys.length,
        actualWeatherRows: actualWxByDateKey.size,
        normalWeatherRows: normalWxByDateKey.size,
        missingActualCount: missingActual.length,
        missingNormalCount: missingNormal.length,
        missingActualSample: missingActual.slice(0, 30),
        missingNormalSample: missingNormal.slice(0, 30),
      };

      const rawSection = summarizeIntervalsSlice(actualIntervals, includeSeries);
      rawActualIntervals = rawSection.rows;
      rawActualIntervalsMeta = {
        label: "Raw actual intervals",
        source:
          rawActualFetch.source === "SMT" || rawActualFetch.source === "GREEN_BUTTON"
            ? rawActualFetch.source
            : "none",
        coverageStart: rawSection.coverageStart,
        coverageEnd: rawSection.coverageEnd,
        intervalCount: rawSection.intervalCount,
        truncated: rawSection.truncated,
        truncationLimit: rawSection.truncationLimit,
      };

      const homeProfile = homeProfileLive ? { ...homeProfileLive } : buildInputs?.snapshots?.homeProfile ?? null;
      const applianceProfile = normalizeStoredApplianceProfile(
        (applianceRecLive?.appliancesJson as any) ?? buildInputs?.snapshots?.applianceProfile ?? null
      );

      if (String(buildInputs?.mode ?? "") === "SMT_BASELINE") {
        const debugOut: PastSimulationDebug = {
          totalDays: 0,
          excludedDays: 0,
          leadingMissingDays: 0,
          referenceDaysUsed: 0,
          simulatedDays: 0,
          dayDiagnostics: [],
        };
        buildPastSimulatedBaselineV1({
          actualIntervals,
          canonicalDayStartsMs,
          excludedDateKeys,
          dateKeyFromTimestamp,
          getDayGridTimestamps,
          homeProfile,
          applianceProfile,
          actualWxByDateKey,
          _normalWxByDateKey: normalWxByDateKey,
          debug: {
            collectDayDiagnostics: includeDayDiagnostics,
            maxDayDiagnostics: dayDiagnosticsLimit,
            out: debugOut,
          },
        });
        pastEngineDebug = debugOut;

        pastPatchPayload = {
          mode: buildInputs?.mode ?? null,
          startDate: window.startDate,
          endDate: window.endDate,
          actualIntervalsCount: actualIntervals.length,
          canonicalDays: canonicalDayStartsMs.length,
          excludedDateKeysCount: excludedDateKeys.size,
          hasHomeProfile: Boolean(homeProfile),
          hasApplianceProfile: Boolean(applianceProfile),
          weatherRows: {
            actual: actualWxByDateKey.size,
            normal: normalWxByDateKey.size,
          },
          dayStats: pastEngineDebug
            ? {
                totalDays: pastEngineDebug.totalDays,
                excludedDays: pastEngineDebug.excludedDays,
                leadingMissingDays: pastEngineDebug.leadingMissingDays,
                referenceDaysUsed: pastEngineDebug.referenceDaysUsed,
                simulatedDays: pastEngineDebug.simulatedDays,
              }
            : null,
          dayDiagnosticsSample: pastEngineDebug?.dayDiagnostics ?? [],
          callSignature:
            "buildPastSimulatedBaselineV1(actualIntervals, canonicalDayStartsMs, excludedDateKeys, homeProfile, applianceProfile, actualWxByDateKey)",
          implementationRef: "buildPastSimulatedBaselineV1",
        };
      }

      const stitchedAll = Array.isArray(simulation.dataset?.series?.intervals15)
        ? (simulation.dataset.series.intervals15 as Array<{ timestamp: string; kwh: number }>)
        : [];
      const stitchedSection = summarizeIntervalsSlice(stitchedAll, includeSeries);
      stitchedPastIntervals = stitchedSection.rows;
      stitchedPastIntervalsMeta = {
        label: "Final stitched Past corrected-baseline intervals",
        source: "simulation_dataset",
        coverageStart: stitchedSection.coverageStart,
        coverageEnd: stitchedSection.coverageEnd,
        intervalCount: stitchedSection.intervalCount,
        truncated: stitchedSection.truncated,
        truncationLimit: stitchedSection.truncationLimit,
      };

      const excludedDateKeysForCompare = new Set(
        travelRangesToExcludeDateKeys(Array.isArray(buildInputs?.travelRanges) ? buildInputs.travelRanges : [])
      );
      const firstActualOnlyDate = canonicalDateKeys.find((dk) => !excludedDateKeysForCompare.has(dk)) ?? null;
      firstActualOnlyDayComparison = {
        date: firstActualOnlyDate,
        rawActualDayTotalKwh: dayTotalFromIntervalsUtc(actualIntervals, firstActualOnlyDate),
        stitchedPastDayTotalKwh: dayTotalFromIntervalsUtc(stitchedAll, firstActualOnlyDate),
        note:
          "Earliest canonical day that is not in travel/vacant exclusions; compare raw actual vs final stitched Past totals.",
      };
    }

    const applianceProfileLive = normalizeStoredApplianceProfile((applianceRecLive?.appliancesJson as any) ?? null);
    const scenarioName = scenarioId ? scenarios.find((s) => s.id === scenarioId)?.name ?? null : "BASELINE";

    return NextResponse.json({
      ok: true,
      selection: {
        email,
        houseId: selectedHouse.id,
        scenarioId,
        scenarioKey,
        scenarioName,
        includeSeries,
        includeBuildInputsRaw,
        includeDayDiagnostics,
        dayDiagnosticsLimit,
      },
      user: { id: user.id, email: user.email },
      house: {
        id: selectedHouse.id,
        label: selectedHouse.label,
        addressLine1: selectedHouse.addressLine1,
        city: selectedHouse.addressCity,
        state: selectedHouse.addressState,
        esiid: selectedHouse.esiid,
        isPrimary: selectedHouse.isPrimary,
      },
      availableHouses: houses.map((h) => ({
        id: h.id,
        label: h.label,
        addressLine1: h.addressLine1,
        city: h.addressCity,
        state: h.addressState,
        esiid: h.esiid,
        isPrimary: h.isPrimary,
      })),
      availableScenarios: scenarios.map((s) => ({
        id: s.id,
        name: s.name,
        updatedAt: s.updatedAt,
      })),
      events,
      result: {
        scenarioKey: simulation.scenarioKey,
        scenarioId: simulation.scenarioId,
        dataset: datasetDebugView(simulation.dataset, includeSeries),
      },
      build: {
        mode: buildRec?.mode ?? null,
        baseKind: buildRec?.baseKind ?? null,
        buildInputsHash: buildRec?.buildInputsHash ?? null,
        lastBuiltAt: buildRec?.lastBuiltAt ?? null,
        selected: buildInputs
          ? {
              mode: buildInputs.mode ?? null,
              baseKind: buildInputs.baseKind ?? null,
              weatherPreference: buildInputs.weatherPreference ?? null,
              canonicalEndMonth: buildInputs.canonicalEndMonth ?? null,
              canonicalMonthsCount: Array.isArray(buildInputs.canonicalMonths) ? buildInputs.canonicalMonths.length : 0,
              travelRanges: buildInputs.travelRanges ?? [],
              notes: buildInputs.notes ?? [],
              filledMonths: buildInputs.filledMonths ?? [],
              pastSimulatedMonths: buildInputs.pastSimulatedMonths ?? [],
              snapshots: {
                actualSource: buildInputs?.snapshots?.actualSource ?? null,
                scenario: buildInputs?.snapshots?.scenario ?? null,
                hasHomeProfile: Boolean(buildInputs?.snapshots?.homeProfile),
                hasApplianceProfile: Boolean(buildInputs?.snapshots?.applianceProfile),
              },
            }
          : null,
        raw: includeBuildInputsRaw ? buildInputs : undefined,
      },
      profiles: {
        homeProfileLive,
        applianceProfileLive,
        homeProfileBuildSnapshot: buildInputs?.snapshots?.homeProfile ?? null,
        applianceProfileBuildSnapshot: buildInputs?.snapshots?.applianceProfile ?? null,
      },
      engineContext: {
        identity: identityContext,
        weather: weatherContext,
        pastPatchPayload,
        rawActualIntervalsMeta,
        rawActualIntervals,
        stitchedPastIntervalsMeta,
        stitchedPastIntervals,
        firstActualOnlyDayComparison,
      },
    });
  } catch (e: any) {
    return NextResponse.json(
      {
        ok: false,
        error: "simulation_engines_debug_failed",
        detail: String(e?.message ?? e),
      },
      { status: 500 }
    );
  }
}

