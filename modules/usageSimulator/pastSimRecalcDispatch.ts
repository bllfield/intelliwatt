import { recalcSimulatorBuild } from "@/modules/usageSimulator/service";
import type { SimulatorMode } from "@/modules/usageSimulator/requirements";
import type { WeatherPreference } from "@/modules/weatherNormalization/normalizer";
import {
  enqueuePastSimRecalcDropletJob,
  PAST_SIM_RECALC_PAYLOAD_V,
  type PastSimRecalcQueuedPayloadV1,
} from "@/modules/usageSimulator/simDropletJob";
import { shouldEnqueuePastSimRecalcRemote } from "@/modules/usageSimulator/dropletSimWebhook";

export type PastSimRecalcDispatchResult =
  | {
      executionMode: "droplet_async";
      jobId: string;
    }
  | {
      executionMode: "inline";
      result: Awaited<ReturnType<typeof recalcSimulatorBuild>>;
    };

/**
 * Canonical Past sim recalc entry: same `recalcSimulatorBuild` as always; optionally enqueues for droplet.
 */
export async function dispatchPastSimRecalc(args: {
  userId: string;
  houseId: string;
  esiid: string | null;
  mode: SimulatorMode;
  scenarioId?: string | null;
  weatherPreference?: WeatherPreference;
  persistPastSimBaseline?: boolean;
}): Promise<PastSimRecalcDispatchResult> {
  const payload: PastSimRecalcQueuedPayloadV1 = {
    v: PAST_SIM_RECALC_PAYLOAD_V,
    userId: args.userId,
    houseId: args.houseId,
    esiid: args.esiid,
    mode: args.mode,
    scenarioId: args.scenarioId ?? null,
    weatherPreference: args.weatherPreference,
    persistPastSimBaseline: args.persistPastSimBaseline === true,
  };
  if (shouldEnqueuePastSimRecalcRemote()) {
    const enq = await enqueuePastSimRecalcDropletJob(payload);
    if (enq.ok) {
      return { executionMode: "droplet_async", jobId: enq.jobId };
    }
  }
  const result = await recalcSimulatorBuild({
    userId: args.userId,
    houseId: args.houseId,
    esiid: args.esiid,
    mode: args.mode,
    scenarioId: args.scenarioId ?? null,
    weatherPreference: args.weatherPreference,
    persistPastSimBaseline: args.persistPastSimBaseline,
  });
  return { executionMode: "inline", result };
}
