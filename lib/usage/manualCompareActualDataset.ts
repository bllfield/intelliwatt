import { resolveIntervalsLayer } from "@/lib/usage/resolveIntervalsLayer";
import { IntervalSeriesKind } from "@/modules/usageSimulator/kinds";

/** Load interval-backed actual usage for Past validation compare (Usage dashboard parity). */
export async function resolveManualCompareActualDataset(args: {
  actualDataset?: any;
  actualReference?:
    | {
        userId: string;
        houseId: string;
        scenarioId: string | null;
        esiid?: string | null;
      }
    | null;
}): Promise<any | null> {
  if (args.actualDataset !== undefined) return args.actualDataset ?? null;
  const ref = args.actualReference;
  if (!ref?.userId || !ref?.houseId) return null;
  try {
    const resolved = await resolveIntervalsLayer({
      userId: ref.userId,
      houseId: ref.houseId,
      layerKind: IntervalSeriesKind.ACTUAL_USAGE_INTERVALS,
      scenarioId: ref.scenarioId ?? null,
      esiid: ref.esiid ?? null,
    });
    return resolved?.dataset ?? null;
  } catch {
    return null;
  }
}
