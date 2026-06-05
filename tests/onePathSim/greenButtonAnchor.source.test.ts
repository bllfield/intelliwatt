import { readFileSync } from "fs";
import { resolve } from "path";
import { describe, expect, it } from "vitest";

const ROOT = process.cwd();

function readRepoFile(relativePath: string): string {
  return readFileSync(resolve(ROOT, relativePath), "utf8");
}

describe("one path green button anchor wiring", () => {
  it("anchors Green Button interval mode on the latest complete upload day", () => {
    const actualSource = readRepoFile("modules/realUsageAdapter/actual.ts");
    const greenButtonSource = readRepoFile("modules/realUsageAdapter/greenButton.ts");

    expect(actualSource).toContain("getLatestGreenButtonFullDayDateKey");
    expect(actualSource).toContain("const greenButtonAnchorEndDate = gbAnchorDateKey;");
    expect(greenButtonSource).toContain("export async function getLatestGreenButtonFullDayDateKey");
    expect(greenButtonSource).toContain("expectedIntervalsForDateISO");
    expect(greenButtonSource).toContain("intervalscount");
  });

  it("lets one path use the Green Button anchor-backed interval window when uploads are older than canonical coverage", () => {
    const serviceSource = readRepoFile("modules/onePathSim/usageSimulator/service.ts");
    const onePathSource = readRepoFile("modules/onePathSim/onePathSim.ts");
    const actualDatasetSource = readRepoFile("lib/usage/actualDatasetForHouse.ts");

    expect(serviceSource).toContain("intervalActualSource?: \"SMT\" | \"GREEN_BUTTON\" | null;");
    expect(serviceSource).toContain("args.intervalActualSource === \"GREEN_BUTTON\"");
    expect(serviceSource).toContain("intervalAnchorEndDate: actualSourceAnchor.anchorEndDate");
    expect(serviceSource).toContain("source: \"smt_anchor\"");
    expect(onePathSource).toContain("usesGreenButtonAnchorWindow");
    expect(onePathSource).toContain("actualMeta.actualSource === \"GREEN_BUTTON\"");
    expect(actualDatasetSource).toContain("getLatestGreenButtonFullDayDateKey");
    expect(actualDatasetSource).toContain("resolveGreenButtonBaselineCoverageWindow");
    expect(actualDatasetSource).toContain("buildUtcRangeForChicagoLocalDateRange");
    expect(actualDatasetSource).toContain("const selectedWindowStartDate = displayCoverageWindow.startDate;");
    expect(actualDatasetSource).toContain("const rangeStart = selectedWindowStartDate ?? canonicalWindow.startDate;");
  });

  it("keeps Green Button raw selection on latest uploaded usable raw before timestamp fallback", () => {
    const greenButtonSource = readRepoFile("modules/realUsageAdapter/greenButton.ts");
    const uploadIdentityIndex = greenButtonSource.indexOf("latestUsableRawByUploadIdentity");
    const timestampFallbackIndex = greenButtonSource.indexOf("latestUsableRawFromIntervals");

    expect(uploadIdentityIndex).toBeGreaterThanOrEqual(0);
    expect(timestampFallbackIndex).toBeGreaterThanOrEqual(0);
    expect(uploadIdentityIndex).toBeLessThan(timestampFallbackIndex);
    expect(greenButtonSource).toContain('ORDER BY r."createdAt" DESC');
  });

  it("threads Green Button actual-source identity into shared Past Sim build inputs", () => {
    const userServiceSource = readRepoFile("modules/usageSimulator/service.ts");
    const onePathServiceSource = readRepoFile("modules/onePathSim/usageSimulator/service.ts");
    const sharedPastSource = readRepoFile("modules/simulatedUsage/simulatePastUsageDataset.ts");
    const onePathPastSource = readRepoFile("modules/onePathSim/simulatedUsage/simulatePastUsageDataset.ts");

    expect(userServiceSource).toContain("actualSource: built.source?.actualSource ?? actualSource ?? null");
    expect(onePathServiceSource).toContain("actualSource: built.source?.actualSource ?? actualSource ?? null");
    expect(sharedPastSource).toContain('intervalActualSource === "GREEN_BUTTON"');
    expect(sharedPastSource).toContain("loadGreenButtonPastProducerIntervals");
    expect(onePathPastSource).toContain('intervalActualSource === "GREEN_BUTTON"');
    expect(onePathPastSource).toContain("loadGreenButtonPastProducerIntervals");
  });
});
