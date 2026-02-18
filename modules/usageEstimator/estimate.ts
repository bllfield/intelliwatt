import type { HomeProfileInput } from "@/modules/homeProfile/validation";
import type { ApplianceProfilePayloadV1 } from "@/modules/applianceProfile/validation";

export type UsageEstimate = {
  monthlyKwh: number[]; // length 12, aligned to provided canonical months order
  annualKwh: number;
  confidence: "LOW" | "MEDIUM";
  notes: string[];
  filledMonths: string[]; // YYYY-MM that were filled (not anchored)
};

const DEFAULT_SEASONAL_WEIGHTS_TX = [
  0.070, // Jan
  0.065, // Feb
  0.070, // Mar
  0.075, // Apr
  0.085, // May
  0.100, // Jun
  0.115, // Jul
  0.110, // Aug
  0.085, // Sep
  0.075, // Oct
  0.075, // Nov
  0.075, // Dec
];

function clamp(n: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, n));
}

function occupantsTotal(home: HomeProfileInput): number {
  return Math.max(
    0,
    (Number(home.occupantsWork) || 0) + (Number(home.occupantsSchool) || 0) + (Number(home.occupantsHomeAllDay) || 0),
  );
}

function hasAppliance(profile: ApplianceProfilePayloadV1 | null, type: string): boolean {
  return Boolean(profile?.appliances?.some((a) => String(a?.type ?? "") === type));
}

function yearMonthToMonthIndex0(ym: string): number | null {
  const m = /^(\d{4})-(\d{2})$/.exec(String(ym ?? "").trim());
  if (!m) return null;
  const mo = Number(m[2]);
  if (!Number.isFinite(mo) || mo < 1 || mo > 12) return null;
  return mo - 1;
}

function annualFromHomeAppliances(home: HomeProfileInput, appliances: ApplianceProfilePayloadV1 | null): { annualKwh: number; notes: string[] } {
  const notes: string[] = [];
  const sf = clamp(Number(home.squareFeet) || 0, 100, 50_000);
  const occ = clamp(occupantsTotal(home), 1, 25);

  // Baseline: simple deterministic sizing.
  let annual = sf * 5.0 + occ * 1500;

  // Fuel configuration impacts overall electricity.
  const fuel = String(home.fuelConfiguration || appliances?.fuelConfiguration || "").toLowerCase();
  if (fuel.includes("all_electric")) {
    annual *= 1.12;
  } else if (fuel.includes("mixed")) {
    annual *= 1.0;
  }

  // HVAC presence.
  if (hasAppliance(appliances, "hvac")) annual *= 1.08;
  // Electric water heating tends to add load.
  if (hasAppliance(appliances, "wh")) {
    const anyElectric = appliances?.appliances?.some((a) => {
      if (String(a?.type ?? "") !== "wh") return false;
      const ft = String(a?.data?.fuel_type ?? a?.data?.heat_source ?? "").toLowerCase();
      return ft.includes("electric") || ft.includes("heat_pump");
    });
    if (anyElectric) annual *= 1.05;
  }
  // EV can be a large driver.
  if (hasAppliance(appliances, "ev")) annual *= 1.10;
  // Pool pumps can be large.
  if (hasAppliance(appliances, "pool")) annual *= 1.08;

  // Thermostat setpoints: small sensitivity.
  const summer = clamp(Number(home.summerTemp) || 73, 60, 90);
  const winter = clamp(Number(home.winterTemp) || 70, 50, 80);
  annual *= 1 + clamp((73 - summer) * 0.006, -0.06, 0.06);
  annual *= 1 + clamp((winter - 70) * 0.004, -0.04, 0.04);

  // Efficiency flags.
  if (home.ledLights) annual *= 0.98;
  if (home.smartThermostat) annual *= 0.99;

  notes.push("Estimate uses a simple deterministic sizing model (V1).");
  return { annualKwh: Math.max(0, annual), notes };
}

export function estimateUsageForCanonicalWindow(args: {
  canonicalMonths: string[]; // length 12
  home: HomeProfileInput;
  appliances: ApplianceProfilePayloadV1 | null;
  // Optional SMT anchors: if present, those months are used as fixed anchors and only missing months are filled.
  smtMonthlyKwhByMonth?: Record<string, number>;
}): UsageEstimate {
  const { canonicalMonths, home, appliances } = args;
  const notes: string[] = [];
  const filledMonths: string[] = [];

  const { annualKwh: annualRaw, notes: modelNotes } = annualFromHomeAppliances(home, appliances);
  notes.push(...modelNotes);

  // Monthly split using seasonal weights mapped by month-of-year.
  const wByMonth = canonicalMonths.map((ym) => {
    const mi = yearMonthToMonthIndex0(ym);
    return mi == null ? 1 / 12 : DEFAULT_SEASONAL_WEIGHTS_TX[mi] ?? 1 / 12;
  });
  const wSum = wByMonth.reduce((a, b) => a + b, 0) || 1;
  const wNorm = wByMonth.map((w) => w / wSum);

  // Baseline estimate.
  const baseMonthly = wNorm.map((w) => w * annualRaw);

  const anchors = args.smtMonthlyKwhByMonth ?? null;
  if (!anchors) {
    const annual = baseMonthly.reduce((a, b) => a + b, 0);
    return {
      monthlyKwh: baseMonthly,
      annualKwh: annual,
      confidence: "LOW",
      notes,
      filledMonths,
    };
  }

  // Gap fill: keep SMT months as anchors and fill missing months using seasonal weights,
  // then renormalize to keep anchored months fixed and scale only the filled months.
  const out = canonicalMonths.map((ym, idx) => {
    const v = anchors[ym];
    return typeof v === "number" && Number.isFinite(v) && v >= 0 ? v : baseMonthly[idx];
  });

  const anchoredMask = canonicalMonths.map((ym) => {
    const v = anchors[ym];
    return typeof v === "number" && Number.isFinite(v) && v >= 0;
  });

  const anchoredTotal = out.reduce((s, v, i) => s + (anchoredMask[i] ? v : 0), 0);
  const fillTotal = out.reduce((s, v, i) => s + (!anchoredMask[i] ? v : 0), 0);

  // If all 12 are anchored, we’re done.
  if (anchoredMask.every(Boolean)) {
    return {
      monthlyKwh: out,
      annualKwh: anchoredTotal,
      confidence: "MEDIUM",
      notes: [...notes, "Used SMT monthly anchors for the full canonical window."],
      filledMonths,
    };
  }

  // When some months are missing, scale the filled months so their sum matches the baseline model share.
  // This keeps the overall magnitude reasonable without mutating anchored months.
  const baselineAnnual = baseMonthly.reduce((a, b) => a + b, 0);
  const baselineFillTarget = baselineAnnual - anchoredTotal;
  const factor = fillTotal > 0 ? baselineFillTarget / fillTotal : 1;

  const monthlyKwh = out.map((v, i) => {
    if (anchoredMask[i]) return v;
    filledMonths.push(canonicalMonths[i]);
    return Math.max(0, v * factor);
  });

  const annual = monthlyKwh.reduce((a, b) => a + b, 0);
  return {
    monthlyKwh,
    annualKwh: annual,
    confidence: "MEDIUM",
    notes: [...notes, "Gap-filled missing months to complete the canonical 12-month window."],
    filledMonths,
  };
}

