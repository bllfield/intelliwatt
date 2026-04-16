import { existsSync, readFileSync } from "fs";
import { resolve } from "path";
import { describe, expect, it } from "vitest";

const ROOT = process.cwd();

function readRepoFile(relativePath: string): string {
  return readFileSync(resolve(ROOT, relativePath), "utf8");
}

describe("one path sealed sandbox boundaries", () => {
  it("keeps runtime.ts free of live behavior-owner and live orchestration imports", () => {
    const runtimeSource = readRepoFile("modules/onePathSim/runtime.ts");
    const serviceBridgeSource = readRepoFile("modules/onePathSim/serviceBridge.ts");

    expect(runtimeSource).not.toContain('from "@/modules/manualUsage/store"');
    expect(runtimeSource).not.toContain('from "@/modules/manualUsage/pastSimReadResult"');
    expect(runtimeSource).not.toContain('from "@/modules/manualUsage/statementRanges"');
    expect(runtimeSource).not.toContain('from "@/modules/weatherSensitivity/shared"');
    expect(runtimeSource).not.toContain('from "@/modules/usageSimulator/service"');
    expect(runtimeSource).not.toContain('from "@/modules/usageSimulator/simulationVariablePolicy"');
    expect(runtimeSource).not.toContain('from "@/modules/usageSimulator/upstreamUsageTruth"');
    expect(runtimeSource).not.toContain('from "@/app/api/admin/tools/gapfill-lab/gapfillLabRouteHelpers"');
    expect(runtimeSource).not.toContain('from "@/modules/onePathSim/serviceBridge"');
    expect(serviceBridgeSource).not.toContain('from "@/modules/usageSimulator/service"');
  });

  it("keeps isolated one-path modules free of live behavior owners and stale deleted imports", () => {
    const onePathCore = readRepoFile("modules/onePathSim/onePathSim.ts");
    const truthSummary = readRepoFile("modules/onePathSim/onePathTruthSummary.ts");
    const ownershipAudit = readRepoFile("modules/onePathSim/onePathOwnershipAudit.ts");
    const presentation = readRepoFile("modules/onePathSim/simulationVariablePresentation.ts");
    const runtimeSource = readRepoFile("modules/onePathSim/runtime.ts");
    const serviceBridgeSource = readRepoFile("modules/onePathSim/serviceBridge.ts");

    for (const source of [onePathCore, truthSummary, ownershipAudit, presentation, serviceBridgeSource]) {
      expect(source).not.toContain('from "@/modules/usageSimulator/onePathSim"');
      expect(source).not.toContain('from "@/modules/usageSimulator/onePathTruthSummary"');
      expect(source).not.toContain('from "@/modules/usageSimulator/onePathOwnershipAudit"');
      expect(source).not.toContain('from "@/modules/usageSimulator/simulationVariablePresentation"');
      expect(source).not.toContain('from "@/components/usage/');
      expect(source).not.toContain("UsageDashboard");
      expect(source).not.toContain('from "@/app/api/admin/tools/gapfill-lab/');
    }

    expect(existsSync(resolve(ROOT, "modules/onePathSim/manualPastSimReadBridge.ts"))).toBe(false);
    expect(runtimeSource).not.toContain("manualPastSimReadBridge");
    expect(onePathCore).not.toContain("getOnePathSimulatedUsageForHouseScenario");
    expect(onePathCore).not.toContain("recalcOnePathSimulatorBuild");
  });

  it("keeps the one path route on isolated module ownership", () => {
    const routeSource = readRepoFile("app/api/admin/tools/one-path-sim/route.ts");

    expect(routeSource).toContain('from "@/modules/onePathSim/onePathSim"');
    expect(routeSource).toContain('from "@/modules/onePathSim/runtime"');
    expect(routeSource).not.toContain('from "@/modules/manualUsage/');
    expect(routeSource).not.toContain('from "@/modules/weatherSensitivity/shared"');
    expect(routeSource).not.toContain('from "@/modules/usageSimulator/service"');
    expect(routeSource).not.toContain('from "@/modules/usageSimulator/upstreamUsageTruth"');
    expect(routeSource).not.toContain('from "@/app/api/admin/tools/gapfill-lab/');
  });
});
