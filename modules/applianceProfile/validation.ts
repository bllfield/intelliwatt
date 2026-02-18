export type ApplianceRow = { id: string; type: string; data: Record<string, any> };
export type ApplianceProfilePayloadV1 = {
  version: 1;
  fuelConfiguration: string;
  appliances: ApplianceRow[];
};

function requireNonEmptyString(v: unknown): string | null {
  if (typeof v !== "string") return null;
  const s = v.trim();
  return s.length ? s : null;
}

export function normalizeStoredApplianceProfile(raw: any): ApplianceProfilePayloadV1 {
  // Back-compat: older records stored just an array of rows.
  if (Array.isArray(raw)) {
    return {
      version: 1,
      fuelConfiguration: "",
      appliances: raw as any,
    };
  }

  const version = raw?.version === 1 ? 1 : 1;
  const fuelConfiguration = typeof raw?.fuelConfiguration === "string" ? raw.fuelConfiguration : "";
  const appliances = Array.isArray(raw?.appliances) ? raw.appliances : [];

  return { version, fuelConfiguration, appliances };
}

export function validateApplianceProfile(input: any): { ok: true; value: ApplianceProfilePayloadV1 } | { ok: false; error: string } {
  const fuelConfiguration = requireNonEmptyString(input?.fuelConfiguration);
  if (!fuelConfiguration) return { ok: false, error: "fuelConfiguration_required" };

  const appliances = Array.isArray(input?.appliances) ? input.appliances : [];
  for (let i = 0; i < appliances.length; i++) {
    const t = appliances[i]?.type;
    if (typeof t !== "string" || !t.trim()) {
      return { ok: false, error: "appliance_type_required" };
    }
  }

  return {
    ok: true,
    value: {
      version: 1,
      fuelConfiguration,
      appliances,
    },
  };
}

