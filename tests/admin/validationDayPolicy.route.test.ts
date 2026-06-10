import { beforeEach, describe, expect, it, vi } from "vitest";

const getValidationDayPolicySnapshotLive = vi.fn();
const previewGlobalValidationDaySelection = vi.fn();
const saveStoredValidationDayPolicy = vi.fn();
const clearStoredValidationDayPolicy = vi.fn();
const lookupAdminHousesByEmail = vi.fn();
const resolveAdminHouseSelection = vi.fn();

vi.mock("@/app/api/admin/tools/manual-gapfill/_helpers", () => ({
  gateManualGapfillAdmin: vi.fn(() => null),
}));

vi.mock("@/lib/admin/adminHouseLookup", () => ({
  lookupAdminHousesByEmail: (...args: unknown[]) => lookupAdminHousesByEmail(...args),
  resolveAdminHouseSelection: (...args: unknown[]) => resolveAdminHouseSelection(...args),
}));

vi.mock("@/lib/usage/validationDayPolicy", () => ({
  VALIDATION_DAY_POLICY_SAVE_CONFIRMATION: "APPLY",
  getValidationDayPolicySnapshotLive: (...args: unknown[]) => getValidationDayPolicySnapshotLive(...args),
  previewGlobalValidationDaySelection: (...args: unknown[]) => previewGlobalValidationDaySelection(...args),
  saveStoredValidationDayPolicy: (...args: unknown[]) => saveStoredValidationDayPolicy(...args),
  clearStoredValidationDayPolicy: (...args: unknown[]) => clearStoredValidationDayPolicy(...args),
}));

import { GET, POST } from "@/app/api/admin/tools/validation-day-policy/route";

describe("/api/admin/tools/validation-day-policy", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env.ADMIN_TOKEN = "secret";
    getValidationDayPolicySnapshotLive.mockResolvedValue({
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
        surface: "admin_lab",
      },
      storedPolicy: null,
      modeCatalog: [],
      guardrails: [],
      wiredSurfaces: [],
      confirmationKeyword: "APPLY",
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
        windowStart: "2025-06-08",
        windowEnd: "2026-06-07",
        candidateDateKeyCount: 100,
        excludedTravelDateKeyCount: 0,
        selectionDiagnostics: {},
        localGapFillSelectorUsed: false,
        sharedPolicySelectorOwner: "selectValidationDayKeys",
      },
      warnings: [],
    });
    lookupAdminHousesByEmail.mockResolvedValue({
      ok: true,
      email: "customer@example.com",
      userId: "user-1",
      houses: [{ id: "house-1", esiid: "E1", isPrimary: true, label: "Primary" }],
    });
  });

  it("GET returns active policy snapshot", async () => {
    const res = await GET({
      nextUrl: new URL("http://localhost/api/admin/tools/validation-day-policy?surface=admin_lab"),
      cookies: { get: () => undefined },
      headers: new Headers({ "x-admin-token": "secret" }),
    } as any);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.policyHash).toBe("hash-1");
    expect(getValidationDayPolicySnapshotLive).toHaveBeenCalled();
  });

  it("POST preview resolves house by email", async () => {
    const res = await POST({
      json: async () => ({ action: "preview", email: "customer@example.com" }),
      cookies: { get: () => undefined },
      headers: new Headers({ "x-admin-token": "secret" }),
    } as any);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.selectedValidationDateKeys).toEqual(["2025-07-04", "2025-08-12"]);
    expect(previewGlobalValidationDaySelection).toHaveBeenCalledWith(
      expect.objectContaining({ houseId: "house-1", userId: "user-1" })
    );
  });

  it("POST preview rejects missing email", async () => {
    const res = await POST({
      json: async () => ({ action: "preview" }),
      cookies: { get: () => undefined },
      headers: new Headers({ "x-admin-token": "secret" }),
    } as any);
    expect(res.status).toBe(400);
  });

  it("POST save persists policy with confirmation", async () => {
    saveStoredValidationDayPolicy.mockResolvedValue({
      selectionMode: "customer_style_seasonal_mix",
      validationDayCount: 12,
      surface: "admin_lab",
      updatedAt: "2026-06-06T00:00:00.000Z",
      updatedBy: null,
    });
    const res = await POST({
      json: async () => ({
        action: "save",
        selectionMode: "customer_style_seasonal_mix",
        validationDayCount: 12,
        confirmation: "APPLY",
      }),
      cookies: { get: () => undefined },
      headers: new Headers({ "x-admin-token": "secret" }),
    } as any);
    expect(res.status).toBe(200);
    expect(saveStoredValidationDayPolicy).toHaveBeenCalled();
  });
});
