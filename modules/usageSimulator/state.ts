import type { ApplianceProfilePayloadV1 } from "@/modules/applianceProfile/validation";
import type { HomeProfileInput } from "@/modules/homeProfile/validation";
import type { ManualUsagePayload } from "@/modules/simulatedUsage/types";

export type SimulatorLoadedState = {
  manualUsagePayload: ManualUsagePayload | null;
  homeProfile: HomeProfileInput | null;
  applianceProfile: ApplianceProfilePayloadV1 | null;
};

async function fetchJson<T>(url: string): Promise<T | null> {
  const r = await fetch(url, { cache: "no-store" });
  const j = (await r.json().catch(() => null)) as any;
  if (!r.ok || !j || j.ok === false) return null;
  return j as T;
}

export async function loadSimulatorStateClient(houseId: string): Promise<SimulatorLoadedState> {
  const [manual, home, appliances] = await Promise.all([
    fetchJson<{ ok: true; payload: ManualUsagePayload | null }>(`/api/user/manual-usage?houseId=${encodeURIComponent(houseId)}`),
    fetchJson<{ ok: true; profile: HomeProfileInput | null }>(`/api/user/home-profile?houseId=${encodeURIComponent(houseId)}`),
    fetchJson<{ ok: true; profile: ApplianceProfilePayloadV1 | null }>(`/api/user/appliances?houseId=${encodeURIComponent(houseId)}`),
  ]);

  return {
    manualUsagePayload: (manual as any)?.payload ?? null,
    homeProfile: (home as any)?.profile ?? null,
    applianceProfile: (appliances as any)?.profile ?? null,
  };
}

