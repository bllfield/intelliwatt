import "server-only";
import { getActualIntervalsForRangeWithSource } from "@/lib/usage/actualDatasetForHouse";

export type UsageShapeActualIntervalsResult = {
  source: "SMT" | "GREEN_BUTTON" | "NONE";
  intervals: Array<{ timestamp: string; kwh: number }>;
  diagnostics?: {
    startDate: string;
    endDate: string;
    selectedSource: "SMT" | "GREEN_BUTTON" | "NONE";
    intervalCount: number;
  };
};

export async function getActualIntervalsForUsageShapeProfile(args: {
  houseId: string;
  esiid: string | null;
  startDate: string;
  endDate: string;
}): Promise<UsageShapeActualIntervalsResult> {
  const start = new Date(`${args.startDate}T00:00:00.000Z`);
  const end = new Date(`${args.endDate}T23:59:59.999Z`);
  if (!Number.isFinite(start.getTime()) || !Number.isFinite(end.getTime()) || start.getTime() > end.getTime()) {
    return {
      source: "NONE",
      intervals: [],
      diagnostics: {
        startDate: args.startDate,
        endDate: args.endDate,
        selectedSource: "NONE",
        intervalCount: 0,
      },
    };
  }

  const resolved = await getActualIntervalsForRangeWithSource({
    houseId: args.houseId,
    esiid: args.esiid ?? null,
    startDate: args.startDate,
    endDate: args.endDate,
  }).catch(() => ({ source: null, intervals: [] as Array<{ timestamp: string; kwh: number }> }));
  const source: "SMT" | "GREEN_BUTTON" | "NONE" = resolved.source ?? "NONE";
  return {
    source,
    intervals: resolved.intervals.map((r) => ({ timestamp: String(r.timestamp ?? ""), kwh: Number(r.kwh) || 0 })),
    diagnostics: {
      startDate: args.startDate,
      endDate: args.endDate,
      selectedSource: source,
      intervalCount: resolved.intervals.length,
    },
  };
}