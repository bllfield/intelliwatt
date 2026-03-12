import { canonicalIntervalKey, dateKeyInTimezone } from "@/lib/admin/gapfillLab";
import { buildAndSavePastForGapfillLab, inspectPastCacheArtifacts } from "@/lib/admin/gapfillLabPrime";
import { buildDisplayMonthlyFromIntervalsUtc } from "@/modules/usageSimulator/dataset";
import { displayProfilesFromModelMeta } from "@/modules/usageSimulator/profileDisplay";
import { getSimulatedUsageForHouseScenario } from "@/modules/usageSimulator/service";

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

function round2(n: number) {
  return Math.round((Number(n) || 0) * 100) / 100;
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
        body: { ok: false, error: rebuilt.error, message: rebuilt.message },
      };
    }
  } else {
    const inspect = await inspectPastCacheArtifacts({
      houseId,
      scenarioId: "gapfill_lab",
    });
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

  if (simOut.ok && initialIntervals15.length > 0 && initialIntervals15.length < expectedChartIntervalCount) {
    const staleRebuild = await buildAndSavePastForGapfillLab({
      userId,
      houseId,
      rangesToMask: testRangesUsed,
      timezone,
    });
    if (staleRebuild.ok) {
      artifactAutoRebuilt = true;
      simOut = await getSimulatedUsageForHouseScenario({
        userId,
        houseId,
        scenarioId: "gapfill_lab",
        readMode: "artifact_only",
      });
    }
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
      simKwh: round2(simKwh),
      source:
        daySourceFromDataset.get(date) ??
        (fallbackSimulatedDateKeysLocal?.has(date) ? "SIMULATED" : "ACTUAL"),
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
