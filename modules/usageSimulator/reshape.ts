import type { ApplianceProfilePayloadV1 } from "@/modules/applianceProfile/validation";
import type { HomeProfileInput } from "@/modules/homeProfile/validation";

function clamp(n: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, n));
}

function occ(home: HomeProfileInput): number {
  return Math.max(
    1,
    (Number(home.occupantsWork) || 0) + (Number(home.occupantsSchool) || 0) + (Number(home.occupantsHomeAllDay) || 0),
  );
}

function sf(home: HomeProfileInput): number {
  return clamp(Number(home.squareFeet) || 0, 100, 50_000);
}

function hasType(p: ApplianceProfilePayloadV1, t: string): boolean {
  return Boolean(p.appliances?.some((a) => String(a?.type ?? "") === t));
}

function monthIndex0(ym: string): number | null {
  const m = /^\d{4}-(\d{2})$/.exec(String(ym ?? "").trim());
  if (!m) return null;
  const mo = Number(m[1]);
  if (!Number.isFinite(mo) || mo < 1 || mo > 12) return null;
  return mo - 1;
}

export function reshapeMonthlyTotalsFromBaseline(args: {
  canonicalMonths: string[];
  baselineMonthlyTotalsKwhByMonth: Record<string, number>;
  baselineHome: HomeProfileInput;
  baselineAppliances: ApplianceProfilePayloadV1;
  currentHome: HomeProfileInput;
  currentAppliances: ApplianceProfilePayloadV1;
}): { monthlyTotalsKwhByMonth: Record<string, number>; notes: string[] } {
  const { canonicalMonths, baselineMonthlyTotalsKwhByMonth, baselineHome, baselineAppliances, currentHome, currentAppliances } = args;
  const notes: string[] = [];

  // Global scaling: square footage + occupancy.
  const sfRatio = sf(currentHome) / sf(baselineHome);
  const occRatio = occ(currentHome) / occ(baselineHome);
  let global = Math.pow(clamp(sfRatio, 0.6, 1.8), 0.85) * Math.pow(clamp(occRatio, 0.6, 2.0), 0.35);

  // Appliance presence deltas.
  const evDelta = (hasType(currentAppliances, "ev") ? 1 : 0) - (hasType(baselineAppliances, "ev") ? 1 : 0);
  const poolDelta = (hasType(currentAppliances, "pool") ? 1 : 0) - (hasType(baselineAppliances, "pool") ? 1 : 0);
  const hvacDelta = (hasType(currentAppliances, "hvac") ? 1 : 0) - (hasType(baselineAppliances, "hvac") ? 1 : 0);
  if (evDelta !== 0) global *= evDelta > 0 ? 1.10 : 0.93;
  if (poolDelta !== 0) global *= poolDelta > 0 ? 1.08 : 0.95;
  if (hvacDelta !== 0) global *= hvacDelta > 0 ? 1.05 : 0.97;

  // Thermostat deltas: tilt seasonality rather than scaling everything.
  const summerDelta = clamp((Number(currentHome.summerTemp) || 73) - (Number(baselineHome.summerTemp) || 73), -10, 10);
  const winterDelta = clamp((Number(currentHome.winterTemp) || 70) - (Number(baselineHome.winterTemp) || 70), -10, 10);

  // Efficiency flags.
  if (Boolean(currentHome.ledLights) && !Boolean(baselineHome.ledLights)) global *= 0.985;
  if (!Boolean(currentHome.ledLights) && Boolean(baselineHome.ledLights)) global *= 1.01;
  if (Boolean(currentHome.smartThermostat) && !Boolean(baselineHome.smartThermostat)) global *= 0.992;
  if (!Boolean(currentHome.smartThermostat) && Boolean(baselineHome.smartThermostat)) global *= 1.008;

  const monthlyTotalsKwhByMonth: Record<string, number> = {};
  for (const ym of canonicalMonths) {
    const base = Math.max(0, Number(baselineMonthlyTotalsKwhByMonth[ym] ?? 0) || 0);
    const mi = monthIndex0(ym);

    // Summer months (Jun-Sep) respond to summer setpoint; lower setpoint increases usage.
    const isSummer = mi != null && mi >= 5 && mi <= 8;
    // Winter months (Dec-Feb) respond to winter setpoint; higher setpoint increases usage.
    const isWinter = mi != null && (mi === 11 || mi <= 1);

    let seasonal = 1;
    if (isSummer) seasonal *= 1 + clamp(-summerDelta * 0.02, -0.12, 0.12);
    if (isWinter) seasonal *= 1 + clamp(winterDelta * 0.015, -0.09, 0.09);

    monthlyTotalsKwhByMonth[ym] = base * global * seasonal;
  }

  notes.push("Reshaping applies coefficient-based scaling to monthly totals (V1).");
  return { monthlyTotalsKwhByMonth, notes };
}

