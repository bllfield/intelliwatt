import type { ManualUsagePayload } from "@/modules/simulatedUsage/types";
import { isYearMonth } from "@/modules/manualUsage/anchor";

function isIsoDate(s: unknown): s is string {
  return typeof s === "string" && /^\d{4}-\d{2}-\d{2}$/.test(s.trim());
}

export function validateManualUsagePayload(payload: any): { ok: true; value: ManualUsagePayload } | { ok: false; error: string } {
  if (!payload || (payload as any).mode !== "MONTHLY" && (payload as any).mode !== "ANNUAL") {
    return { ok: false, error: "payload_required" };
  }
  if ((payload as any).mode === "MONTHLY") {
    const p = payload as any;
    if (!isYearMonth(String(p.anchorEndMonth ?? ""))) return { ok: false, error: "anchorEndMonth_invalid" };
    const rows = Array.isArray(p.monthlyKwh) ? p.monthlyKwh : [];
    const anyEntry = rows.some((r: any) => typeof r?.kwh === "number" && Number.isFinite(r.kwh) && r.kwh >= 0);
    if (!anyEntry) return { ok: false, error: "monthlyKwh_required" };
    return { ok: true, value: payload as ManualUsagePayload };
  }

  // ANNUAL
  const p = payload as any;
  if (!isIsoDate(p.endDate)) return { ok: false, error: "endDate_invalid" };
  if (!(typeof p.annualKwh === "number" && Number.isFinite(p.annualKwh) && p.annualKwh >= 0)) {
    return { ok: false, error: "annualKwh_required" };
  }
  return { ok: true, value: payload as ManualUsagePayload };
}

