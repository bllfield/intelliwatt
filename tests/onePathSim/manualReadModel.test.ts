import { describe, expect, it } from "vitest";
import { buildManualUsageReadModel } from "@/modules/onePathSim/manualReadModel";

describe("one path manual read model", () => {
  it("prefers raw interval totals for simulated bill-period parity so exact matches do not drift on rounded daily rows", () => {
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

    const readModel = buildManualUsageReadModel({ payload, dataset, actualDataset: null });

    expect(readModel?.billPeriodCompare.rows[0]).toMatchObject({
      stageOneTargetTotalKwh: 300,
      simulatedStatementTotalKwh: 300,
      deltaKwh: 0,
      status: "reconciled",
    });
  });
});
