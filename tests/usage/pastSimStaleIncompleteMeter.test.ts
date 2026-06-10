import { describe, expect, it } from "vitest";
import {
  applyPastSimDisplayTruthOverlay,
  applyPastSimDisplayTruthToDataset,
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

  it("relabels stale incomplete-meter via persisted GB trusted home keys", () => {
    const rows = applyPastSimDisplayTruthOverlay(
      [
        {
          date: "2025-11-02",
          kwh: 33.48,
          source: "SIMULATED",
          sourceDetail: "SIMULATED_INCOMPLETE_METER",
        },
      ],
      {
        greenButtonTrustedHomeDateKeys: new Set(["2025-11-02"]),
      }
    );
    expect(rows[0]).toMatchObject({
      source: "ACTUAL",
      sourceDetail: "ACTUAL",
    });
  });

  it("applyPastSimDisplayTruthToDataset updates daily and series.daily", () => {
    const dataset: Record<string, unknown> = {
      meta: { datasetKind: "SIMULATED" },
      summary: { totalKwh: 33.48 },
      totals: { netKwh: 33.48, importKwh: 33.48, exportKwh: 0 },
      daily: [
        {
          date: "2025-11-02",
          kwh: 33.48,
          source: "SIMULATED",
          sourceDetail: "SIMULATED_INCOMPLETE_METER",
        },
      ],
      series: {
        daily: [{ timestamp: "2025-11-02T00:00:00.000Z", kwh: 33.48, source: "SIMULATED" }],
      },
    };
    applyPastSimDisplayTruthToDataset(dataset, {
      sageByDate: new Map([["2025-11-02", 34.9]]),
      smtSlotCompleteDateKeys: new Set(["2025-11-02"]),
    });
    expect((dataset.daily as Array<{ source: string; kwh: number }>)[0]).toMatchObject({
      source: "ACTUAL",
      kwh: 34.9,
    });
    expect((dataset.totals as { netKwh: number }).netKwh).toBe(34.9);
  });

  it("applyPastSimDisplayTruthToDataset skips manual-only Past sim datasets", () => {
    const dataset: Record<string, unknown> = {
      meta: {
        datasetKind: "SIMULATED",
        mode: "MANUAL_TOTALS",
        usageInputMode: "MANUAL_MONTHLY",
      },
      summary: { totalKwh: 33.48 },
      totals: { netKwh: 33.48, importKwh: 33.48, exportKwh: 0 },
      daily: [
        {
          date: "2025-11-02",
          kwh: 33.48,
          source: "SIMULATED",
          sourceDetail: "SIMULATED_MANUAL_CONSTRAINED",
        },
      ],
    };
    applyPastSimDisplayTruthToDataset(dataset, {
      sageByDate: new Map([["2025-11-02", 34.9]]),
      smtSlotCompleteDateKeys: new Set(["2025-11-02"]),
    });
    expect((dataset.daily as Array<{ source: string; kwh: number }>)[0]).toMatchObject({
      source: "SIMULATED",
      kwh: 33.48,
    });
  });
});
