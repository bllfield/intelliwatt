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
    expect(actualDatasetSource).toContain("const greenButtonStartDate = prevCalendarDayDateKey(greenButtonAnchorEndDate, 364);");
    expect(actualDatasetSource).toContain("buildUtcRangeForChicagoLocalDateRange");
    expect(actualDatasetSource).toContain("const selectedWindowStartDate = normalizeDateKey(selected?.summary?.start ?? null);");
    expect(actualDatasetSource).toContain("const rangeStart = selectedWindowStartDate ?? canonicalWindow.startDate;");
  });
});
