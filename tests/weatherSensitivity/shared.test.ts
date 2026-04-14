import { describe, expect, it } from "vitest";
import { buildSharedWeatherSensitivityScore } from "@/modules/weatherSensitivity/shared";

describe("shared weather sensitivity scoring owner", () => {
  it("uses only eligible actual interval-backed days and ignores compare rows", () => {
    const result = buildSharedWeatherSensitivityScore({
      actualDataset: {
        summary: { intervalsCount: 96 * 5 },
        daily: [
          { date: "2025-01-10", kwh: 42, source: "ACTUAL" },
          { date: "2025-01-11", kwh: 39, source: "ACTUAL" },
          { date: "2025-04-15", kwh: 24, source: "ACTUAL" },
          { date: "2025-07-20", kwh: 51, source: "ACTUAL" },
          { date: "2025-07-21", kwh: 53, source: "ACTUAL" },
          { date: "2025-07-22", kwh: 999, source: "SIMULATED", sourceDetail: "SIMULATED_TRAVEL_VACANT" },
          { date: "2025-07-23", kwh: 888, source: "SIMULATED", sourceDetail: "SIMULATED_INCOMPLETE_METER" },
        ],
        dailyWeather: {
          "2025-01-10": { tAvgF: 39, tMinF: 31, tMaxF: 46, hdd65: 26, cdd65: 0 },
          "2025-01-11": { tAvgF: 41, tMinF: 32, tMaxF: 48, hdd65: 24, cdd65: 0 },
          "2025-04-15": { tAvgF: 65, tMinF: 57, tMaxF: 73, hdd65: 0, cdd65: 0 },
          "2025-07-20": { tAvgF: 83, tMinF: 75, tMaxF: 92, hdd65: 0, cdd65: 18 },
          "2025-07-21": { tAvgF: 85, tMinF: 76, tMaxF: 94, hdd65: 0, cdd65: 20 },
          "2025-07-22": { tAvgF: 84, tMinF: 75, tMaxF: 93, hdd65: 0, cdd65: 19 },
          "2025-07-23": { tAvgF: 86, tMinF: 77, tMaxF: 95, hdd65: 0, cdd65: 21 },
        },
      },
      compareProjection: {
        rows: [
          { localDate: "2025-01-10", actualDayKwh: 1, simulatedDayKwh: 9999, errorKwh: 9998, percentError: 9998 },
          { localDate: "2025-07-20", actualDayKwh: 1, simulatedDayKwh: 9999, errorKwh: 9998, percentError: 9998 },
        ],
      },
      homeProfile: {
        squareFeet: 2200,
        fuelConfiguration: "all_electric",
        hvacType: "central_air",
        heatingType: "heat_pump",
        summerTemp: 72,
        winterTemp: 68,
        occupantsHomeAllDay: 1,
      },
      applianceProfile: {
        fuelConfiguration: { heating: "electric" },
        appliances: [{ type: "POOL_PUMP", hp: 1.5 }, { type: "EV_CHARGER" }],
      },
    });

    expect(result).not.toBeNull();
    expect(result?.scoringMode).toBe("INTERVAL_BASED");
    expect(result?.eligibleActualDayCount).toBe(5);
    expect(result?.excludedSimulatedDayCount).toBe(2);
    expect(result?.excludedTravelDayCount).toBe(1);
    expect(result?.excludedIncompleteMeterDayCount).toBe(1);
    expect(result?.requiredInputAdjustmentsApplied).toEqual(
      expect.arrayContaining(["square_footage", "fuel_configuration", "hvac", "occupancy", "pool", "ev", "thermostat"])
    );
    expect(result?.coolingSlopeKwhPerCDD).toBeGreaterThan(0);
    expect(result?.heatingSlopeKwhPerHDD).toBeGreaterThan(0);
  });

  it("builds billing-period scoring from entered bill totals plus exact bill-date weather and ignores simulated daily output", () => {
    const result = buildSharedWeatherSensitivityScore({
      manualUsagePayload: {
        mode: "MONTHLY",
        anchorEndDate: "2025-08-31",
        monthlyKwh: [
          { month: "2025-06", kwh: 900 },
          { month: "2025-07", kwh: 1500 },
          { month: "2025-08", kwh: 1350 },
        ],
        statementRanges: [
          { month: "2025-06", startDate: "2025-05-29", endDate: "2025-06-28" },
          { month: "2025-07", startDate: "2025-06-29", endDate: "2025-07-28" },
          { month: "2025-08", startDate: "2025-07-29", endDate: "2025-08-31" },
        ],
        travelRanges: [{ startDate: "2025-07-10", endDate: "2025-07-12" }],
      },
      manualScoringContext: {
        simulatedDailyRows: [
          { date: "2025-06-30", kwh: 999 },
          { date: "2025-07-01", kwh: 999 },
        ],
      },
      dailyWeather: {
        "2025-05-29": { tAvgF: 72, tMinF: 65, tMaxF: 80, hdd65: 0, cdd65: 7 },
        "2025-06-28": { tAvgF: 77, tMinF: 70, tMaxF: 84, hdd65: 0, cdd65: 12 },
        "2025-06-29": { tAvgF: 81, tMinF: 74, tMaxF: 90, hdd65: 0, cdd65: 16 },
        "2025-07-28": { tAvgF: 86, tMinF: 78, tMaxF: 95, hdd65: 0, cdd65: 21 },
        "2025-07-29": { tAvgF: 84, tMinF: 76, tMaxF: 93, hdd65: 0, cdd65: 19 },
        "2025-08-31": { tAvgF: 82, tMinF: 74, tMaxF: 91, hdd65: 0, cdd65: 17 },
      },
      homeProfile: {
        squareFeet: 1800,
        fuelConfiguration: "mixed_fuel",
        hvacType: "central_air",
        heatingType: "gas_furnace",
        summerTemp: 70,
        winterTemp: 68,
        occupantsHomeAllDay: 0,
        insulationType: null,
        windowType: null,
      },
      applianceProfile: {
        fuelConfiguration: { heating: "gas" },
        appliances: [],
      },
    });

    expect(result).not.toBeNull();
    expect(result?.scoringMode).toBe("BILLING_PERIOD_BASED");
    expect(result?.eligibleBillPeriodCount).toBe(2);
    expect(result?.excludedTravelBillPeriodCount).toBe(1);
    expect(result?.excludedSimulatedDayCount).toBe(0);
    expect(result?.nextDetailPromptType).toBe("ADD_ENVELOPE_DETAILS");
    expect(result?.recommendationFlags?.needsEnvelopeDetail).toBe(true);
    expect(result?.confidenceScore0to100).toBeGreaterThan(0);
  });

  it("prefers interval-backed scoring over manual bill periods when actual interval truth exists", () => {
    const result = buildSharedWeatherSensitivityScore({
      actualDataset: {
        summary: { intervalsCount: 96 * 4 },
        daily: [
          { date: "2025-01-10", kwh: 42, source: "ACTUAL" },
          { date: "2025-04-15", kwh: 24, source: "ACTUAL" },
          { date: "2025-07-20", kwh: 51, source: "ACTUAL" },
          { date: "2025-12-05", kwh: 43, source: "ACTUAL" },
        ],
        dailyWeather: {
          "2025-01-10": { tAvgF: 39, hdd65: 26, cdd65: 0 },
          "2025-04-15": { tAvgF: 65, hdd65: 0, cdd65: 0 },
          "2025-07-20": { tAvgF: 83, hdd65: 0, cdd65: 18 },
          "2025-12-05": { tAvgF: 43, hdd65: 22, cdd65: 0 },
        },
      },
      manualUsagePayload: {
        mode: "MONTHLY",
        anchorEndDate: "2025-08-31",
        monthlyKwh: [
          { month: "2025-06", kwh: 900 },
          { month: "2025-07", kwh: 1500 },
        ],
        statementRanges: [
          { month: "2025-06", startDate: "2025-05-29", endDate: "2025-06-28" },
          { month: "2025-07", startDate: "2025-06-29", endDate: "2025-07-28" },
        ],
        travelRanges: [],
      },
      homeProfile: {
        squareFeet: 1800,
        fuelConfiguration: "all_electric",
        hvacType: "central_air",
        heatingType: "heat_pump",
        summerTemp: 71,
        winterTemp: 69,
      },
      applianceProfile: {
        fuelConfiguration: { heating: "electric" },
        appliances: [],
      },
    });

    expect(result).not.toBeNull();
    expect(result?.scoringMode).toBe("INTERVAL_BASED");
    expect(result?.eligibleActualDayCount).toBe(4);
  });

  it("does not require insulation or window details to compute the initial score", () => {
    const result = buildSharedWeatherSensitivityScore({
      actualDataset: {
        summary: { intervalsCount: 96 * 3 },
        daily: [
          { date: "2025-02-01", kwh: 35, source: "ACTUAL" },
          { date: "2025-04-01", kwh: 20, source: "ACTUAL" },
          { date: "2025-08-01", kwh: 41, source: "ACTUAL" },
        ],
        dailyWeather: {
          "2025-02-01": { tAvgF: 42, tMinF: 34, tMaxF: 50, hdd65: 23, cdd65: 0 },
          "2025-04-01": { tAvgF: 65, tMinF: 56, tMaxF: 73, hdd65: 0, cdd65: 0 },
          "2025-08-01": { tAvgF: 84, tMinF: 76, tMaxF: 92, hdd65: 0, cdd65: 19 },
        },
      },
      homeProfile: {
        squareFeet: 1600,
        fuelConfiguration: "all_electric",
        hvacType: "central_air",
        heatingType: "heat_pump",
        summerTemp: 74,
        winterTemp: 67,
        insulationType: null,
        windowType: null,
      },
      applianceProfile: {
        fuelConfiguration: { heating: "electric" },
        appliances: [],
      },
    });

    expect(result).not.toBeNull();
    expect(result?.weatherEfficiencyScore0to100).toBeGreaterThanOrEqual(0);
    expect(result?.scoreVersion).toBeTruthy();
    expect(result?.calculationVersion).toBeTruthy();
  });
});
