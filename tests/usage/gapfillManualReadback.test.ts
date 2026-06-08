import { describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

vi.mock("server-only", () => ({}));

const buildOnePathManualUsagePastSimReadResult = vi.fn();
const buildManualUsagePastSimReadResult = vi.fn();

vi.mock("@/modules/onePathSim/manualPastSimReadResult", () => ({
  buildOnePathManualUsagePastSimReadResult: (...args: unknown[]) =>
    buildOnePathManualUsagePastSimReadResult(...args),
}));

vi.mock("@/modules/manualUsage/pastSimReadResult", () => ({
  buildManualUsagePastSimReadResult: (...args: unknown[]) => buildManualUsagePastSimReadResult(...args),
}));

describe("GapFill manual readback path (Phase 2A)", () => {
  it("routes GapFill manual readback through buildOnePathManualUsagePastSimReadResult in gapfill-lab route", () => {
    const routeSource = readFileSync(
      resolve(process.cwd(), "app/api/admin/tools/gapfill-lab/route.ts"),
      "utf8"
    );
    expect(routeSource).toContain(
      'import { buildOnePathManualUsagePastSimReadResult } from "@/modules/onePathSim/manualPastSimReadResult"'
    );
    expect(routeSource).not.toContain(
      'import { buildManualUsagePastSimReadResult } from "@/modules/manualUsage/pastSimReadResult"'
    );
    expect(routeSource).toContain("await buildOnePathManualUsagePastSimReadResult({");
    expect(routeSource).toContain('readLayer: "buildOnePathManualUsagePastSimReadResult"');
    expect(routeSource).toContain("isGapfillManualUsageInputMode(args.testUsageInputMode)");
    expect(routeSource).toContain('usageInputMode === "EXACT_INTERVALS"');
    expect(routeSource).toContain("getSimulatedUsageForHouseScenario");
  });

  it("keeps legacy buildManualUsagePastSimReadResult out of GapFill route imports", () => {
    const routeSource = readFileSync(
      resolve(process.cwd(), "app/api/admin/tools/gapfill-lab/route.ts"),
      "utf8"
    );
    expect(routeSource.includes("buildManualUsagePastSimReadResult")).toBe(false);
  });
});
