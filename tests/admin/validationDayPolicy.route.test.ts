import { beforeEach, describe, expect, it, vi } from "vitest";

const getValidationDayPolicySnapshot = vi.fn();
const previewGlobalValidationDaySelection = vi.fn();

vi.mock("@/app/api/admin/tools/manual-gapfill/_helpers", () => ({
  gateManualGapfillAdmin: vi.fn(() => null),
}));

vi.mock("@/lib/usage/validationDayPolicy", () => ({
  getValidationDayPolicySnapshot: (...args: unknown[]) => getValidationDayPolicySnapshot(...args),
  previewGlobalValidationDaySelection: (...args: unknown[]) => previewGlobalValidationDaySelection(...args),
}));

import { GET, POST } from "@/app/api/admin/tools/validation-day-policy/route";

describe("/api/admin/tools/validation-day-policy", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env.ADMIN_TOKEN = "secret";
    getValidationDayPolicySnapshot.mockReturnValue({
      ok: true,
      policyRevision: "unified_past_validation_stratified_14_v4",
      policyLayer: "global_validation_day_policy_v1",
      policyHash: "hash-1",
      defaults: {
        selectionMode: "stratified_weather_balanced",
        validationDayCount: 14,
        surface: "admin_lab",
      },
      activePolicy: {
        selectionMode: "stratified_weather_balanced",
        validationDayCount: 14,
        overrideSource: "code_defaults",
        envOverrideApplied: false,
      },
      envOverride: null,
    });
    previewGlobalValidationDaySelection.mockResolvedValue({
      ok: true,
      policyRevision: "unified_past_validation_stratified_14_v4",
      policyLayer: "global_validation_day_policy_v1",
      policyHash: "hash-1",
      selectionMode: "stratified_weather_balanced",
      validationDayCount: 14,
      selectedValidationDateKeys: ["2025-07-04", "2025-08-12"],
      diagnostics: {
        candidateDateKeyCount: 100,
        excludedTravelDateKeyCount: 0,
        localGapFillSelectorUsed: false,
        sharedPolicySelectorOwner: "selectValidationDayKeys",
      },
      warnings: [],
    });
  });

  it("GET returns active policy snapshot without writes", async () => {
    const res = await GET({
      nextUrl: new URL("http://localhost/api/admin/tools/validation-day-policy?surface=admin_lab"),
      cookies: { get: () => undefined },
      headers: new Headers({ "x-admin-token": "secret" }),
    } as any);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.policyHash).toBe("hash-1");
    expect(previewGlobalValidationDaySelection).not.toHaveBeenCalled();
  });

  it("POST preview returns selected keys without writes", async () => {
    const res = await POST({
      json: async () => ({ houseId: "house-1", userId: "user-1" }),
      cookies: { get: () => undefined },
      headers: new Headers({ "x-admin-token": "secret" }),
    } as any);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.selectedValidationDateKeys).toEqual(["2025-07-04", "2025-08-12"]);
    expect(body.diagnostics.localGapFillSelectorUsed).toBe(false);
    expect(previewGlobalValidationDaySelection).toHaveBeenCalledWith(
      expect.objectContaining({ houseId: "house-1", userId: "user-1" })
    );
  });
});
