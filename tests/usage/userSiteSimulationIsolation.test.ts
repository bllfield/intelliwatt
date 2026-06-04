import { describe, expect, it } from "vitest";
import {
  isolateBuildInputsForUserSite,
  isOnePathAdminSmtPastRunCaller,
  isPersistedAdminLabTestHomeLabel,
  isUserSiteSimulationCaller,
  resolveOnePathPastPreferredActualSource,
} from "@/lib/usage/userSiteSimulationIsolation";
import {
  GAPFILL_LAB_TEST_HOME_LABEL,
  MANUAL_MONTHLY_LAB_TEST_HOME_LABEL,
  ONE_PATH_LAB_TEST_HOME_LABEL,
} from "@/modules/usageSimulator/labTestHome";
import {
  buildVisibleHouseEntryCounts,
  isAdminLabTestHomeForUserSite,
  pickCanonicalNonStackableEntryId,
  pickVisibleHouseIdForSmtEntrySync,
  sumEligibleUserVisibleEntryAmount,
} from "@/lib/usage/userSiteSimulationIsolation";

describe("userSiteSimulationIsolation", () => {
  it("detects user-site callers", () => {
    expect(isUserSiteSimulationCaller("user_recalc")).toBe(true);
    expect(isUserSiteSimulationCaller("one_path_admin")).toBe(false);
  });

  it("locks SMT for One Path admin INTERVAL Past and cross-house SMT lab recalc", () => {
    expect(isOnePathAdminSmtPastRunCaller("one_path_admin_past_run")).toBe(true);
    expect(
      resolveOnePathPastPreferredActualSource({
        callerLabel: "one_path_admin_past_run",
        preferredActualSource: null,
      })
    ).toBe("SMT");
    expect(
      resolveOnePathPastPreferredActualSource({
        callerLabel: "user_recalc",
        isCrossHouseAdminLab: true,
        mode: "SMT_BASELINE",
        hasEsiid: true,
        preferredActualSource: null,
      })
    ).toBe("SMT");
    expect(
      resolveOnePathPastPreferredActualSource({
        callerLabel: "one_path_admin_gb_past_run",
        preferredActualSource: null,
      })
    ).toBe("GREEN_BUTTON");
  });

  it("detects admin lab test home labels", () => {
    expect(isPersistedAdminLabTestHomeLabel(GAPFILL_LAB_TEST_HOME_LABEL)).toBe(true);
    expect(isPersistedAdminLabTestHomeLabel(MANUAL_MONTHLY_LAB_TEST_HOME_LABEL)).toBe(true);
    expect(isPersistedAdminLabTestHomeLabel(ONE_PATH_LAB_TEST_HOME_LABEL)).toBe(true);
    expect(isPersistedAdminLabTestHomeLabel("Brian Home")).toBe(false);
    expect(isAdminLabTestHomeForUserSite({ label: ONE_PATH_LAB_TEST_HOME_LABEL })).toBe(true);
    expect(isAdminLabTestHomeForUserSite({ addressLine1: "One Path Lab Test Home" })).toBe(true);
  });

  it("prefers house-assigned row over null houseId when deduping", () => {
    const keepId = pickCanonicalNonStackableEntryId(
      [
        { id: "global-new", houseId: null, createdAt: "2026-05-01T00:00:00.000Z" },
        { id: "real-old", houseId: "real-home", createdAt: "2026-01-01T00:00:00.000Z" },
      ],
      new Set(),
    );
    expect(keepId).toBe("real-old");
  });

  it("rolls account-level entries into primary home display counts", () => {
    const { total, byHouseId } = buildVisibleHouseEntryCounts({
      entries: [
        { amount: 1, status: "ACTIVE", houseId: "real-home" },
        { amount: 1, status: "ACTIVE", houseId: null },
      ],
      visibleHouses: [{ id: "real-home", isPrimary: true }],
      visibleHouseIds: new Set(["real-home"]),
    });
    expect(total).toBe(2);
    expect(byHouseId.get("real-home")).toBe(2);
  });

  it("prefers non-lab house when deduping non-stackable entries", () => {
    const keepId = pickCanonicalNonStackableEntryId(
      [
        { id: "lab-new", houseId: "lab-home", createdAt: "2026-05-01T00:00:00.000Z" },
        { id: "real-old", houseId: "real-home", createdAt: "2026-01-01T00:00:00.000Z" },
      ],
      new Set(["lab-home"]),
    );
    expect(keepId).toBe("real-old");
  });

  it("prefers primary visible home for SMT entry sync", () => {
    const picked = pickVisibleHouseIdForSmtEntrySync({
      visibleHouses: [
        { id: "lab", isPrimary: false },
        { id: "real", isPrimary: true },
      ],
      smtAuthorizedVisibleHouseIds: ["lab", "real"],
    });
    expect(picked).toBe("real");
  });

  it("excludes admin lab-home entries from user-visible jackpot totals", () => {
    const visibleHouseIds = new Set(["real-home"]);
    const total = sumEligibleUserVisibleEntryAmount(
      [
        { amount: 1, status: "ACTIVE", houseId: "real-home" },
        { amount: 1, status: "ACTIVE", houseId: "lab-home" },
        { amount: 1, status: "EXPIRED", houseId: "real-home" },
      ],
      visibleHouseIds,
    );
    expect(total).toBe(1);
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
