import { NextRequest, NextResponse } from "next/server";

import { requireAdmin } from "@/lib/auth/admin";
import { runSimulatorDiagnostic } from "@/lib/admin/simulatorDiagnostic";
import { prisma } from "@/lib/db";
import { normalizeEmailSafe } from "@/lib/utils/email";
import { normalizeStoredApplianceProfile } from "@/modules/applianceProfile/validation";
import { getApplianceProfileSimulatedByUserHouse } from "@/modules/applianceProfile/repo";
import { getHomeProfileSimulatedByUserHouse } from "@/modules/homeProfile/repo";
import { getSimulatedUsageForHouseScenario } from "@/modules/usageSimulator/service";
import { dispatchPastSimRecalc } from "@/modules/usageSimulator/pastSimRecalcDispatch";
import { getPastSimRecalcJobForUser } from "@/modules/usageSimulator/simDropletJob";

export const dynamic = "force-dynamic";

const WORKSPACE_PAST_NAME = "Past (Corrected)";
const WORKSPACE_FUTURE_NAME = "Future (What-if)";

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

    const pastRecalcJobIdPoll = String(url.searchParams.get("pastRecalcJobId") ?? "").trim();
    if (pastRecalcJobIdPoll) {
      const job = await getPastSimRecalcJobForUser({ jobId: pastRecalcJobIdPoll, userId: user.id });
      if (!job.ok) {
        return NextResponse.json({ ok: false, error: "past_recalc_job_not_found" }, { status: 404 });
      }
      return NextResponse.json({
        ok: true,
        executionMode: "droplet_async",
        pastRecalcJobId: pastRecalcJobIdPoll,
        pastRecalcJobStatus: job.status,
        failureMessage: job.failureMessage,
      });
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

    let pastRecalcExecutionMode: "droplet_async" | "inline" | undefined;
    let pastRecalcJobId: string | undefined;

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

      const dispatched = await dispatchPastSimRecalc({
        userId: user.id,
        houseId: selectedHouse.id,
        esiid: selectedHouse.esiid ?? null,
        mode: mode as any,
        scenarioId,
        weatherPreference: weatherPreference as any,
        persistPastSimBaseline: false,
      });
      if (dispatched.executionMode === "droplet_async") {
        pastRecalcExecutionMode = "droplet_async";
        pastRecalcJobId = dispatched.jobId;
      } else {
        pastRecalcExecutionMode = "inline";
        if (!dispatched.result.ok) {
          const status = dispatched.result.error === "recalc_timeout" ? 504 : 400;
          return NextResponse.json(
            { ...dispatched.result, correlationId: dispatched.correlationId },
            { status }
          );
        }
      }
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

    let weatherContext: any = null;
    let pastPatchPayload: any = null;
    let identityContext: any = null;
    let rawActualIntervalsMeta: any = null;
    let rawActualIntervals: Array<{ timestamp: string; kwh: number }> = [];
    let stitchedPastIntervalsMeta: any = null;
    let stitchedPastIntervals: Array<{ timestamp: string; kwh: number }> = [];
    let firstActualOnlyDayComparison: any = null;

    if (buildInputs) {
      const diagnostic = await runSimulatorDiagnostic({
        userId: user.id,
        houseId: selectedHouse.id,
        esiid: selectedHouse.esiid ?? null,
        buildInputs,
        scenarioId,
        scenarioKey,
        buildInputsHash: buildRec?.buildInputsHash ?? null,
      });
      if (diagnostic.ok) {
        identityContext = {
          windowStartUtc: diagnostic.identity.windowStartUtc,
          windowEndUtc: diagnostic.identity.windowEndUtc,
          timezone: diagnostic.identity.timezone,
          inputHash: diagnostic.identity.inputHash,
          engineVersion: diagnostic.identity.engineVersion,
          intervalDataFingerprint: diagnostic.identity.intervalDataFingerprint,
          weatherIdentity: diagnostic.identity.weatherIdentity,
          usageShapeProfileIdentity: diagnostic.identity.usageShapeProfileIdentity,
          buildInputsHash: diagnostic.identity.buildInputsHash,
          note: "Identity details in this inspect route come from shared diagnostic/service orchestration.",
        };
        weatherContext = {
          weatherProvenance: diagnostic.weatherProvenance,
          stubAudit: diagnostic.stubAudit,
        };
        pastPatchPayload = {
          ...diagnostic.pastPath,
          dayLevelParity: includeDayDiagnostics ? (diagnostic.dayLevelParity ?? null) : null,
          dayDiagnosticsLimit,
          integrity: diagnostic.integrity ?? null,
        };
        rawActualIntervalsMeta = diagnostic.rawActualIntervalsMeta;
        rawActualIntervals = diagnostic.rawActualIntervals;
        stitchedPastIntervalsMeta = diagnostic.stitchedPastIntervalsMeta;
        stitchedPastIntervals = diagnostic.stitchedPastIntervals;
        firstActualOnlyDayComparison = diagnostic.firstActualOnlyDayComparison;
      } else {
        pastPatchPayload = {
          diagnosticError: diagnostic.error,
        };
      }
    }

    const applianceProfileLive = normalizeStoredApplianceProfile((applianceRecLive?.appliancesJson as any) ?? null);
    const scenarioName = scenarioId ? scenarios.find((s) => s.id === scenarioId)?.name ?? null : "BASELINE";

    return NextResponse.json({
      ok: true,
      ...(pastRecalcExecutionMode != null
        ? {
            pastRecalcExecutionMode,
            ...(pastRecalcJobId != null ? { pastRecalcJobId } : {}),
          }
        : {}),
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

