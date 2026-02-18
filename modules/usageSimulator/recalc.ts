import type { SimulatorMode } from "@/modules/usageSimulator/requirements";

export async function requestSimulatorRecalc(args: { houseId: string; mode: SimulatorMode }) {
  const r = await fetch("/api/user/simulator/recalc", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(args),
    cache: "no-store",
  });
  const j = await r.json().catch(() => null);
  if (!r.ok || !j?.ok) {
    throw new Error(j?.error ? String(j.error) : `recalc_failed_${r.status}`);
  }
  return j;
}

