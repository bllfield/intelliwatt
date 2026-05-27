import { describe, expect, it } from "vitest";
import {
  isolateBuildInputsForUserSite,
  isPersistedAdminLabTestHomeLabel,
  isUserSiteSimulationCaller,
} from "@/lib/usage/userSiteSimulationIsolation";
import { GAPFILL_LAB_TEST_HOME_LABEL } from "@/modules/onePathSim/usageSimulator/labTestHome";

describe("userSiteSimulationIsolation", () => {
  it("detects user-site callers", () => {
    expect(isUserSiteSimulationCaller("user_recalc")).toBe(true);
    expect(isUserSiteSimulationCaller("one_path_admin")).toBe(false);
  });

  it("detects admin lab test home labels", () => {
    expect(isPersistedAdminLabTestHomeLabel(GAPFILL_LAB_TEST_HOME_LABEL)).toBe(true);
    expect(isPersistedAdminLabTestHomeLabel("Brian Home")).toBe(false);
  });

  it("resets cross-house actualContext and GREEN_BUTTON snapshot on user site", () => {
    const { buildInputs, changed, reasons } = isolateBuildInputsForUserSite({
      buildInputs: {
        actualContextHouseId: "source-house-admin",
        snapshots: { actualSource: "GREEN_BUTTON" },
        lockboxRunContext: { preferredActualSource: "GREEN_BUTTON" },
      },
      requestHouseId: "user-house-1",
      actualSource: "SMT",
    });
    expect(changed).toBe(true);
    expect(reasons).toContain("actualContextHouseId_reset");
    expect(reasons).toContain("snapshots_actualSource_reset");
    expect(buildInputs.actualContextHouseId).toBe("user-house-1");
    expect((buildInputs.snapshots as { actualSource: string }).actualSource).toBe("SMT");
    expect((buildInputs.lockboxRunContext as { preferredActualSource: string }).preferredActualSource).toBe("SMT");
  });
});
