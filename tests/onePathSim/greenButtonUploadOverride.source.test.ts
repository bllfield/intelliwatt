import { readFileSync } from "fs";
import { resolve } from "path";
import { describe, expect, it } from "vitest";

const ROOT = process.cwd();

function readRepoFile(relativePath: string): string {
  return readFileSync(resolve(ROOT, relativePath), "utf8");
}

describe("one path green button upload override wiring", () => {
  it("threads an admin Green Button preference from the upload UI into the One Path run request", () => {
    const adminSource = readRepoFile("components/admin/OnePathSimAdmin.tsx");
    const routeSource = readRepoFile("app/api/admin/tools/one-path-sim/route.ts");

    expect(adminSource).toContain("uploadGreenButtonToContextHouse");
    expect(adminSource).toContain("/api/admin/green-button/upload");
    expect(adminSource).toContain("Prefer uploaded Green Button for INTERVAL usage");
    expect(adminSource).toContain("preferredActualSource: shouldPreferUploadedGreenButton ? \"GREEN_BUTTON\" : null");
    expect(routeSource).toContain("body?.preferredActualSource === \"SMT\" || body?.preferredActualSource === \"GREEN_BUTTON\"");
    expect(routeSource).toContain("preferredActualSource: rawInputBase.preferredActualSource");
  });

  it("carries the preferred source through shared actual-usage resolvers", () => {
    const onePathSource = readRepoFile("modules/onePathSim/onePathSim.ts");
    const upstreamSource = readRepoFile("modules/onePathSim/upstreamUsageTruth.ts");
    const intervalsLayerSource = readRepoFile("lib/usage/resolveIntervalsLayer.ts");
    const actualDatasetSource = readRepoFile("lib/usage/actualDatasetForHouse.ts");
    const actualSource = readRepoFile("modules/realUsageAdapter/actual.ts");

    expect(onePathSource).toContain("preferredActualSource?: \"SMT\" | \"GREEN_BUTTON\" | null;");
    expect(onePathSource).toContain("preferredActualSource: raw.preferredActualSource ?? null");
    expect(upstreamSource).toContain("preferredActualSource?: \"SMT\" | \"GREEN_BUTTON\" | null;");
    expect(upstreamSource).toContain("preferredActualSource: args.preferredActualSource ?? null");
    expect(intervalsLayerSource).toContain("preferredActualSource?: ActualUsageSource | null;");
    expect(intervalsLayerSource).toContain("preferredSource: args.preferredActualSource ?? null");
    expect(actualDatasetSource).toContain("preferredSource?: ActualUsageSource | null;");
    expect(actualDatasetSource).toContain("if (preferredSource === \"GREEN_BUTTON\" && greenButton) return greenButton;");
    expect(actualSource).toContain("args.preferredSource === \"GREEN_BUTTON\" && gbMs > 0");
  });
});
