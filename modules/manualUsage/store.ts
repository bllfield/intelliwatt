import { prisma } from "@/lib/db";
import { anchorEndDateUtc } from "@/modules/manualUsage/anchor";
import { normalizeStatementRanges } from "@/modules/manualUsage/statementRanges";
import { validateManualUsagePayload } from "@/modules/manualUsage/validation";
import type {
  AnnualManualUsagePayload,
  ManualUsagePayload,
  MonthlyManualUsagePayload,
  TravelRange,
} from "@/modules/simulatedUsage/types";

function clampInt(n: unknown, lo: number, hi: number): number {
  const x = typeof n === "number" && Number.isFinite(n) ? Math.trunc(n) : Number(n);
  const y = Number.isFinite(x) ? x : lo;
  return Math.max(lo, Math.min(hi, y));
}

function isIsoDate(s: unknown): s is string {
  return typeof s === "string" && /^\d{4}-\d{2}-\d{2}$/.test(s.trim());
}

function isYearMonth(s: unknown): s is string {
  return typeof s === "string" && /^\d{4}-\d{2}$/.test(s.trim());
}

function normalizeRanges(ranges: unknown): TravelRange[] {
  if (!Array.isArray(ranges)) return [];
  return ranges
    .map((r) => ({
      startDate: String((r as any)?.startDate ?? "").slice(0, 10),
      endDate: String((r as any)?.endDate ?? "").slice(0, 10),
    }))
    .filter((r) => isIsoDate(r.startDate) && isIsoDate(r.endDate));
}

export async function getManualUsageInputForUserHouse(args: {
  userId: string;
  houseId: string;
}): Promise<{ payload: ManualUsagePayload | null; updatedAt: string | null }> {
  const rec = await (prisma as any).manualUsageInput.findUnique({
    where: { userId_houseId: { userId: args.userId, houseId: args.houseId } },
    select: { payload: true, updatedAt: true },
  });
  return {
    payload: (rec?.payload as ManualUsagePayload | null) ?? null,
    updatedAt: rec?.updatedAt ? new Date(rec.updatedAt).toISOString() : null,
  };
}

export async function saveManualUsageInputForUserHouse(args: {
  userId: string;
  houseId: string;
  payload: ManualUsagePayload;
}): Promise<{ ok: true; updatedAt: string; payload: ManualUsagePayload } | { ok: false; error: string }> {
  const parsed = validateManualUsagePayload(args.payload);
  if (!parsed.ok) return parsed;

  const payload = parsed.value;
  const now = new Date();
  if (payload.mode === "MONTHLY") {
    const anchorEndDateKey = isIsoDate((payload as any).anchorEndDate)
      ? String((payload as any).anchorEndDate).trim()
      : null;
    const legacyEndMonth = isYearMonth((payload as any).anchorEndMonth)
      ? String((payload as any).anchorEndMonth).trim()
      : null;
    const legacyBillEndDay =
      typeof (payload as any).billEndDay !== "undefined" ? clampInt((payload as any).billEndDay, 1, 31) : null;

    if (!anchorEndDateKey && !legacyEndMonth) {
      return { ok: false, error: "anchorEndDate_invalid" };
    }

    let anchorEndMonth: string;
    let anchorEndDate: Date;
    if (anchorEndDateKey) {
      anchorEndMonth = anchorEndDateKey.slice(0, 7);
      anchorEndDate = new Date(`${anchorEndDateKey}T00:00:00.000Z`);
      if (!Number.isFinite(anchorEndDate.getTime())) return { ok: false, error: "anchorEndDate_invalid" };
    } else {
      anchorEndMonth = legacyEndMonth as string;
      const resolved = anchorEndDateUtc(anchorEndMonth, legacyBillEndDay ?? 15);
      if (!resolved) return { ok: false, error: "anchorEndMonth_invalid" };
      anchorEndDate = resolved;
    }

    const cleanedMonthly = (Array.isArray(payload.monthlyKwh) ? payload.monthlyKwh : []).slice(0, 12).map((row) => ({
      month: String((row as any)?.month ?? "").trim(),
      kwh:
        (row as any)?.kwh === ""
          ? ""
          : typeof (row as any)?.kwh === "number" && Number.isFinite((row as any)?.kwh)
            ? (row as any).kwh
            : "",
    }));
    const stored: MonthlyManualUsagePayload = {
      mode: "MONTHLY",
      anchorEndDate: (anchorEndDateKey ?? `${anchorEndMonth}-${String(anchorEndDate.getUTCDate()).padStart(2, "0")}`).slice(0, 10),
      monthlyKwh: cleanedMonthly,
      statementRanges: normalizeStatementRanges((payload as any).statementRanges),
      travelRanges: normalizeRanges(payload.travelRanges),
    };

    const rec = await (prisma as any).manualUsageInput.upsert({
      where: { userId_houseId: { userId: args.userId, houseId: args.houseId } },
      create: {
        userId: args.userId,
        houseId: args.houseId,
        mode: "MONTHLY",
        payload: stored,
        anchorEndMonth,
        anchorEndDate,
        annualEndDate: null,
      },
      update: {
        mode: "MONTHLY",
        payload: stored,
        anchorEndMonth,
        anchorEndDate,
        annualEndDate: null,
        updatedAt: now,
      },
      select: { updatedAt: true },
    });
    return { ok: true, updatedAt: new Date(rec.updatedAt).toISOString(), payload: stored };
  }

  const anchorEndDateKey = isIsoDate((payload as any).anchorEndDate)
    ? String((payload as any).anchorEndDate).trim()
    : isIsoDate((payload as any).endDate)
      ? String((payload as any).endDate).trim()
      : null;
  if (!anchorEndDateKey) return { ok: false, error: "anchorEndDate_invalid" };

  const annualEndDate = new Date(`${anchorEndDateKey}T00:00:00.000Z`);
  if (!Number.isFinite(annualEndDate.getTime())) return { ok: false, error: "anchorEndDate_invalid" };

  const annualKwh =
    typeof payload.annualKwh === "number" && Number.isFinite(payload.annualKwh) ? payload.annualKwh : null;
  if (annualKwh == null) return { ok: false, error: "annualKwh_required" };

  const stored: AnnualManualUsagePayload = {
    mode: "ANNUAL",
    anchorEndDate: anchorEndDateKey,
    annualKwh,
    travelRanges: normalizeRanges(payload.travelRanges),
  };
  const rec = await (prisma as any).manualUsageInput.upsert({
    where: { userId_houseId: { userId: args.userId, houseId: args.houseId } },
    create: {
      userId: args.userId,
      houseId: args.houseId,
      mode: "ANNUAL",
      payload: stored,
      anchorEndMonth: anchorEndDateKey.slice(0, 7),
      anchorEndDate: annualEndDate,
      annualEndDate,
    },
    update: {
      mode: "ANNUAL",
      payload: stored,
      anchorEndMonth: anchorEndDateKey.slice(0, 7),
      anchorEndDate: annualEndDate,
      annualEndDate,
      updatedAt: now,
    },
    select: { updatedAt: true },
  });

  return { ok: true, updatedAt: new Date(rec.updatedAt).toISOString(), payload: stored };
}
