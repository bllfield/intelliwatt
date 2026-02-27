import { NextRequest, NextResponse } from "next/server";

import { requireAdmin } from "@/lib/auth/admin";
import { prisma } from "@/lib/db";
import { normalizeEmailSafe } from "@/lib/utils/email";
import { getActualIntervalsForRange } from "@/lib/usage/actualDatasetForHouse";
import { normalizeStoredApplianceProfile } from "@/modules/applianceProfile/validation";
import { getApplianceProfileSimulatedByUserHouse } from "@/modules/applianceProfile/repo";
import { getHomeProfileSimulatedByUserHouse } from "@/modules/homeProfile/repo";
import { buildPastSimulatedBaselineV1 } from "@/modules/simulatedUsage/engine";
import { getHouseWeatherDays } from "@/modules/weather/repo";
import { enumerateDayStartsMsForWindow, dateKeyFromTimestamp, getDayGridTimestamps } from "@/modules/usageSimulator/pastStitchedCurve";
import { recalcSimulatorBuild, getSimulatedUsageForHouseScenario } from "@/modules/usageSimulator/service";
import { travelRangesToExcludeDateKeys } from "@/modules/usageSimulator/build";

export const dynamic = "force-dynamic";

const WORKSPACE_PAST_NAME = "Past (Corrected)";
const WORKSPACE_FUTURE_NAME = "Future (What-if)";

function toBool(v: string | null): boolean {
  const s = String(v ?? "").trim().toLowerCase();
  return s === "1" || s === "true" || s === "yes";
}

function safeDate(v: unknown): string | null {
  const s = String(v ?? "").slice(0, 10);
  return /^\d{4}-\d{2}-\d{2}$/.test(s) ? s : null;
}

function getWindowFromBuildInputs(buildInputs: any): { startDate: string; endDate: string } | null {
  const periods = Array.isArray(buildInputs?.canonicalPeriods) ? buildInputs.canonicalPeriods : [];
  const first = periods.length > 0 ? safeDate(periods[0]?.startDate) : null;
  const last = periods.length > 0 ? safeDate(periods[periods.length - 1]?.endDate) : null;
  if (first && last) return { startDate: first, endDate: last };

  const months = Array.isArray(buildInputs?.canonicalMonths) ? buildInputs.canonicalMonths : [];
  const firstMonth = String(months[0] ?? "");
  const lastMonth = String(months[months.length - 1] ?? "");
  if (!/^\d{4}-\d{2}$/.test(firstMonth) || !/^\d{4}-\d{2}$/.test(lastMonth)) return null;
  const [y, m] = lastMonth.split("-").map(Number);
  const lastDay = new Date(Date.UTC(y, m, 0)).getUTCDate();
  return { startDate: `${firstMonth}-01`, endDate: `${lastMonth}-${String(lastDay).padStart(2, "0")}` };
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
    const window = getWindowFromBuildInputs(buildInputs);

    let weatherContext: any = null;
    let pastPatchPayload: any = null;
    if (window) {
      const canonicalDayStartsMs = enumerateDayStartsMsForWindow(window.startDate, window.endDate);
      const canonicalDateKeys = canonicalDayStartsMs
        .map((ms) => getDayGridTimestamps(ms)[0])
        .map((ts) => dateKeyFromTimestamp(ts))
        .filter((dk) => /^\d{4}-\d{2}-\d{2}$/.test(dk));
      const excludedDateKeys = new Set(
        travelRangesToExcludeDateKeys(Array.isArray(buildInputs?.travelRanges) ? buildInputs.travelRanges : [])
      );

      const [actualWxByDateKey, normalWxByDateKey, actualIntervals] = await Promise.all([
        getHouseWeatherDays({ houseId: selectedHouse.id, dateKeys: canonicalDateKeys, kind: "ACTUAL_LAST_YEAR" }),
        getHouseWeatherDays({ houseId: selectedHouse.id, dateKeys: canonicalDateKeys, kind: "NORMAL_AVG" }),
        getActualIntervalsForRange({
          houseId: selectedHouse.id,
          esiid: selectedHouse.esiid ?? null,
          startDate: window.startDate,
          endDate: window.endDate,
        }),
      ]);

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

      const homeProfile = homeProfileLive ? { ...homeProfileLive } : buildInputs?.snapshots?.homeProfile ?? null;
      const applianceProfile = normalizeStoredApplianceProfile(
        (applianceRecLive?.appliancesJson as any) ?? buildInputs?.snapshots?.applianceProfile ?? null
      );

      if (String(buildInputs?.mode ?? "") === "SMT_BASELINE") {
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
          callSignature:
            "buildPastSimulatedBaselineV1(actualIntervals, canonicalDayStartsMs, excludedDateKeys, homeProfile, applianceProfile, actualWxByDateKey)",
          implementationRef: String(buildPastSimulatedBaselineV1.name || "buildPastSimulatedBaselineV1"),
        };
      }
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
        weather: weatherContext,
        pastPatchPayload,
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

