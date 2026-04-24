import { readFileSync } from "fs";
import { resolve } from "path";
import { describe, expect, it } from "vitest";

const ROOT = process.cwd();

function readRepoFile(relativePath: string): string {
  return readFileSync(resolve(ROOT, relativePath), "utf8");
}

describe("one path green button preset wiring", () => {
  it("routes admin Green Button replacements through the usage upload ticket flow", () => {
    const adminSource = readRepoFile("components/admin/OnePathSimAdmin.tsx");
    const lookupRouteSource = readRepoFile("app/api/admin/tools/one-path-sim/route.ts");
    const onePathSource = readRepoFile("modules/onePathSim/onePathSim.ts");

    expect(adminSource).toContain("uploadGreenButtonThroughUsage");
    expect(adminSource).toContain("/api/green-button/upload-ticket");
    expect(adminSource).toContain("selectedKnownScenario.scenarioType === \"GREEN_BUTTON_TRUTH\"");
    expect(adminSource).toContain("greenButtonSelectedFile");
    expect(adminSource).toContain("The selected file will be uploaded through the usage Green Button pipeline when you load this preset.");
            expect(adminSource).toContain("upload.hasPersistedUsageIntervals === true");
            expect(adminSource).toContain("A Green Button upload record exists for this actual context house, but persisted usage-backed intervals are");
    expect(adminSource).not.toContain("/api/admin/green-button/upload");
    expect(adminSource).not.toContain("Prefer uploaded Green Button for INTERVAL usage");
    expect(adminSource).toContain("preferredActualSource: mode === \"GREEN_BUTTON\" ? \"GREEN_BUTTON\" : null");
    expect(adminSource).toContain("<option value=\"GREEN_BUTTON\">GREEN_BUTTON</option>");
    expect(lookupRouteSource).toContain("greenButtonUpload: actualContextGreenButtonUpload");
    expect(lookupRouteSource).toContain("mode === \"GREEN_BUTTON\"");
    expect(lookupRouteSource).toContain("await adaptGreenButtonRawInput(effectiveRawInputBase)");
    expect(lookupRouteSource).toContain("const greenButtonUpload = await loadGreenButtonUploadSummary(previewActualContextHouseId);");
            expect(lookupRouteSource).toContain("hasPersistedUsageIntervals: Boolean(derivedCoverage)");
            expect(lookupRouteSource).toContain("intervalCount: derivedCoverage?.count ?? 0");
    expect(onePathSource).toContain("export async function adaptGreenButtonRawInput");
    expect(onePathSource).toContain("inputType: \"GREEN_BUTTON\"");
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
