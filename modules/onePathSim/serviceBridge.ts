import {
  getSimulatedUsageForHouseScenario,
  recalcSimulatorBuild,
  type RecalcSimulatorBuildArgs,
} from "@/modules/onePathSim/usageSimulator/service";

export type { ValidationCompareProjectionSidecar } from "@/modules/onePathSim/usageSimulator/compareProjection";
export type { SharedDiagnosticsCallerType } from "@/modules/onePathSim/usageSimulator/sharedDiagnostics";
export type { RecalcSimulatorBuildArgs };

export async function runOnePathSimulatorBuild(args: RecalcSimulatorBuildArgs) {
  return recalcSimulatorBuild(args);
}

export async function readOnePathSimulatedUsageScenario(args: Parameters<typeof getSimulatedUsageForHouseScenario>[0]) {
  return getSimulatedUsageForHouseScenario(args);
}
