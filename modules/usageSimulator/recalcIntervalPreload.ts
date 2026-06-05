import { getActualIntervalsForRange } from "@/lib/usage/actualDatasetForHouse";
import {
  loadGreenButtonPastProducerIntervals,
  type GreenButtonPastProducerLoadResult,
} from "@/lib/usage/greenButtonPastProducerLoad";
import type { ActualUsageSource } from "@/modules/realUsageAdapter/actual";
import { getMemoryRssMb, logSimPipelineEvent } from "@/modules/usageSimulator/simObservability";

export type RecalcIntervalPoint = { timestamp: string; kwh: number };

type IntervalWindowLoad = {
  intervals: RecalcIntervalPoint[];
  cacheHit: boolean;
};

type GreenButtonProducerWindowLoad = {
  load: GreenButtonPastProducerLoadResult;
  cacheHit: boolean;
};

export function createRecalcIntervalPreloadContext(args: {
  houseId: string;
  esiid: string | null;
  preferredSource?: ActualUsageSource | null;
  correlationId?: string;
  source?: string;
  timezone?: string;
  travelRanges?: Array<{ startDate: string; endDate: string }>;
}) {
  const source = args.source ?? "createRecalcIntervalPreloadContext";
  const cache = new Map<string, Promise<RecalcIntervalPoint[]>>();
  const greenButtonProducerCache = new Map<string, Promise<GreenButtonPastProducerLoadResult>>();
  let fetchCount = 0;
  let reuseCount = 0;
  let greenButtonProducerFetchCount = 0;
  let greenButtonProducerReuseCount = 0;

  logSimPipelineEvent("recalc_interval_preload_setup", {
    correlationId: args.correlationId,
    houseId: args.houseId,
    preferredSource: args.preferredSource ?? null,
    source,
    memoryRssMb: getMemoryRssMb(),
  });

  const getGreenButtonPastProducerLoad = async (windowArgs: {
    startDate: string;
    endDate: string;
  }): Promise<GreenButtonProducerWindowLoad> => {
    const key = `${windowArgs.startDate}|${windowArgs.endDate}`;
    const existing = greenButtonProducerCache.get(key);
    if (existing) {
      greenButtonProducerReuseCount += 1;
      const load = await existing;
      logSimPipelineEvent("recalc_green_button_producer_preload_reuse", {
        correlationId: args.correlationId,
        houseId: args.houseId,
        startDate: windowArgs.startDate,
        endDate: windowArgs.endDate,
        intervalRowCount: load.engineSourceIntervals.length,
        source,
        memoryRssMb: getMemoryRssMb(),
      });
      return { load, cacheHit: true };
    }

    const startedAt = Date.now();
    const timezone = String(args.timezone ?? "America/Chicago").trim() || "America/Chicago";
    const loadPromise = loadGreenButtonPastProducerIntervals({
      houseId: args.houseId,
      esiid: args.esiid,
      coverageStartDate: windowArgs.startDate,
      coverageEndDate: windowArgs.endDate,
      timezone,
      travelRanges: args.travelRanges,
    });
    greenButtonProducerCache.set(key, loadPromise);
    greenButtonProducerFetchCount += 1;
    const load = await loadPromise;
    logSimPipelineEvent("recalc_green_button_producer_preload_fetch", {
      correlationId: args.correlationId,
      houseId: args.houseId,
      startDate: windowArgs.startDate,
      endDate: windowArgs.endDate,
      intervalRowCount: load.engineSourceIntervals.length,
      durationMs: Date.now() - startedAt,
      source,
      memoryRssMb: getMemoryRssMb(),
    });
    return { load, cacheHit: false };
  };

  const getIntervals = async (windowArgs: {
    startDate: string;
    endDate: string;
  }): Promise<IntervalWindowLoad> => {
    const key = `${windowArgs.startDate}|${windowArgs.endDate}`;
    const existing = cache.get(key);
    if (existing) {
      reuseCount += 1;
      const intervals = await existing;
      logSimPipelineEvent("recalc_interval_preload_reuse", {
        correlationId: args.correlationId,
        houseId: args.houseId,
        startDate: windowArgs.startDate,
        endDate: windowArgs.endDate,
        intervalRowCount: intervals.length,
        source,
        memoryRssMb: getMemoryRssMb(),
      });
      return { intervals, cacheHit: true };
    }

    const startedAt = Date.now();
    const greenButtonProducerCached =
      args.preferredSource === "GREEN_BUTTON" && greenButtonProducerCache.has(key);
    const loadPromise =
      args.preferredSource === "GREEN_BUTTON"
        ? getGreenButtonPastProducerLoad(windowArgs).then((out) =>
            out.load.engineSourceIntervals.map((row) => ({
              timestamp: row.timestamp,
              kwh: row.kwh,
            }))
          )
        : getActualIntervalsForRange({
            houseId: args.houseId,
            esiid: args.esiid,
            startDate: windowArgs.startDate,
            endDate: windowArgs.endDate,
            preferredSource: args.preferredSource ?? null,
          }).then((rows) =>
            (rows ?? []).map((row) => ({
              timestamp: String(row?.timestamp ?? ""),
              kwh: Number(row?.kwh) || 0,
            }))
          );
    cache.set(key, loadPromise);
    if (greenButtonProducerCached) {
      reuseCount += 1;
    } else {
      fetchCount += 1;
    }
    const intervals = await loadPromise;
    logSimPipelineEvent(
      greenButtonProducerCached ? "recalc_interval_preload_reuse" : "recalc_interval_preload_fetch",
      {
        correlationId: args.correlationId,
        houseId: args.houseId,
        startDate: windowArgs.startDate,
        endDate: windowArgs.endDate,
        intervalRowCount: intervals.length,
        durationMs: Date.now() - startedAt,
        preferredSource: args.preferredSource ?? null,
        greenButtonProducerCached,
        source,
        memoryRssMb: getMemoryRssMb(),
      }
    );
    return { intervals, cacheHit: greenButtonProducerCached };
  };

  const getStats = () => ({
    fetchCount,
    reuseCount,
    cachedWindowCount: cache.size,
    greenButtonProducerFetchCount,
    greenButtonProducerReuseCount,
    greenButtonProducerCachedWindowCount: greenButtonProducerCache.size,
  });

  return { getIntervals, getGreenButtonPastProducerLoad, getStats };
}
