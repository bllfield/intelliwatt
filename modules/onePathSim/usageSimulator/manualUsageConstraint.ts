/**
 * Infer manual usage constraint surface for resolver (plan §17 / §19).
 * Aligns with `manualMonthlyTotals` in build.ts (MONTHLY vs annual distribution).
 */

export function inferManualTotalsConstraintKind(payload: unknown): "monthly" | "annual" | null {
  if (!payload || typeof payload !== "object") return null;
  const p = payload as Record<string, unknown>;
  if (p.mode === "MONTHLY") return "monthly";
  if (p.mode === "ANNUAL") return "annual";
  if (Array.isArray(p.monthlyKwh) && (p.monthlyKwh as unknown[]).length > 0) return "monthly";
  if (typeof p.annualKwh === "number" && Number.isFinite(p.annualKwh)) return "annual";
  return null;
}

