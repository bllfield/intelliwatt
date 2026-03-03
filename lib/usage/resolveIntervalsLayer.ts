import { getActualUsageDatasetForHouse } from "@/lib/usage/actualDatasetForHouse";
import { IntervalSeriesKind } from "@/modules/usageSimulator/kinds";

export async function resolveIntervalsLayer(args: {
  userId: string;
  houseId: string;
  layerKind: IntervalSeriesKind;
  scenarioId?: string | null;
  esiid?: string | null;
}): Promise<Awaited<ReturnType<typeof getActualUsageDatasetForHouse>> | null> {
  if (
    args.layerKind === IntervalSeriesKind.ACTUAL_USAGE_INTERVALS ||
    args.layerKind === IntervalSeriesKind.BASELINE_INTERVALS
  ) {
    return getActualUsageDatasetForHouse(args.houseId, args.esiid ?? null);
  }

  return null;
}

