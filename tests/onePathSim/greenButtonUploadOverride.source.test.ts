import { readFileSync } from "fs";
import { resolve } from "path";
import { describe, expect, it } from "vitest";

const ROOT = process.cwd();

function readRepoFile(relativePath: string): string {
  return readFileSync(resolve(ROOT, relativePath), "utf8");
}

function sourceBetween(source: string, start: string, end: string | null): string {
  const startIndex = source.indexOf(start);
  const endIndex = end == null ? source.length : source.indexOf(end, startIndex + start.length);
  expect(startIndex).toBeGreaterThanOrEqual(0);
  expect(endIndex).toBeGreaterThan(startIndex);
  return source.slice(startIndex, endIndex);
}

describe("one path green button preset wiring", () => {
  it("routes admin Green Button replacements through the usage upload ticket flow", () => {
    const adminSource = readRepoFile("components/admin/OnePathSimAdmin.tsx");
    const lookupRouteSource = readRepoFile("app/api/admin/tools/one-path-sim/route.ts");
    const onePathSource = readRepoFile("modules/onePathSim/onePathSim.ts");
    const uploadTicketSource = readRepoFile("app/api/admin/tools/one-path-sim/green-button/upload-ticket/route.ts");
    const writeTargetSource = readRepoFile("app/api/admin/tools/one-path-sim/_helpers.ts");
    const labTestHomeSource = readRepoFile("modules/usageSimulator/labTestHome.ts");

    expect(adminSource).toContain("uploadGreenButtonThroughUsage");
    expect(adminSource).toContain("/api/admin/tools/one-path-sim/green-button/upload-ticket");
    expect(adminSource).toContain("selectedKnownScenario.scenarioType === \"GREEN_BUTTON_TRUTH\"");
    expect(adminSource).toContain("greenButtonSelectedFile");
    expect(adminSource).toContain("The selected file will be uploaded through the usage Green Button pipeline when you load this preset.");
            expect(adminSource).toContain("upload.hasPersistedUsageIntervals === true");
            expect(adminSource).toContain("A Green Button upload record exists for this actual context house, but persisted usage-backed intervals are");
    expect(adminSource).not.toContain("/api/admin/green-button/upload");
    expect(adminSource).not.toContain("Prefer uploaded Green Button for INTERVAL usage");
    expect(adminSource).toContain("preferredActualSource: mode === \"INTERVAL\" ? \"SMT\" : mode === \"GREEN_BUTTON\" ? \"GREEN_BUTTON\" : null");
    expect(adminSource).toContain("<option value=\"GREEN_BUTTON\">GREEN_BUTTON</option>");
    expect(lookupRouteSource).toContain("greenButtonUpload: actualContextGreenButtonUpload");
    expect(lookupRouteSource).toContain("mode === \"GREEN_BUTTON\"");
    expect(lookupRouteSource).toContain("promise: adaptGreenButtonRawInput(effectiveRawInputBase)");
    expect(lookupRouteSource).toContain("const greenButtonUpload = await loadGreenButtonUploadSummary(previewActualContextHouseId);");
            expect(lookupRouteSource).toContain("hasPersistedUsageIntervals: Boolean(derivedCoverage)");
            expect(lookupRouteSource).toContain("intervalCount: derivedCoverage?.count ?? 0");
    expect(onePathSource).toContain("export async function adaptGreenButtonRawInput");
    expect(onePathSource).toContain("inputType: \"GREEN_BUTTON\"");
    expect(sourceBetween(onePathSource, "export async function adaptGreenButtonRawInput", "export async function adaptManualMonthlyRawInput")).toContain(
      "skipOptionalEnrichment: isBaselineGreenButtonRun"
    );
    expect(uploadTicketSource).toContain("id: target.testHomeHouseId");
    expect(uploadTicketSource).toContain("userId: house.userId");
    expect(uploadTicketSource).toContain("houseId: house.id");
    expect(writeTargetSource).toContain("One Path admin writes are pinned to the linked test home only.");
    expect(labTestHomeSource).toContain("rawId: clonedRaw.id");
  });

  it("carries the preferred source through shared actual-usage resolvers", () => {
    const onePathSource = readRepoFile("modules/onePathSim/onePathSim.ts");
    const upstreamSource = readRepoFile("modules/onePathSim/upstreamUsageTruth.ts");
    const intervalsLayerSource = readRepoFile("lib/usage/resolveIntervalsLayer.ts");
    const actualDatasetSource = readRepoFile("lib/usage/actualDatasetForHouse.ts");
    const actualSource = readRepoFile("modules/realUsageAdapter/actual.ts");
    const onePathBuildSource = readRepoFile("modules/onePathSim/usageSimulator/build.ts");
    const onePathServiceSource = readRepoFile("modules/onePathSim/usageSimulator/service.ts");
    const usageServiceSource = readRepoFile("modules/usageSimulator/service.ts");

    expect(onePathSource).toContain("preferredActualSource?: \"SMT\" | \"GREEN_BUTTON\" | null;");
    expect(onePathSource).toContain("preferredActualSource: raw.preferredActualSource ?? null");
    expect(upstreamSource).toContain("preferredActualSource?: \"SMT\" | \"GREEN_BUTTON\" | null;");
    expect(upstreamSource).toContain("preferredActualSource: args.preferredActualSource ?? null");
    expect(intervalsLayerSource).toContain("preferredActualSource?: ActualUsageSource | null;");
    expect(intervalsLayerSource).toContain("preferredSource: args.preferredActualSource ?? null");
    expect(actualDatasetSource).toContain("preferredSource?: ActualUsageSource | null;");
    expect(actualDatasetSource).toContain("if (preferredSource === \"GREEN_BUTTON\" && greenButton) return greenButton;");
    expect(actualSource).toContain("args.preferredSource === \"GREEN_BUTTON\" && gbMs > 0");
    expect(actualSource).toContain("preferredSource?: ActualUsageSource | null;");
    expect(onePathBuildSource).toContain("preferredActualSource?: ActualUsageSource | null;");
    expect(onePathBuildSource).toContain("preferredSource: args.preferredActualSource ?? null");
    expect(onePathServiceSource).toContain("preferredSource: preferredActualSource ?? null");
    expect(onePathServiceSource).toContain("preferredActualSource: preferredActualSource ?? null");
    expect(usageServiceSource).toContain("preferredSource: preferredActualSource ?? null");
  });

  it("keeps One Path test-home usage cleanup sequential for single-connection usage DB pools", () => {
    const labTestHomeSource = readRepoFile("modules/usageSimulator/labTestHome.ts");
    const actualUsageCleanup = sourceBetween(
      labTestHomeSource,
      "async function clearOnePathActualUsageState",
      "async function cloneOnePathGreenButtonUsageFromSource"
    );
    const onePathReplacement = sourceBetween(
      labTestHomeSource,
      "export async function replaceGlobalOnePathLabTestHomeFromSource",
      null
    );

    expect(actualUsageCleanup).not.toContain("Promise.all");
    expect(onePathReplacement).toContain("single connection");
    expect(onePathReplacement).not.toContain("await Promise.all([\n      (usagePrisma as any).pastSimulatedDatasetCache");
    expect(onePathReplacement).toContain("(usagePrisma as any).pastSimulatedDatasetCache");
    expect(onePathReplacement).toContain("(usagePrisma as any).gapfillCompareRunSnapshot");
  });
});
