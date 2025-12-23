function safeNum(v: unknown): number | null {
  const n = typeof v === "number" ? v : typeof v === "string" ? Number(v) : NaN;
  return Number.isFinite(n) ? n : null;
}

function dollarsToCents(d: number): number {
  return Math.round(d * 100);
}

export function extractUsageChargeThresholdRule(rawText: string): {
  ok: boolean;
  feeCents: number;
  thresholdKwhExclusive: number;
  notes: string[];
} | null {
  const t = String(rawText ?? "");
  if (!t.trim()) return null;

  const notes: string[] = [];

  // Common EFL phrasing:
  // Usage Charge: $9.95 per billing cycle < 1,000 kWh
  // $0.00 per billing cycle ≥ 1,000 kWh
  //
  // We only need the non-zero fee and the kWh threshold.
  const m = t.match(
    /Usage\s+Charge:\s*\$?\s*([0-9]{1,5}(?:\.[0-9]{1,2})?)\s*[\s\S]{0,120}?(?:<|less\s+than)\s*([0-9]{1,5}(?:,[0-9]{3})?)\s*kWh/i,
  );
  if (!m?.[1] || !m?.[2]) return null;

  const feeDollars = safeNum(m[1]);
  const threshold = safeNum(String(m[2]).replace(/,/g, ""));
  if (feeDollars == null || feeDollars <= 0) return null;
  if (threshold == null || threshold <= 0) return null;

  // Sanity: this is a small monthly fee.
  const feeCents = dollarsToCents(feeDollars);
  if (feeCents <= 0 || feeCents > 50_000) return null;

  notes.push(`usage_charge_threshold:fee=$${feeDollars.toFixed(2)} if usage < ${Math.floor(threshold)} kWh`);

  return {
    ok: true,
    feeCents,
    thresholdKwhExclusive: Math.floor(threshold),
    notes,
  };
}


