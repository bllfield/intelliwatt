import {
  dateKeyFromIntervalPoint,
  dayMeetsTrustedIntervalThreshold,
  homeProjectedIntervalFromRecord,
  type HomeProjectedIntervalPoint,
} from "@/lib/time/actualIntervalCalendar";
import { convertGreenButtonPersistedRowsToHome } from "@/lib/time/greenButtonPersistedIntervalConvert";
import {
  createHomeIntervalCalendar,
  localSlotIndex,
  type HomeIntervalCalendar,
} from "@/lib/time/homeIntervalCalendar";
import { mapGreenButtonUtcTrustedDateKeysToHome } from "@/lib/time/greenButtonUtcTrustedDateKeys";
import { greenButtonShiftedTargetDateKeys } from "@/lib/usage/greenButtonPastYearShiftMerge";
import {
  isOnePathAdminGbPastRunCaller,
  isOnePathAdminSmtPastRunCaller,
} from "@/lib/usage/userSiteSimulationIsolation";

const SIMULATED_INCOMPLETE_METER_DETAIL = "SIMULATED_INCOMPLETE_METER";

function asDateKey(value: unknown): string | null {
  const text = String(value ?? "").slice(0, 10);
  return /^\d{4}-\d{2}-\d{2}$/.test(text) ? text : null;
}

/**
 * Home-local trusted pool for Green Button Past Sim: adapter UTC trusted keys mapped
 * through projected intervals, plus any home day that already meets GB completeness.
 */
export function resolveGreenButtonPastSimTrustedHomeDateKeys(args: {
  trustedUtcDateKeys: readonly string[];
  intervals: ReadonlyArray<Pick<HomeProjectedIntervalPoint, "timestamp" | "homeDateKey" | "homeSlot">>;
  timezone: string;
}): Set<string> {
  const timezone = String(args.timezone ?? "America/Chicago").trim() || "America/Chicago";
  const home = createHomeIntervalCalendar(timezone);
  const trustedHome = mapGreenButtonUtcTrustedDateKeysToHome(args.trustedUtcDateKeys, args.intervals);

  const intervalsByHomeDate = new Map<string, Array<Pick<HomeProjectedIntervalPoint, "timestamp" | "homeDateKey" | "homeSlot">>>();
  for (const row of args.intervals) {
    const dk = asDateKey(dateKeyFromIntervalPoint(row));
    if (!dk) continue;
    const list = intervalsByHomeDate.get(dk) ?? [];
    list.push(row);
    intervalsByHomeDate.set(dk, list);
  }

  for (const [dateKey, dayIntervals] of Array.from(intervalsByHomeDate.entries())) {
    if (
      dayMeetsTrustedIntervalThreshold({
        intervals: dayIntervals,
        dateKey,
        source: "GREEN_BUTTON",
        home,
      })
    ) {
      trustedHome.add(dateKey);
    }
  }

  return trustedHome;
}

export function resolvePastProducerIntervalActualSource(buildInputs: {
  snapshots?: { actualSource?: unknown };
  lockboxRunContext?: { preferredActualSource?: unknown; callerLabel?: unknown };
  actualSource?: unknown;
  preferredActualSource?: unknown;
}): "SMT" | "GREEN_BUTTON" | null {
  const callerLabel =
    typeof buildInputs.lockboxRunContext?.callerLabel === "string"
      ? buildInputs.lockboxRunContext.callerLabel
      : null;
  if (isOnePathAdminGbPastRunCaller(callerLabel)) return "GREEN_BUTTON";
  if (isOnePathAdminSmtPastRunCaller(callerLabel)) return "SMT";
  const topLevelPreferred = buildInputs.preferredActualSource;
  if (topLevelPreferred === "GREEN_BUTTON" || topLevelPreferred === "SMT") return topLevelPreferred;
  // Active recalc lockbox wins over persisted snapshot (One Path GB vs mirrored SMT snapshot).
  const lockboxSource = buildInputs.lockboxRunContext?.preferredActualSource;
  if (lockboxSource === "GREEN_BUTTON" || lockboxSource === "SMT") return lockboxSource;
  const preferredSource = buildInputs.preferredActualSource;
  if (preferredSource === "GREEN_BUTTON" || preferredSource === "SMT") return preferredSource;
  const snapshotSource = buildInputs.snapshots?.actualSource;
  if (snapshotSource === "GREEN_BUTTON" || snapshotSource === "SMT") return snapshotSource;
  const topLevelSource = buildInputs.actualSource;
  if (topLevelSource === "GREEN_BUTTON" || topLevelSource === "SMT") return topLevelSource;
  return null;
}

/** Engine-ready GB intervals with home-local date keys and slots (required for trusted-day detection). */
export function materializeGreenButtonPastProducerIntervals(args: {
  sourceIntervals: PastProducerSourceInterval[];
  timezone: string;
}): Array<{ timestamp: string; kwh: number; homeDateKey: string; homeSlot: number }> {
  const timezone = String(args.timezone ?? "America/Chicago").trim() || "America/Chicago";
  if (!args.sourceIntervals.length) return [];
  const homeCalendar = createHomeIntervalCalendar(timezone);
  const kwhByTs = new Map<string, number>();
  for (const row of args.sourceIntervals) {
    const ts = String(row.timestamp ?? "");
    if (!ts) continue;
    kwhByTs.set(ts, Number(row.kwh ?? row.consumption_kwh) || 0);
  }
  const projected = projectSourceIntervalsForGreenButtonPastTrust({
    sourceIntervals: args.sourceIntervals,
    timezone,
    dateKeyFromTimestamp: (ts) => {
      const parsed = new Date(ts);
      if (!Number.isFinite(parsed.getTime())) return "";
      return dateKeyFromIntervalPoint({ timestamp: ts, homeDateKey: null });
    },
    homeCalendar,
    localSlotIndex,
  });
  const out: Array<{ timestamp: string; kwh: number; homeDateKey: string; homeSlot: number }> = [];
  for (const row of projected) {
    const timestamp = String(row.timestamp ?? "");
    const homeDateKey = String(row.homeDateKey ?? "").slice(0, 10);
    if (!timestamp || !/^\d{4}-\d{2}-\d{2}$/.test(homeDateKey)) continue;
    out.push({
      timestamp,
      kwh: kwhByTs.get(timestamp) ?? 0,
      homeDateKey,
      homeSlot:
        typeof row.homeSlot === "number" && Number.isFinite(row.homeSlot)
          ? Math.trunc(row.homeSlot)
          : localSlotIndex(timestamp, homeCalendar),
    });
  }
  return out;
}

export function resolvePastDatasetMetaActualSource(meta: unknown): "SMT" | "GREEN_BUTTON" | null {
  if (!meta || typeof meta !== "object" || Array.isArray(meta)) return null;
  const source = (meta as Record<string, unknown>).actualSource;
  return source === "GREEN_BUTTON" || source === "SMT" ? source : null;
}

type PastProducerSourceInterval = {
  timestamp: string;
  kwh?: number;
  consumption_kwh?: number;
  homeDateKey?: string;
  homeSlot?: number;
};

export function projectSourceIntervalsForGreenButtonPastTrust(args: {
  sourceIntervals: PastProducerSourceInterval[];
  timezone: string;
  dateKeyFromTimestamp: (ts: string) => string;
  homeCalendar: HomeIntervalCalendar;
  localSlotIndex: (ts: string, home: HomeIntervalCalendar) => number;
}): Array<Pick<HomeProjectedIntervalPoint, "timestamp" | "homeDateKey" | "homeSlot">> {
  const hasProjectedHomeKeys = args.sourceIntervals.some((row) =>
    /^\d{4}-\d{2}-\d{2}$/.test(String(row.homeDateKey ?? "").slice(0, 10))
  );
  if (hasProjectedHomeKeys) {
    return args.sourceIntervals.map((row) => {
      const timestamp = String(row.timestamp ?? "");
      const homeDateKey =
        String(row.homeDateKey ?? "").slice(0, 10) || args.dateKeyFromTimestamp(timestamp);
      const slot = row.homeSlot;
      return {
        timestamp,
        homeDateKey,
        homeSlot:
          typeof slot === "number" && Number.isFinite(slot)
            ? slot
            : args.localSlotIndex(timestamp, args.homeCalendar),
      };
    });
  }
  return convertGreenButtonPersistedRowsToHome(
    args.sourceIntervals.map((row) => ({
      timestamp: new Date(String(row.timestamp ?? "")),
      consumptionKwh: Number(row.kwh ?? row.consumption_kwh) || 0,
    })),
    args.timezone
  ).intervals.map(homeProjectedIntervalFromRecord);
}

/** Trusted home-local keys for Past producer (fetch or preloaded intervals). */
export function resolveGreenButtonPastSimTrustedHomeDateKeysForProducer(args: {
  trustedUtcDateKeys?: readonly string[];
  sourceIntervals: PastProducerSourceInterval[];
  timezone: string;
  dateKeyFromTimestamp: (ts: string) => string;
  homeCalendar: HomeIntervalCalendar;
  localSlotIndex: (ts: string, home: HomeIntervalCalendar) => number;
}): Set<string> {
  if (!args.sourceIntervals.length) return new Set();
  const projected = projectSourceIntervalsForGreenButtonPastTrust(args);
  return resolveGreenButtonPastSimTrustedHomeDateKeys({
    trustedUtcDateKeys: args.trustedUtcDateKeys ?? [],
    intervals: projected,
    timezone: args.timezone,
  });
}

export function resolveGreenButtonTrustedHomeDateKeysFromDecodedIntervals(args: {
  decodedIntervals: Array<{ timestamp: string; kwh?: number; consumption_kwh?: number }>;
  trustedUtcDateKeys?: readonly string[];
  timezone?: string;
}): Set<string> {
  const timezone = String(args.timezone ?? "America/Chicago").trim() || "America/Chicago";
  if (!args.decodedIntervals.length) return new Set();
  const homeCalendar = createHomeIntervalCalendar(timezone);
  return resolveGreenButtonPastSimTrustedHomeDateKeysForProducer({
    trustedUtcDateKeys: args.trustedUtcDateKeys,
    sourceIntervals: args.decodedIntervals,
    timezone,
    dateKeyFromTimestamp: (ts) => {
      const homeKey = dateKeyFromIntervalPoint({ timestamp: ts, homeDateKey: null });
      return /^\d{4}-\d{2}-\d{2}$/.test(homeKey) ? homeKey : "";
    },
    homeCalendar,
    localSlotIndex,
  });
}

/** Align validation pool with Past sim: home-local trusted days plus year-shifted target days. */
export function expandGreenButtonPastTrustedHomeDateKeysWithShiftedTargets(
  trustedHome: ReadonlySet<string>,
  sourceDateByTargetDate?: Record<string, string> | null
): Set<string> {
  const out = new Set(trustedHome);
  for (const dk of Array.from(greenButtonShiftedTargetDateKeys(sourceDateByTargetDate ?? {}))) {
    out.add(dk);
  }
  return out;
}

export function readGreenButtonTrustedHomeDateKeysFromPastMeta(meta: unknown): Set<string> {
  if (!meta || typeof meta !== "object" || Array.isArray(meta)) return new Set();
  const raw = (meta as Record<string, unknown>).greenButtonTrustedHomeDateKeysLocal;
  if (!Array.isArray(raw)) return new Set();
  const out = new Set<string>();
  for (const entry of raw) {
    const dk = String(entry ?? "").slice(0, 10);
    if (/^\d{4}-\d{2}-\d{2}$/.test(dk)) out.add(dk);
  }
  return out;
}

/** Drop stale SIMULATED_INCOMPLETE_METER ownership for GB trusted home days on cache restore. */
export function pruneGreenButtonTrustedDaysFromPastDatasetMeta(
  meta: Record<string, unknown>,
  trustedHomeDateKeys: ReadonlySet<string>
): void {
  if (!trustedHomeDateKeys.size) return;

  const byDetail = meta.simulatedSourceDetailByDate;
  const staleIncompleteMeterTrustedKeys = new Set<string>();
  if (byDetail && typeof byDetail === "object" && !Array.isArray(byDetail)) {
    for (const dk of Array.from(trustedHomeDateKeys)) {
      if (String((byDetail as Record<string, unknown>)[dk] ?? "").trim() !== SIMULATED_INCOMPLETE_METER_DETAIL) {
        continue;
      }
      staleIncompleteMeterTrustedKeys.add(dk);
      delete (byDetail as Record<string, unknown>)[dk];
    }
  }

  const canonicalKey = "canonicalArtifactSimulatedDayTotalsByDate";
  const canonical = meta[canonicalKey];
  if (canonical && typeof canonical === "object" && !Array.isArray(canonical)) {
    for (const dk of Array.from(staleIncompleteMeterTrustedKeys)) {
      delete (canonical as Record<string, unknown>)[dk];
    }
  }
}

/** Travel/vacant and validation test modeled days stay simulated on GB trusted home days. */
export function readGreenButtonRetainSimulatedDateKeysFromPastMeta(meta: unknown): Set<string> {
  const out = new Set<string>();
  if (!meta || typeof meta !== "object" || Array.isArray(meta)) return out;
  const m = meta as Record<string, unknown>;
  for (const key of ["simulatedTravelVacantDateKeysLocal", "simulatedTestModeledDateKeysLocal"] as const) {
    const raw = m[key];
    if (!Array.isArray(raw)) continue;
    for (const entry of raw) {
      const dk = String(entry ?? "").slice(0, 10);
      if (/^\d{4}-\d{2}-\d{2}$/.test(dk)) out.add(dk);
    }
  }
  const byDetail = m.simulatedSourceDetailByDate;
  if (byDetail && typeof byDetail === "object" && !Array.isArray(byDetail)) {
    for (const [rawKey, rawDetail] of Object.entries(byDetail as Record<string, unknown>)) {
      const dk = String(rawKey).slice(0, 10);
      const detail = String(rawDetail ?? "").trim();
      if (!/^\d{4}-\d{2}-\d{2}$/.test(dk)) continue;
      if (detail === "SIMULATED_TRAVEL_VACANT" || detail === "SIMULATED_TEST_DAY") out.add(dk);
    }
  }
  return out;
}

export function filterSimulatedDateKeysWithoutGreenButtonTrustedHome(args: {
  simulatedDateKeys: Set<string>;
  trustedHomeDateKeys: ReadonlySet<string>;
  retainSimulatedDateKeys?: ReadonlySet<string>;
}): Set<string> {
  const retain = args.retainSimulatedDateKeys ?? new Set<string>();
  const out = new Set(args.simulatedDateKeys);
  for (const dk of Array.from(args.trustedHomeDateKeys)) {
    if (retain.has(dk)) continue;
    out.delete(dk);
  }
  return out;
}
