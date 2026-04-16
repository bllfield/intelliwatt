import { getActualIntervalsForRange } from "@/lib/usage/actualDatasetForHouse";
import { getMemoryRssMb, logSimPipelineEvent } from "@/modules/onePathSim/usageSimulator/simObservability";

export type RecalcIntervalPoint = { timestamp: string; kwh: number };

type IntervalWindowLoad = {
  intervals: RecalcIntervalPoint[];
  cacheHit: boolean;
};

export function createRecalcIntervalPreloadContext(args: {
  houseId: string;
  esiid: string | null;
  correlationId?: string;
  source?: string;
}) {
  const source = args.source ?? "createRecalcIntervalPreloadContext";
  const cache = new Map<string, Promise<RecalcIntervalPoint[]>>();
  let fetchCount = 0;
  let reuseCount = 0;

  logSimPipelineEvent("recalc_interval_preload_setup", {
    correlationId: args.correlationId,
    houseId: args.houseId,
    source,
    memoryRssMb: getMemoryRssMb(),
  });

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
    const loadPromise = getActualIntervalsForRange({
      houseId: args.houseId,
      esiid: args.esiid,
      startDate: windowArgs.startDate,
      endDate: windowArgs.endDate,
    }).then((rows) =>
      (rows ?? []).map((row) => ({
        timestamp: String(row?.timestamp ?? ""),
        kwh: Number(row?.kwh) || 0,
      }))
    );
    cache.set(key, loadPromise);
    fetchCount += 1;
    const intervals = await loadPromise;
    logSimPipelineEvent("recalc_interval_preload_fetch", {
      correlationId: args.correlationId,
      houseId: args.houseId,
      startDate: windowArgs.startDate,
      endDate: windowArgs.endDate,
      intervalRowCount: intervals.length,
      durationMs: Date.now() - startedAt,
      source,
      memoryRssMb: getMemoryRssMb(),
    });
    return { intervals, cacheHit: false };
  };

  const getStats = () => ({ fetchCount, reuseCount, cachedWindowCount: cache.size });

  return { getIntervals, getStats };
}


