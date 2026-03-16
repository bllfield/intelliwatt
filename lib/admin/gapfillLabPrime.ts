/**
 * Prime the Gap-Fill Lab cache (scenarioId "gapfill_lab") so Run Compare gets a cache hit.
 * Used when the user has entered eval ranges: we build with buildExcludedRanges = db ∪ eval
 * and save to gapfill_lab with the same key the lab uses.
 */

import { prisma } from "@/lib/db";
import { usagePrisma } from "@/lib/db/usageClient";
import { localDateKeysInRange } from "@/lib/admin/gapfillLab";
import { getIntervalDataFingerprint } from "@/lib/usage/actualDatasetForHouse";
import { chooseActualSource } from "@/modules/realUsageAdapter/actual";
import { buildSimulatorInputs } from "@/modules/usageSimulator/build";
import type { SimulatorBuildInputsV1 } from "@/modules/usageSimulator/dataset";
import { getPastSimulatedDatasetForHouse } from "@/modules/usageSimulator/service";
import {
  computePastInputHash,
  saveCachedPastDataset,
  PAST_ENGINE_VERSION,
} from "@/modules/usageSimulator/pastCache";
import { resolveWindowFromBuildInputsForPastIdentity } from "@/modules/usageSimulator/windowIdentity";
import { encodeIntervalsV1, INTERVAL_CODEC_V1 } from "@/modules/usageSimulator/intervalCodec";
import { computePastWeatherIdentity } from "@/modules/weather/identity";
import { getHomeProfileSimulatedByUserHouse } from "@/modules/homeProfile/repo";
import { getApplianceProfileSimulatedByUserHouse } from "@/modules/applianceProfile/repo";
import { normalizeStoredApplianceProfile } from "@/modules/applianceProfile/validation";
import { getUsageShapeProfileIdentityForPast } from "@/modules/simulatedUsage/simulatePastUsageDataset";
import { enumerateDayStartsMsForWindow, getDayGridTimestamps, dateKeyFromTimestamp } from "@/modules/usageSimulator/pastStitchedCurve";
import { getHouseWeatherDays } from "@/modules/weather/repo";
import { WEATHER_STUB_SOURCE } from "@/modules/weather/types";
import { canonicalUsageWindowForTimezone, prevCalendarDayDateKey, monthsEndingAt } from "@/lib/time/chicago";

const WORKSPACE_PAST_NAME = "Past (Corrected)";

type DateRange = { startDate: string; endDate: string };

function normalizeWindowToInclusiveDays(
  window: { startDate: string; endDate: string },
  totalDays = 365
): { startDate: string; endDate: string } {
  const endDate = String(window?.endDate ?? "").slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(endDate)) {
    return { startDate: String(window?.startDate ?? "").slice(0, 10), endDate };
  }
  const days = Math.max(1, Math.trunc(Number(totalDays) || 365));
  return {
    startDate: prevCalendarDayDateKey(endDate, days - 1),
    endDate,
  };
}

function utcDateKeyFromUtcMs(utcMs: number): string {
  const d = new Date(utcMs);
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}-${String(d.getUTCDate()).padStart(2, "0")}`;
}

function localDateKeyFromUtcMs(utcMs: number, timezone: string): string {
  const dt = new Date(utcMs);
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: timezone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(dt);
  const y = parts.find((p) => p.type === "year")?.value ?? "";
  const m = parts.find((p) => p.type === "month")?.value ?? "";
  const d = parts.find((p) => p.type === "day")?.value ?? "";
  return `${y}-${m}-${d}`;
}

function buildExcludedUtcDateKeySetFromLocalKeys(
  localDateKeys: Set<string>,
  windowStartUtc: string,
  windowEndUtc: string,
  timezone: string
): Set<string> {
  const out = new Set<string>();
  if (!localDateKeys || localDateKeys.size === 0) return out;
  const startMs = Date.UTC(
    Number(windowStartUtc.slice(0, 4)),
    Number(windowStartUtc.slice(5, 7)) - 1,
    Number(windowStartUtc.slice(8, 10)),
    0, 0, 0
  );
  const endMs = Date.UTC(
    Number(windowEndUtc.slice(0, 4)),
    Number(windowEndUtc.slice(5, 7)) - 1,
    Number(windowEndUtc.slice(8, 10)),
    0, 0, 0
  );
  const dayMs = 24 * 60 * 60 * 1000;
  for (let dayStart = startMs; dayStart <= endMs; dayStart += dayMs) {
    const localKey = localDateKeyFromUtcMs(dayStart + 12 * 60 * 60 * 1000, timezone);
    if (localDateKeys.has(localKey)) out.add(utcDateKeyFromUtcMs(dayStart));
  }
  return out;
}

async function getTravelRangesFromDb(userId: string, houseId: string): Promise<DateRange[]> {
  const scenarios = await (prisma as any).usageSimulatorScenario
    .findMany({
      where: { userId, houseId, archivedAt: null },
      select: { id: true },
    })
    .catch(() => []);
  if (!scenarios?.length) return [];
  const scenarioIds = scenarios.map((s: { id: string }) => s.id);
  const events = await (prisma as any).usageSimulatorScenarioEvent
    .findMany({
      where: { scenarioId: { in: scenarioIds }, kind: "TRAVEL_RANGE" },
      select: { payloadJson: true },
    })
    .catch(() => []);
  const seen = new Set<string>();
  const out: DateRange[] = [];
  for (const e of events ?? []) {
    const p = (e as any)?.payloadJson ?? {};
    const startDate = typeof p?.startDate === "string" ? String(p.startDate).slice(0, 10) : "";
    const endDate = typeof p?.endDate === "string" ? String(p.endDate).slice(0, 10) : "";
    if (!/^\d{4}-\d{2}-\d{2}$/.test(startDate) || !/^\d{4}-\d{2}-\d{2}$/.test(endDate)) continue;
    const key = `${startDate}\t${endDate}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({ startDate, endDate });
  }
  out.sort((a, b) => a.startDate.localeCompare(b.startDate) || a.endDate.localeCompare(b.endDate));
  return out;
}

export type PrimeGapfillLabResult =
  | { ok: true; inputHash: string; houseId: string }
  | {
      ok: false;
      error: string;
      message: string;
      windowStartUtc?: string | null;
      windowEndUtc?: string | null;
      missingDateKeys?: string[];
      stubRowCount?: number;
      weatherSourceSummary?: "stub_only" | "actual_only" | "mixed_actual_and_stub" | "none";
      windowHelper?: string;
    };

export async function resolvePastCanonicalWindowForHouse(args: {
  userId: string;
  houseId: string;
}): Promise<
  | {
      ok: true;
      startDate: string;
      endDate: string;
      canonicalMonths: string[];
      windowHelper: "resolveWindowFromBuildInputsForPastIdentity";
    }
  | { ok: false; error: string; message: string }
> {
  const scenario = await (prisma as any).usageSimulatorScenario
    .findFirst({
      where: { userId: args.userId, houseId: args.houseId, name: WORKSPACE_PAST_NAME, archivedAt: null },
      select: { id: true },
    })
    .catch(() => null);
  if (!scenario?.id) {
    return {
      ok: false,
      error: "past_scenario_not_found",
      message: "Past (Corrected) scenario was not found for this house.",
    };
  }
  const buildRec = await (prisma as any).usageSimulatorBuild
    .findUnique({
      where: {
        userId_houseId_scenarioKey: {
          userId: args.userId,
          houseId: args.houseId,
          scenarioKey: String(scenario.id),
        },
      },
      select: { buildInputs: true },
    })
    .catch(() => null);
  if (!buildRec?.buildInputs) {
    return {
      ok: false,
      error: "past_build_missing",
      message: "Past (Corrected) build inputs are missing. Rebuild Past first.",
    };
  }
  const buildInputs = buildRec.buildInputs as Record<string, unknown>;
  const canonicalMonths = Array.isArray((buildInputs as any)?.canonicalMonths)
    ? ((buildInputs as any).canonicalMonths as string[]).map((m) => String(m ?? "").trim()).filter((m) => /^\d{4}-\d{2}$/.test(m))
    : [];
  const window = resolveWindowFromBuildInputsForPastIdentity(buildInputs);
  if (!window || canonicalMonths.length === 0) {
    return {
      ok: false,
      error: "past_window_unresolved",
      message: "Could not resolve canonical Past window from shared window helper.",
    };
  }
  return {
    ok: true,
    startDate: window.startDate,
    endDate: window.endDate,
    canonicalMonths,
    windowHelper: "resolveWindowFromBuildInputsForPastIdentity",
  };
}

export async function inspectPastCacheArtifacts(args: {
  houseId: string;
  scenarioId: string;
}): Promise<{ count: number; latestUpdatedAt: string | null }> {
  try {
    const rows = await (usagePrisma as any).pastSimulatedDatasetCache.findMany({
      where: {
        houseId: args.houseId,
        scenarioId: args.scenarioId,
      },
      orderBy: { updatedAt: "desc" },
      select: { updatedAt: true },
      take: 1,
    });
    const count = await (usagePrisma as any).pastSimulatedDatasetCache.count({
      where: {
        houseId: args.houseId,
        scenarioId: args.scenarioId,
      },
    });
    return {
      count: Number(count) || 0,
      latestUpdatedAt: rows?.[0]?.updatedAt ? new Date(rows[0].updatedAt).toISOString() : null,
    };
  } catch {
    return { count: 0, latestUpdatedAt: null };
  }
}

/**
 * Build Past dataset with buildExcludedRanges = dbTravelRanges ∪ rangesToMask and save to
 * scenarioId "gapfill_lab". Run Compare will then get a cache hit for the same ranges.
 */
export async function buildAndSavePastForGapfillLab(args: {
  userId: string;
  houseId: string;
  rangesToMask: DateRange[];
  timezone: string;
}): Promise<PrimeGapfillLabResult> {
  const { userId, houseId, rangesToMask, timezone } = args;

  const house = await (prisma as any).houseAddress.findFirst({
    where: { id: houseId, archivedAt: null },
    select: { id: true, esiid: true },
  });
  if (!house) {
    return { ok: false, error: "house_not_found", message: "House not found." };
  }
  const esiid = house.esiid ? String(house.esiid) : null;

  const source = await chooseActualSource({ houseId, esiid });
  if (!source) {
    return { ok: false, error: "no_actual_data", message: "No actual interval data (SMT or Green Button)." };
  }

  const normalizedWindow = normalizeWindowToInclusiveDays(
    canonicalUsageWindowForTimezone({ now: new Date(), reliableLagDays: 2, totalDays: 365, timezone }),
    365
  );
  const startDate = normalizedWindow.startDate;
  const endDate = normalizedWindow.endDate;
  const canonicalMonths12 = monthsEndingAt(endDate.slice(0, 7), 12);
  const windowHelper = "canonicalUsageWindowForTimezone";

  const dbTravelRanges = await getTravelRangesFromDb(userId, houseId);
  const dbLocal = new Set<string>(dbTravelRanges.flatMap((r) => localDateKeysInRange(r.startDate, r.endDate, timezone)));
  const evalLocal = new Set<string>(rangesToMask.flatMap((r) => localDateKeysInRange(r.startDate, r.endDate, timezone)));
  const buildExcludedDateKeysLocal = new Set<string>([...Array.from(dbLocal), ...Array.from(evalLocal)]);

  const [homeProfileRec, applianceProfileRec] = await Promise.all([
    getHomeProfileSimulatedByUserHouse({ userId, houseId }),
    getApplianceProfileSimulatedByUserHouse({ userId, houseId }),
  ]);
  if (!homeProfileRec || !applianceProfileRec?.appliancesJson) {
    return {
      ok: false,
      error: "profile_required",
      message: "Production builder requires home and appliance profile for this house.",
    };
  }

  const normalizedAppliance = normalizeStoredApplianceProfile(applianceProfileRec.appliancesJson as any);
  const buildExcludedUtcSet = buildExcludedUtcDateKeySetFromLocalKeys(
    buildExcludedDateKeysLocal,
    startDate,
    endDate,
    timezone
  );
  const buildExcludedRanges: DateRange[] = Array.from(buildExcludedUtcSet)
    .sort()
    .map((d) => ({ startDate: d, endDate: d }));

  const buildResult = await buildSimulatorInputs({
    mode: "SMT_BASELINE",
    manualUsagePayload: null,
    homeProfile: homeProfileRec as any,
    applianceProfile: normalizedAppliance,
    houseIdForActual: houseId,
    esiidForSmt: esiid,
    travelRanges: buildExcludedRanges,
    canonicalMonths: canonicalMonths12,
  });

  const buildInputs: SimulatorBuildInputsV1 = {
    version: 1,
    mode: "SMT_BASELINE",
    baseKind: buildResult.baseKind,
    canonicalMonths: buildResult.canonicalMonths,
    canonicalEndMonth: buildResult.canonicalMonths[buildResult.canonicalMonths.length - 1] ?? "",
    monthlyTotalsKwhByMonth: buildResult.monthlyTotalsKwhByMonth,
    intradayShape96: buildResult.intradayShape96,
    weekdayWeekendShape96: buildResult.weekdayWeekendShape96,
    travelRanges: buildExcludedRanges,
    notes: buildResult.notes ?? [],
    filledMonths: buildResult.filledMonths ?? [],
  };

  const intervalDataFingerprint = await getIntervalDataFingerprint({
    houseId,
    esiid,
    startDate,
    endDate,
  });
  const usageShapeProfileIdentity = await getUsageShapeProfileIdentityForPast(houseId);
  const weatherIdentity = await computePastWeatherIdentity({
    houseId,
    startDate,
    endDate,
  });
  const inputHash = computePastInputHash({
    engineVersion: PAST_ENGINE_VERSION,
    windowStartUtc: startDate,
    windowEndUtc: endDate,
    timezone,
    travelRanges: buildExcludedRanges,
    buildInputs: buildInputs as Record<string, unknown>,
    intervalDataFingerprint,
    usageShapeProfileId: usageShapeProfileIdentity.usageShapeProfileId,
    usageShapeProfileVersion: usageShapeProfileIdentity.usageShapeProfileVersion,
    usageShapeProfileDerivedAt: usageShapeProfileIdentity.usageShapeProfileDerivedAt,
    usageShapeProfileSimHash: usageShapeProfileIdentity.usageShapeProfileSimHash,
    weatherIdentity,
  });

  const pastResult = await getPastSimulatedDatasetForHouse({
    userId,
    houseId,
    esiid,
    travelRanges: buildExcludedRanges,
    buildInputs,
    startDate,
    endDate,
    timezone,
    buildPathKind: "lab_validation",
    includeSimulatedDayResults: false,
  });

  if (!pastResult.dataset) {
    if (String(pastResult.error ?? "").startsWith("actual_weather_required:")) {
      const canonicalDateKeys = Array.from(
        new Set(
          enumerateDayStartsMsForWindow(startDate, endDate)
            .map((ms) => getDayGridTimestamps(ms)[0] ?? "")
            .map((ts) => dateKeyFromTimestamp(ts))
            .filter((dk) => /^\d{4}-\d{2}-\d{2}$/.test(dk))
        )
      ).sort();
      const wx = await getHouseWeatherDays({
        houseId,
        dateKeys: canonicalDateKeys,
        kind: "ACTUAL_LAST_YEAR",
      });
      const missingDateKeys = canonicalDateKeys.filter((dk) => !wx.has(dk));
      let stubRowCount = 0;
      for (const row of Array.from(wx.values())) {
        if (String((row as any)?.source ?? "").trim() === WEATHER_STUB_SOURCE) stubRowCount += 1;
      }
      const weatherSourceSummary: "stub_only" | "actual_only" | "mixed_actual_and_stub" | "none" =
        wx.size === 0
          ? "none"
          : stubRowCount === 0
            ? "actual_only"
            : stubRowCount === wx.size
              ? "stub_only"
              : "mixed_actual_and_stub";
      return {
        ok: false,
        error: String(pastResult.error ?? "actual_weather_required"),
        message: "Past canonical window weather validation failed (actual weather required).",
        windowStartUtc: startDate,
        windowEndUtc: endDate,
        missingDateKeys,
        stubRowCount,
        weatherSourceSummary,
        windowHelper,
      };
    }
    return {
      ok: false,
      error: "past_dataset_failed",
      message: pastResult.error ?? "Could not build Past stitched dataset.",
    };
  }

  const dataset = pastResult.dataset;
  const intervals15 = dataset.series?.intervals15 ?? [];
  const { bytes } = encodeIntervalsV1(intervals15);
  const datasetJsonForStorage = {
    ...dataset,
    series: { ...(dataset.series ?? {}), intervals15: [] },
  };

  await saveCachedPastDataset({
    houseId,
    scenarioId: "gapfill_lab",
    inputHash,
    engineVersion: PAST_ENGINE_VERSION,
    windowStartUtc: startDate,
    windowEndUtc: endDate,
    datasetJson: datasetJsonForStorage as Record<string, unknown>,
    intervalsCodec: INTERVAL_CODEC_V1,
    intervalsCompressed: bytes,
  });

  return { ok: true, inputHash, houseId };
}
