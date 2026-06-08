import { describe, expect, it } from "vitest";
import { buildManualUsageReadModel as buildLiveManualUsageReadModel } from "@/modules/manualUsage/readModel";
import { buildManualUsageReadModel } from "@/modules/onePathSim/manualReadModel";

describe("one path manual read model facade", () => {
  it("delegates to modules/manualUsage/readModel (prefers persisted daily totals over interval rescans)", () => {
    const payload = {
      mode: "MONTHLY" as const,
      anchorEndDate: "2025-04-30",
      monthlyKwh: [{ month: "2025-04", kwh: 300 }],
      statementRanges: [{ month: "2025-04", startDate: "2025-04-01", endDate: "2025-04-30" }],
      travelRanges: [],
    };
    const dataset = {
      meta: {
        timezone: "UTC",
        filledMonths: [],
        manualMonthlyInputState: {
          inputKindByMonth: {
            "2025-04": "entered_nonzero",
          },
        },
      },
      daily: Array.from({ length: 30 }, (_, idx) => ({
        date: `2025-04-${String(idx + 1).padStart(2, "0")}`,
        kwh: idx === 29 ? 9.1 : 9.69,
      })),
      series: {
        intervals15: Array.from({ length: 30 }, (_, idx) => ({
          timestamp: `2025-04-${String(idx + 1).padStart(2, "0")}T00:00:00.000Z`,
          kwh: 10,
        })),
      },
    };

    const forkReadModel = buildManualUsageReadModel({ payload, dataset, actualDataset: null });
    const liveReadModel = buildLiveManualUsageReadModel({ payload, dataset, actualDataset: null });

    expect(forkReadModel).toEqual(liveReadModel);
    expect(forkReadModel?.billPeriodCompare.rows[0]).toMatchObject({
      stageOneTargetTotalKwh: 300,
      simulatedStatementTotalKwh: 290.11,
      deltaKwh: -9.89,
      status: "delta_present",
    });
  });
});
