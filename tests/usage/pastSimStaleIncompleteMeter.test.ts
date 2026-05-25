import { describe, expect, it } from "vitest";
import {
  applyPastSimDisplayTruthOverlay,
  filterSimulatedDateKeysWithoutStaleIncompleteMeter,
  incompleteMeterDateKeysFromPastMeta,
  pruneStaleIncompleteMeterFromPastDatasetMeta,
} from "@/lib/usage/pastSimStaleIncompleteMeter";

describe("pastSimStaleIncompleteMeter", () => {
  it("reads incomplete-meter keys from meta", () => {
    expect(
      incompleteMeterDateKeysFromPastMeta({
        simulatedSourceDetailByDate: {
          "2025-11-02": "SIMULATED_INCOMPLETE_METER",
          "2025-11-03": "SIMULATED_TRAVEL_VACANT",
        },
      })
    ).toEqual(["2025-11-02"]);
  });

  it("prunes stale incomplete-meter meta when SMT is slot-complete", () => {
    const meta: Record<string, unknown> = {
      simulatedSourceDetailByDate: {
        "2025-11-02": "SIMULATED_INCOMPLETE_METER",
        "2025-11-03": "SIMULATED_LEADING_MISSING",
      },
      canonicalArtifactSimulatedDayTotalsByDate: {
        "2025-11-02": 33.48,
        "2025-11-03": 1,
      },
    };
    pruneStaleIncompleteMeterFromPastDatasetMeta(meta, new Set(["2025-11-02"]));
    expect((meta.simulatedSourceDetailByDate as Record<string, string>)["2025-11-02"]).toBeUndefined();
    expect((meta.canonicalArtifactSimulatedDayTotalsByDate as Record<string, number>)["2025-11-02"]).toBeUndefined();
    expect((meta.simulatedSourceDetailByDate as Record<string, string>)["2025-11-03"]).toBe(
      "SIMULATED_LEADING_MISSING"
    );
  });

  it("only removes stale incomplete-meter days from simulated membership", () => {
    const filtered = filterSimulatedDateKeysWithoutStaleIncompleteMeter({
      simulatedDateKeys: new Set(["2025-11-02", "2025-11-03"]),
      staleIncompleteMeterDateKeys: new Set(["2025-11-02"]),
      slotCompleteDateKeys: new Set(["2025-11-02"]),
    });
    expect(Array.from(filtered).sort()).toEqual(["2025-11-03"]);
  });

  it("relabels stale incomplete-meter rows and applies sage kWh", () => {
    const rows = applyPastSimDisplayTruthOverlay(
      [
        {
          date: "2025-11-02",
          kwh: 33.48,
          source: "SIMULATED",
          sourceDetail: "SIMULATED_INCOMPLETE_METER",
        },
        {
          date: "2025-11-03",
          kwh: 10,
          source: "ACTUAL",
          sourceDetail: "ACTUAL",
        },
      ],
      {
        sageByDate: new Map([
          ["2025-11-02", 34.9],
          ["2025-11-03", 11.2],
        ]),
        smtSlotCompleteDateKeys: new Set(["2025-11-02"]),
      }
    );
    expect(rows[0]).toMatchObject({
      date: "2025-11-02",
      kwh: 34.9,
      source: "ACTUAL",
      sourceDetail: "ACTUAL",
    });
    expect(rows[1]?.kwh).toBe(11.2);
  });
});
