import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

vi.mock("server-only", () => ({}));

const gateOnePathSimAdmin = vi.fn();
const getSimulationVariablePolicy = vi.fn();
const getSimulationVariableOverrides = vi.fn();
const saveSimulationVariableOverrides = vi.fn();
const resetSimulationVariableOverrides = vi.fn();

vi.mock("@/app/api/admin/tools/one-path-sim/_helpers", () => ({
  gateOnePathSimAdmin: (...args: any[]) => gateOnePathSimAdmin(...args),
}));

vi.mock("@/modules/usageSimulator/simulationVariablePolicy", () => ({
  SIMULATION_VARIABLE_OVERRIDE_CONFIRMATION: "OVERRIDE",
  DEFAULT_SIMULATION_VARIABLE_POLICY: { pastDayCore: { minDaysMonthDayType: 4 } },
  SIMULATION_VARIABLE_POLICY_FAMILY_META: {
    pastDayCore: { title: "Past Day Core", description: "fallbacks" },
  },
  getSimulationVariablePolicy: (...args: any[]) => getSimulationVariablePolicy(...args),
  getSimulationVariableOverrides: (...args: any[]) => getSimulationVariableOverrides(...args),
  saveSimulationVariableOverrides: (...args: any[]) => saveSimulationVariableOverrides(...args),
  resetSimulationVariableOverrides: (...args: any[]) => resetSimulationVariableOverrides(...args),
}));

function buildRequest(method: "GET" | "POST", body?: Record<string, unknown>) {
  return new NextRequest("http://localhost/api/admin/tools/one-path-sim/variables", {
    method,
    headers: body ? { "content-type": "application/json" } : undefined,
    body: body ? JSON.stringify(body) : undefined,
  });
}

describe("admin one path sim variables route", () => {
  beforeEach(() => {
    gateOnePathSimAdmin.mockReset();
    getSimulationVariablePolicy.mockReset();
    getSimulationVariableOverrides.mockReset();
    saveSimulationVariableOverrides.mockReset();
    resetSimulationVariableOverrides.mockReset();

    gateOnePathSimAdmin.mockReturnValue(null);
    getSimulationVariableOverrides.mockResolvedValue({ pastDayCore: { minDaysMonthDayType: 9 } });
    getSimulationVariablePolicy.mockResolvedValue({
      effective: { pastDayCore: { minDaysMonthDayType: 9 } },
      overrides: { pastDayCore: { minDaysMonthDayType: 9 } },
    });
  });

  it("returns effective shared variable families", async () => {
    const { GET } = await import("@/app/api/admin/tools/one-path-sim/variables/route");
    const res = await GET(buildRequest("GET"));
    const json = await res.json();

    expect(res.status).toBe(200);
    expect(json.ok).toBe(true);
    expect(json.confirmationKeyword).toBe("OVERRIDE");
    expect(json.effective.pastDayCore.minDaysMonthDayType).toBe(9);
  });

  it("requires the OVERRIDE confirmation string before saving", async () => {
    const { POST } = await import("@/app/api/admin/tools/one-path-sim/variables/route");
    const res = await POST(
      buildRequest("POST", {
        family: "pastDayCore",
        override: { minDaysMonthDayType: 12 },
        confirmation: "NOPE",
      })
    );
    const json = await res.json();

    expect(res.status).toBe(400);
    expect(json.error).toBe("override_confirmation_required");
    expect(saveSimulationVariableOverrides).not.toHaveBeenCalled();
  });

  it("saves a family override through the shared store", async () => {
    const { POST } = await import("@/app/api/admin/tools/one-path-sim/variables/route");
    const res = await POST(
      buildRequest("POST", {
        family: "pastDayCore",
        override: { minDaysMonthDayType: 12 },
        confirmation: "OVERRIDE",
      })
    );
    const json = await res.json();

    expect(res.status).toBe(200);
    expect(saveSimulationVariableOverrides).toHaveBeenCalledWith({
      pastDayCore: { minDaysMonthDayType: 12 },
    });
    expect(json.ok).toBe(true);
  });
});
