import { cookies } from "next/headers";
import { NextRequest, NextResponse } from "next/server";

import { prisma } from "@/lib/db";
import { normalizeEmail } from "@/lib/utils/email";
import { getCurrentPlanPrisma } from "@/lib/prismaCurrentPlan";
import { deterministicEflExtract, extractProviderAndPlanNameFromEflText } from "@/lib/efl/eflExtractor";
import { runEflPipelineFromRawTextNoStore } from "@/lib/efl/runEflPipelineFromRawTextNoStore";
import { extractUsageChargeThresholdRule } from "@/lib/current-plan/factLabelUsageCharge";
import { usagePrisma } from "@/lib/db/usageClient";
import { getTdspDeliveryRates } from "@/lib/plan-engine/getTdspDeliveryRates";
import { estimateTrueCost } from "@/lib/plan-engine/estimateTrueCost";
import { ensureCurrentPlanEntry } from "@/lib/current-plan/ensureEntry";
import { validateEflAvgPriceTable } from "@/lib/efl/eflValidator";
import { requiredBucketsForRateStructure } from "@/lib/plan-engine/requiredBucketsForPlan";
import { derivePlanCalcRequirementsFromTemplate } from "@/lib/plan-engine/planComputability";
import { buildUsageBucketsForEstimate } from "@/lib/usage/buildUsageBucketsForEstimate";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
// EFL extraction can be slow (pdftotext service + fallbacks). Allow long-running serverless execution.
export const maxDuration = 300;

const MAX_UPLOAD_BYTES = 10 * 1024 * 1024; // 10 MB

function normalizeHhMm(v: any): string | null {
  const s = typeof v === "string" ? v.trim() : "";
  if (!s) return null;
  // Accept "h:mm AM/PM" (or "h AM/PM")
  {
    const m = s.match(/^(\d{1,2})(?::(\d{2}))?\s*(AM|PM)$/i);
    if (m?.[1]) {
      const hh12 = Number(m[1]);
      const mm = m[2] ? Number(m[2]) : 0;
      const ap = String(m[3] ?? "").toUpperCase();
      if (
        Number.isFinite(hh12) &&
        Number.isFinite(mm) &&
        hh12 >= 1 &&
        hh12 <= 12 &&
        mm >= 0 &&
        mm <= 59 &&
        (ap === "AM" || ap === "PM")
      ) {
        const hh24 = ap === "AM" ? (hh12 === 12 ? 0 : hh12) : (hh12 === 12 ? 12 : hh12 + 12);
        return `${String(hh24).padStart(2, "0")}:${String(mm).padStart(2, "0")}`;
      }
    }
  }
  // Accept "HH:MM"
  if (/^\d{1,2}:\d{2}$/.test(s)) {
    const [hhRaw, mmRaw] = s.split(":");
    const hh = Number(hhRaw);
    const mm = Number(mmRaw);
    // Allow 24:00 as an end-of-day marker (normalize later if needed).
    if (hh === 24 && mm === 0) return "24:00";
    if (!Number.isFinite(hh) || !Number.isFinite(mm) || hh < 0 || hh > 23 || mm < 0 || mm > 59) return null;
    return `${String(hh).padStart(2, "0")}:${String(mm).padStart(2, "0")}`;
  }
  // Accept "HHMM"
  if (/^\d{3,4}$/.test(s)) {
    const padded = s.padStart(4, "0");
    const hh = Number(padded.slice(0, 2));
    const mm = Number(padded.slice(2, 4));
    // Allow 2400 as an end-of-day marker (normalize later if needed).
    if (hh === 24 && mm === 0) return "24:00";
    if (!Number.isFinite(hh) || !Number.isFinite(mm) || hh < 0 || hh > 23 || mm < 0 || mm > 59) return null;
    return `${String(hh).padStart(2, "0")}:${String(mm).padStart(2, "0")}`;
  }
  return null;
}

function normalizeEndForAllDayWindow(startHhMm: string, endHhMm: string): string {
  // Heuristic: Some EFLs represent "all day" as 12:00 AM – 11:00 PM (instead of 11:59 PM).
  // If start is midnight and end is 23:00, treat it as end-of-day so we don't drop the last hour.
  if (startHhMm === "00:00" && endHhMm === "23:00") return "23:59";
  // Some EFLs express "all day" as 12:00 AM – 12:00 AM.
  // If start and end are both midnight, treat as end-of-day.
  if (startHhMm === "00:00" && endHhMm === "00:00") return "23:59";
  // Also tolerate "24:00" end-of-day marker (normalize to 23:59).
  if (startHhMm === "00:00" && endHhMm === "24:00") return "23:59";
  return endHhMm;
}

function hhmmToHour(v: string): number | null {
  const s = String(v ?? "").trim();
  if (!/^\d{2}:\d{2}$/.test(s)) return null;
  const [hhRaw, mmRaw] = s.split(":");
  const hh = Number(hhRaw);
  const mm = Number(mmRaw);
  if (!Number.isFinite(hh) || !Number.isFinite(mm) || hh < 0 || hh > 24 || mm < 0 || mm > 59) return null;
  // Treat end-of-day markers as 24.0 for plan rules.
  if (hh === 23 && mm === 59) return 24;
  if (hh === 24 && mm === 0) return 24;
  if (hh === 24 && mm !== 0) return null;
  return hh + mm / 60;
}

function toRateType(parsed: any): "FIXED" | "VARIABLE" | "TIME_OF_USE" {
  const tou = Array.isArray(parsed?.rate?.touWindowsJson) ? parsed.rate.touWindowsJson : [];
  if (tou.length > 0) return "TIME_OF_USE";
  if (parsed?.rate?.isVariable) return "VARIABLE";
  return "FIXED";
}

function extractCancelFeeCentsFromEflText(rawText: string): number | null {
  const t = String(rawText ?? "");
  if (!t.trim()) return null;

  const parseDollars = (s: string): number | null => {
    const m = s.match(/\$\s*([0-9]{1,5}(?:\.[0-9]{1,2})?)/);
    if (!m?.[1]) return null;
    const dollars = Number(m[1]);
    return Number.isFinite(dollars) && dollars >= 0 ? dollars : null;
  };

  // Common EFL phrasing:
  // "Do I have a termination fee... Yes. $150."
  // Allow a wide window because the "$150" is often on the next wrapped line.
  const m1 = t.match(/termination\s+fee[\s\S]{0,600}?\$\s*([0-9]{1,5}(?:\.[0-9]{1,2})?)/i);
  if (m1?.[1]) {
    const dollars = Number(m1[1]);
    if (Number.isFinite(dollars) && dollars >= 0) return Math.round(dollars * 100);
  }

  // Also handle the common layout where the "$150" appears on the line ABOVE the question block.
  const m1b = t.match(/\$\s*([0-9]{1,5}(?:\.[0-9]{1,2})?)[\s\S]{0,600}?termination\s+fee/i);
  if (m1b?.[1]) {
    const dollars = Number(m1b[1]);
    if (Number.isFinite(dollars) && dollars >= 0) return Math.round(dollars * 100);
  }

  // Line-based scan: find the "termination fee" question and look a few lines forward.
  const lines = t.split(/\r?\n/);
  const idx = lines.findIndex((l) => /termination\s+fee/i.test(l));
  if (idx >= 0) {
    // Search both before + after because many EFLs put "Yes. $150." on a line above the question.
    const start = Math.max(0, idx - 6);
    const end = Math.min(lines.length - 1, idx + 6);
    for (let i = start; i <= end; i++) {
      const dollars = parseDollars(lines[i] ?? "");
      if (dollars != null) return Math.round(dollars * 100);
    }
  }

  // Alternate: "cancellation fee $150"
  const m2 = t.match(/cancell(?:ation|ing)\s+fee[\s\S]{0,600}?\$\s*([0-9]{1,5}(?:\.[0-9]{1,2})?)/i);
  if (m2?.[1]) {
    const dollars = Number(m2[1]);
    if (Number.isFinite(dollars) && dollars >= 0) return Math.round(dollars * 100);
  }

  return null;
}

function extractEnergyChargeCentsPerKwhFromEflText(rawText: string): number | null {
  const t = String(rawText ?? "");
  if (!t.trim()) return null;

  // Common EFL phrasing:
  // "Energy Charge: 9.6136¢ per kWh"
  // "Energy Charge 22.99¢ ¢ per kWh" (table-style)
  const mCents = t.match(/Energy\s+Charge[\s\S]{0,80}?([0-9]{1,5}(?:\.[0-9]{1,6})?)\s*¢/i);
  if (mCents?.[1]) {
    const cents = Number(mCents[1]);
    if (Number.isFinite(cents) && cents >= 0) {
      if (cents > 500) return null;
      return cents;
    }
  }

  // Also support $/kWh formats (common on some EFLs):
  // "Energy Charge per kWh $0.1626"
  const mDollars = t.match(/Energy\s+Charge[\s\S]{0,80}?per\s+kWh[\s]*\$?\s*([0-9]{1,2}(?:\.[0-9]{1,6})?)/i);
  if (!mDollars?.[1]) return null;
  const dollars = Number(mDollars[1]);
  if (!Number.isFinite(dollars) || dollars < 0) return null;
  const cents = dollars * 100;
  // Sanity bounds: current-plan REP energy rates in TX are typically < 150 ¢/kWh
  if (cents > 500) return null;
  return cents;
}

function extractRepPuctCertificateFromEflText(text: string): string | null {
  const t = String(text ?? "");
  if (!t.trim()) return null;
  const m =
    t.match(
      /\b(?:PUCT\s*(?:Certificate\s*(?:No\.?|Number)?|Cert\.?|License)|REP\s*No\.)\s*[#:.\s]*([0-9]{4,6})\b/i,
    ) ?? t.match(/\bPUC\s*license\s*#\s*([0-9]{4,6})\b/i);
  return m?.[1] ?? null;
}

function extractEflVersionCodeFromEflText(text: string): string | null {
  const raw = String(text ?? "");
  if (!raw.trim()) return null;

  const lines = raw.split(/\r?\n/).map((l) => l.trim());
  const normalizeToken = (s: string): string =>
    s
      .replace(/\s+/g, " ")
      .replace(/[^\w+\-./]/g, " ")
      .replace(/\s+/g, " ")
      .trim();

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i] ?? "";
    if (!line) continue;

    const mInline =
      line.match(/\b(?:Version|Ver\.?)\s*#\s*:?\s*(.+)$/i) ?? line.match(/\bEFL\s*Ver\.?\s*#\s*:?\s*(.+)$/i);
    if (mInline?.[1]) {
      const token = normalizeToken(mInline[1]);
      if (token) return token;
    }

    const isHeaderOnly =
      /\b(?:Version|Ver\.?)\s*#\s*:?\s*$/i.test(line) || /\bEFL\s*Ver\.?\s*#\s*:?\s*$/i.test(line);
    if (isHeaderOnly) {
      const next = lines[i + 1] ?? "";
      const token = normalizeToken(next);
      if (token) return token;
    }
  }

  return null;
}

function lastNYearMonthsChicago(n: number): string[] {
  try {
    const tz = "America/Chicago";
    const fmt = new Intl.DateTimeFormat("en-US", { timeZone: tz, year: "numeric", month: "2-digit" });
    const parts = fmt.formatToParts(new Date());
    const get = (type: string) => parts.find((p) => p.type === type)?.value ?? "";
    const year0 = Number(get("year"));
    const month0 = Number(get("month"));
    if (!Number.isFinite(year0) || !Number.isFinite(month0) || month0 < 1 || month0 > 12) return [];

    const out: string[] = [];
    for (let i = 0; i < n; i++) {
      const idx = month0 - i;
      const y = idx >= 1 ? year0 : year0 - Math.ceil((1 - idx) / 12);
      const m0 = ((idx - 1) % 12 + 12) % 12 + 1;
      out.push(`${String(y)}-${String(m0).padStart(2, "0")}`);
    }
    return out;
  } catch {
    return [];
  }
}

export async function POST(req: NextRequest) {
  try {
    if (!process.env.CURRENT_PLAN_DATABASE_URL) {
      return NextResponse.json({ ok: false, error: "CURRENT_PLAN_DATABASE_URL is not configured" }, { status: 500 });
    }

    const cookieStore = cookies();
    const rawEmail = cookieStore.get("intelliwatt_user")?.value ?? null;
    if (!rawEmail) return NextResponse.json({ ok: false, error: "not_authenticated" }, { status: 401 });

    const userEmail = normalizeEmail(rawEmail);
    const user = await prisma.user.findUnique({
      where: { email: userEmail },
      select: { id: true },
    });
    if (!user) return NextResponse.json({ ok: false, error: "user_not_found" }, { status: 404 });

    const form = await req.formData();
    const houseIdRaw = form.get("houseId");
    let houseId =
      typeof houseIdRaw === "string" && houseIdRaw.trim().length > 0 ? houseIdRaw.trim() : null;

    if (houseId) {
      const ownsHouse = await prisma.houseAddress.findFirst({
        where: { id: houseId, userId: user.id },
        select: { id: true },
      });
      if (!ownsHouse) {
        return NextResponse.json({ ok: false, error: "houseId does not belong to the current user" }, { status: 403 });
      }
    } else {
      // Best-effort: attach to the user's primary (or most recent) house so
      // downstream screens can show TDSP variables and avoid "houseId=null"
      // fragments when users upload current plan EFLs before explicitly selecting a house.
      const bestHouse = await prisma.houseAddress.findFirst({
        where: { userId: user.id, archivedAt: null },
        orderBy: [{ isPrimary: "desc" }, { createdAt: "desc" }],
        select: { id: true },
      });
      houseId = bestHouse?.id ?? null;
    }

    const f = form.get("eflFile");
    if (!(f instanceof File)) {
      return NextResponse.json({ ok: false, error: "eflFile_required" }, { status: 400 });
    }

    const name = (f.name ?? "").toLowerCase();
    const type = (f.type ?? "").toLowerCase();
    const isPdf = type === "application/pdf" || name.endsWith(".pdf");
    if (!isPdf) {
      return NextResponse.json({ ok: false, error: "pdf_only" }, { status: 400 });
    }

    const ab = await f.arrayBuffer();
    if (!ab || ab.byteLength <= 0) {
      return NextResponse.json({ ok: false, error: "empty_file" }, { status: 400 });
    }
    if (ab.byteLength > MAX_UPLOAD_BYTES) {
      return NextResponse.json({ ok: false, error: "file_too_large" }, { status: 413 });
    }

    const pdfBytes = Buffer.from(ab);

    // Canonical PDF → text extraction (same pipeline used by EFL processing).
    const det = await deterministicEflExtract(pdfBytes);
    const rawText = det.rawText ?? "";
    if (!rawText.trim()) {
      return NextResponse.json(
        { ok: false, error: "efl_text_empty", warnings: det.warnings ?? [] },
        { status: 422 },
      );
    }

    const labels = extractProviderAndPlanNameFromEflText(rawText);
    const repPuctCertificateFromText = extractRepPuctCertificateFromEflText(rawText);
    const eflVersionCodeFromText = extractEflVersionCodeFromEflText(rawText);

    // Try to reuse an existing current-plan template before running the full EFL pipeline again.
    // We still do deterministic PDF->text extraction (required), but we can skip the AI pipeline
    // and avoid storing duplicate PDFs when a plan-level template already exists.
    const currentPlanPrisma = getCurrentPlanPrisma();
    const providerKey = String(labels.providerName ?? "").trim().toUpperCase();
    const planKey = String(labels.planName ?? "").trim().toUpperCase();
    const billPlanTemplateDelegate = (currentPlanPrisma as any).billPlanTemplate as any;
    const existingBillPlanTemplate =
      providerKey && planKey
        ? await billPlanTemplateDelegate
            .findUnique({
              where: { providerNameKey_planNameKey: { providerNameKey: providerKey, planNameKey: planKey } },
            })
            .catch(() => null)
        : null;

    const templateMatched = Boolean(existingBillPlanTemplate?.id);
    const templateId: string | null = existingBillPlanTemplate?.id ? String(existingBillPlanTemplate.id) : null;

    // IMPORTANT:
    // Some "discount period" EFLs (like Summer Break) require the full EFL engine to model the discount
    // and produce a computable RateStructure (month-scoped all-day TOU periods).
    // A cached BillPlanTemplate may not contain enough fields to reproduce this deterministically.
    const seasonalDiscountLike =
      /\bdiscount\s+off\s+the\s+Energy\s+Charge\b/i.test(rawText) ||
      /\bDiscount\s+Period\b/i.test(rawText) ||
      /\bfrom\s+(?:June|July|August|September|October|November|December|January|February|March|April|May)\b[\s\S]{0,60}\bthrough\s+(?:June|July|August|September|October|November|December|January|February|March|April|May)\b/i.test(rawText);

    const templateHasUsablePricing = (() => {
      if (!templateMatched) return false;
      const rt = String(existingBillPlanTemplate?.rateType ?? "").toUpperCase();
      if (rt === "TIME_OF_USE") {
        const tiers = Array.isArray(existingBillPlanTemplate?.timeOfUseConfigJson)
          ? existingBillPlanTemplate.timeOfUseConfigJson
          : [];
        return tiers.length > 0;
      }
      // Fixed/Variable: expect at least one energy tier AND a base charge.
      const energy = Array.isArray(existingBillPlanTemplate?.energyRateTiersJson)
        ? existingBillPlanTemplate.energyRateTiersJson
        : [];
      const hasEnergy = energy.length > 0;
      const base = existingBillPlanTemplate?.baseChargeCentsPerMonth;
      const hasBase = typeof base === "number" && Number.isFinite(base) && base >= 0;
      return hasEnergy && hasBase;
    })();

    const templateHasSeasonalPeriods = (() => {
      if (!templateMatched) return false;
      const rt = String(existingBillPlanTemplate?.rateType ?? "").toUpperCase();
      if (rt !== "TIME_OF_USE") return false;
      const tiers = Array.isArray(existingBillPlanTemplate?.timeOfUseConfigJson)
        ? (existingBillPlanTemplate.timeOfUseConfigJson as any[])
        : [];
      if (!tiers.length) return false;
      return tiers.some((t: any) => Array.isArray(t?.monthsOfYear) && t.monthsOfYear.length > 0);
    })();

    const shouldRunPipeline =
      !templateMatched || !templateHasUsablePricing || (seasonalDiscountLike && !templateHasSeasonalPeriods);

    // Use the same EFL engine as Fact Cards (AI parse → avg-price validator → gap solver) when needed.
    const pipeline = shouldRunPipeline
      ? await runEflPipelineFromRawTextNoStore({
          rawText,
          eflPdfSha256: det.eflPdfSha256,
          source: "manual",
          offerMeta: {
            supplier: labels.providerName ?? null,
            planName: labels.planName ?? null,
            termMonths: null,
            tdspName: null,
            offerId: null,
          },
        })
      : null;

    // Key distinction:
    // - templateMatched: we found a BillPlanTemplate by provider+plan
    // - templateUsed: we actually used it as the pricing source (i.e., we did NOT run the full pipeline)
    const templateUsed = templateMatched && !pipeline;

    const effectivePlanRules: any = pipeline ? (pipeline.effectivePlanRules ?? pipeline.planRules ?? null) : null;
    const effectiveRateStructure: any = pipeline ? (pipeline.effectiveRateStructure ?? pipeline.rateStructure ?? null) : null;

    const cancelFeeCentsDerived =
      typeof effectivePlanRules?.cancelFeeCents === "number" && Number.isFinite(effectivePlanRules.cancelFeeCents)
        ? Math.round(effectivePlanRules.cancelFeeCents)
        : extractCancelFeeCentsFromEflText(rawText);

    const parsed = {
      rate: {
        supplierName: labels.providerName ?? null,
        planName: labels.planName ?? null,
        termMonths: (() => {
          if (typeof effectivePlanRules?.termMonths === "number") return effectivePlanRules.termMonths;
          if (templateMatched && typeof existingBillPlanTemplate?.termMonths === "number") return existingBillPlanTemplate.termMonths;
          return null;
        })(),
        baseMonthlyFeeCents:
          typeof effectivePlanRules?.baseChargePerMonthCents === "number"
            ? Math.round(effectivePlanRules.baseChargePerMonthCents)
            : typeof effectiveRateStructure?.baseMonthlyFeeCents === "number"
              ? Math.round(effectiveRateStructure.baseMonthlyFeeCents)
              : templateMatched && typeof existingBillPlanTemplate?.baseChargeCentsPerMonth === "number"
                ? Math.round(existingBillPlanTemplate.baseChargeCentsPerMonth)
              : null,
        cancelFeeCents: cancelFeeCentsDerived,
      },
      meta: {
        warnings: (pipeline as any)?.parseWarnings ?? [],
        notes: [],
      },
    } as any;

    const rateType: "FIXED" | "VARIABLE" | "TIME_OF_USE" = (() => {
      if (templateUsed) {
        const rt = String(existingBillPlanTemplate?.rateType ?? "").toUpperCase();
        if (rt === "TIME_OF_USE") return "TIME_OF_USE";
        if (rt === "VARIABLE") return "VARIABLE";
        return "FIXED";
      }
      const rt = String(effectivePlanRules?.rateType ?? effectiveRateStructure?.type ?? "").toUpperCase();
      if (rt === "TIME_OF_USE") return "TIME_OF_USE";
      if (rt === "VARIABLE") return "VARIABLE";
      return "FIXED";
    })();

    const flatEnergyRateCents: number | null =
      templateUsed && !pipeline
        ? extractEnergyChargeCentsPerKwhFromEflText(rawText)
        : typeof effectiveRateStructure?.energyRateCents === "number" && Number.isFinite(effectiveRateStructure.energyRateCents)
          ? Number(effectiveRateStructure.energyRateCents)
          : typeof effectivePlanRules?.defaultRateCentsPerKwh === "number" && Number.isFinite(effectivePlanRules.defaultRateCentsPerKwh)
            ? Number(effectivePlanRules.defaultRateCentsPerKwh)
            : typeof effectivePlanRules?.currentBillEnergyRateCents === "number" && Number.isFinite(effectivePlanRules.currentBillEnergyRateCents)
              ? Number(effectivePlanRules.currentBillEnergyRateCents)
              : null;

    const billCredits = (() => {
      if (templateUsed) {
        const raw = existingBillPlanTemplate?.billCreditsJson;
        const arr = Array.isArray(raw) ? raw : [];
        return arr
          .map((r: any) => ({
            label: typeof r?.label === "string" ? r.label : "Bill credit",
            creditCents: typeof r?.creditCents === "number" && Number.isFinite(r.creditCents) ? Math.round(r.creditCents) : null,
            thresholdKwh: typeof r?.thresholdKwh === "number" && Number.isFinite(r.thresholdKwh) ? Math.round(r.thresholdKwh) : null,
          }))
          .filter(
            (x: any) =>
              typeof x.creditCents === "number" &&
              x.creditCents > 0 &&
              typeof x.thresholdKwh === "number" &&
              x.thresholdKwh > 0,
          );
      }
      const rsCredits = (effectiveRateStructure as any)?.billCredits;
      const rules = rsCredits && Array.isArray(rsCredits.rules) ? rsCredits.rules : [];
      return rules
        .map((r: any) => ({
          label: typeof r?.label === "string" ? r.label : "Bill credit",
          creditCents:
            typeof r?.creditAmountCents === "number" && Number.isFinite(r.creditAmountCents) ? Math.round(r.creditAmountCents) : null,
          thresholdKwh:
            typeof r?.minUsageKWh === "number" && Number.isFinite(r.minUsageKWh) ? Math.round(r.minUsageKWh) : null,
        }))
        .filter((x: any) => typeof x.creditCents === "number" && x.creditCents > 0 && typeof x.thresholdKwh === "number" && x.thresholdKwh > 0);
    })();

    const touWindows = (() => {
      if (templateUsed) {
        const tiers = Array.isArray(existingBillPlanTemplate?.timeOfUseConfigJson)
          ? existingBillPlanTemplate.timeOfUseConfigJson
          : [];
        return tiers
          .map((t: any) => ({
            label: typeof t?.label === "string" ? t.label : null,
            start: typeof t?.start === "string" ? t.start : null,
            end: typeof t?.end === "string" ? t.end : null,
            cents: typeof t?.cents === "number" ? t.cents : null,
            monthsOfYear: Array.isArray(t?.monthsOfYear) ? t.monthsOfYear : null,
          }))
          .filter((x: any) => x.start && x.end && typeof x.cents === "number");
      }
      const tiers = Array.isArray((effectiveRateStructure as any)?.tiers) ? (effectiveRateStructure as any).tiers : [];
      return tiers
        .map((t: any) => ({
          label: typeof t?.label === "string" ? t.label : null,
          start: typeof t?.startTime === "string" ? t.startTime : null,
          end: typeof t?.endTime === "string" ? t.endTime : null,
          cents: typeof t?.priceCents === "number" ? t.priceCents : null,
          monthsOfYear:
            Array.isArray(t?.monthsOfYear) ? t.monthsOfYear
              : Array.isArray(t?.months) ? t.months
              : null,
        }))
        .filter((x: any) => x.start && x.end && typeof x.cents === "number");
    })();

    // Normalize TOU time strings to HH:MM so saving doesn't fail validation later.
    const touWindowsNormalized = touWindows
      .map((t: any) => {
        const start = normalizeHhMm(t?.start);
        const endRaw = normalizeHhMm(t?.end);
        const cents = typeof t?.cents === "number" && Number.isFinite(t.cents) ? t.cents : null;
        if (!start || !endRaw || cents == null) return null;
        const end = normalizeEndForAllDayWindow(start, endRaw);
        // Preserve seasonal month scoping when present.
        const monthsRaw = Array.isArray(t?.monthsOfYear) ? t.monthsOfYear : null;
        const monthsOfYear = monthsRaw
          ? monthsRaw
              .map((m: any) => Number(m))
              .filter((m: number) => Number.isFinite(m) && m >= 1 && m <= 12)
          : null;
        return { ...t, start, end, cents, monthsOfYear: monthsOfYear && monthsOfYear.length ? monthsOfYear : null };
      })
      .filter(Boolean) as any[];

    // Persist in current-plan module DB so it shows up in /api/current-plan/init and can be reviewed later.
    // If we already have a plan-level BillPlanTemplate for this provider+plan, avoid storing duplicate PDFs.
    const uploadRowId: string | null = templateUsed
      ? null
      : (
          await (currentPlanPrisma as any).currentPlanBillUpload.create({
            data: {
              userId: user.id,
              houseId,
              filename: `EFL:${String(f.name ?? "efl.pdf").slice(0, 240)}`,
              mimeType: "application/pdf",
              sizeBytes: pdfBytes.length,
              billData: pdfBytes,
            },
            select: { id: true },
          })
        )?.id ?? null;

    // Build a CurrentPlan-style rateStructure for transparency + later calculations.
    // (Matches the shape validated by /api/current-plan/manual.)
    const rateStructure: any = (() => {
      const tdspDeliveryIncludedInEnergyCharge =
        effectivePlanRules?.tdspDeliveryIncludedInEnergyCharge === true ||
        effectiveRateStructure?.tdspDeliveryIncludedInEnergyCharge === true
          ? true
          : undefined;

      const baseMonthlyFeeCents =
        typeof parsed?.rate?.baseMonthlyFeeCents === "number" && Number.isFinite(parsed.rate.baseMonthlyFeeCents)
          ? Math.round(parsed.rate.baseMonthlyFeeCents)
          : null;

      const credits = Array.isArray(billCredits) ? billCredits : [];
      const billCreditsObj =
        credits.length > 0
          ? {
              hasBillCredit: true,
              rules: credits
                .map((c: any) => ({
                  label: typeof c?.label === "string" ? c.label : "Bill credit",
                  creditAmountCents:
                    typeof c?.creditCents === "number" && Number.isFinite(c.creditCents) ? Math.round(c.creditCents) : 0,
                  minUsageKWh:
                    typeof c?.thresholdKwh === "number" && Number.isFinite(c.thresholdKwh) ? Math.round(c.thresholdKwh) : 0,
                  maxUsageKWh: null,
                  monthsOfYear: null,
                }))
                .filter((x: any) => x.creditAmountCents > 0 && x.minUsageKWh > 0),
            }
          : { hasBillCredit: false, rules: [] };

      // Current-plan FACT LABEL fix:
      // Many EFLs have a "Usage Charge: $X per billing cycle < N kWh; $0 otherwise" line.
      // This is NOT a flat base fee; it's a minimum-usage fee. Encode it in the engine's supported minimum-rule format:
      // a negative bill-credit rule with label "Minimum Usage Fee" (engine interprets it as a fee when usage < threshold).
      const usageChargeRule = extractUsageChargeThresholdRule(rawText);
      const billCreditsWithMinFee = (() => {
        if (!usageChargeRule?.ok) return billCreditsObj;
        const next = {
          hasBillCredit: true,
          rules: Array.isArray(billCreditsObj?.rules) ? [...(billCreditsObj.rules as any[])] : [],
        };
        next.rules.push({
          label: "Minimum Usage Fee",
          creditAmountCents: -Math.abs(Math.round(usageChargeRule.feeCents)),
          minUsageKWh: Math.round(usageChargeRule.thresholdKwhExclusive),
          maxUsageKWh: null,
          monthsOfYear: null,
        });
        return next;
      })();

      // If the document explicitly lists a Base Charge / Base Monthly Charge, do NOT auto-null it even if
      // it happens to match the usage-charge fee amount. (Some EFLs can contain both.)
      const hasExplicitBaseCharge =
        /\bBase\s+(?:Monthly\s+)?Charge\b/i.test(rawText) ||
        /\bBase\s+Charge\b/i.test(rawText) ||
        /\bMonthly\s+Base\s+Charge\b/i.test(rawText);

      const effectiveBaseMonthlyFeeCents =
        usageChargeRule?.ok &&
        !hasExplicitBaseCharge &&
        baseMonthlyFeeCents != null &&
        Math.abs(baseMonthlyFeeCents - usageChargeRule.feeCents) <= 1
          ? null
          : baseMonthlyFeeCents;

      if (rateType === "TIME_OF_USE") {
        const tiers = (touWindowsNormalized.length ? touWindowsNormalized : touWindows)
          .map((t: any, idx: number) => {
            const start = normalizeHhMm(t?.start);
            const endRaw = normalizeHhMm(t?.end);
            const cents = typeof t?.cents === "number" && Number.isFinite(t.cents) ? t.cents : null;
            if (!start || !endRaw || cents == null) return null;
            const end = normalizeEndForAllDayWindow(start, endRaw);
            return {
              label: typeof t?.label === "string" && t.label.trim() ? t.label.trim() : `Period ${idx + 1}`,
              priceCents: Number(cents.toFixed(4)),
              startTime: start,
              endTime: end,
              daysOfWeek: "ALL",
              ...(Array.isArray(t?.monthsOfYear) && t.monthsOfYear.length ? { monthsOfYear: t.monthsOfYear } : {}),
            };
          })
          .filter(Boolean);

        return {
          type: "TIME_OF_USE",
          ...(effectiveBaseMonthlyFeeCents != null && effectiveBaseMonthlyFeeCents >= 0 ? { baseMonthlyFeeCents: effectiveBaseMonthlyFeeCents } : {}),
          tiers,
          billCredits: billCreditsWithMinFee,
          ...(tdspDeliveryIncludedInEnergyCharge ? { tdspDeliveryIncludedInEnergyCharge: true } : {}),
        };
      }

      if (rateType === "VARIABLE") {
        return {
          type: "VARIABLE",
          currentBillEnergyRateCents: flatEnergyRateCents != null ? Number(flatEnergyRateCents.toFixed(4)) : null,
          ...(effectiveBaseMonthlyFeeCents != null && effectiveBaseMonthlyFeeCents >= 0 ? { baseMonthlyFeeCents: effectiveBaseMonthlyFeeCents } : {}),
          billCredits: billCreditsWithMinFee,
          ...(tdspDeliveryIncludedInEnergyCharge ? { tdspDeliveryIncludedInEnergyCharge: true } : {}),
        };
      }

      return {
        type: "FIXED",
        ...(flatEnergyRateCents != null ? { energyRateCents: Number(flatEnergyRateCents.toFixed(4)) } : {}),
        ...(effectiveBaseMonthlyFeeCents != null && effectiveBaseMonthlyFeeCents >= 0 ? { baseMonthlyFeeCents: effectiveBaseMonthlyFeeCents } : {}),
        billCredits: billCreditsWithMinFee,
        ...(tdspDeliveryIncludedInEnergyCharge ? { tdspDeliveryIncludedInEnergyCharge: true } : {}),
        ...(templateUsed && providerKey && planKey ? { templateRef: { templateId, providerNameKey: providerKey, planNameKey: planKey } } : {}),
      };
    })();

    const parsedDelegate = (currentPlanPrisma as any).parsedCurrentPlan as any;
    const existing = await parsedDelegate.findFirst({
      where: { userId: user.id, houseId },
      orderBy: { createdAt: "desc" },
      select: { id: true },
    });

    const entryData = {
      userId: user.id,
      houseId,
      uploadId: uploadRowId,
      rawText: rawText.slice(0, 250_000),
      rawTextSnippet: rawText.slice(0, 5000),
      providerName: labels.providerName ?? parsed?.rate?.supplierName ?? null,
      planName: labels.planName ?? parsed?.rate?.planName ?? null,
      rateType,
      termMonths: typeof parsed?.rate?.termMonths === "number" ? parsed.rate.termMonths : null,
      termLengthMonths: typeof parsed?.rate?.termMonths === "number" ? parsed.rate.termMonths : null,
      earlyTerminationFeeCents:
        typeof parsed?.rate?.cancelFeeCents === "number" && Number.isFinite(parsed.rate.cancelFeeCents)
          ? Math.round(parsed.rate.cancelFeeCents)
          : null,
      earlyTerminationFee:
        typeof parsed?.rate?.cancelFeeCents === "number" && Number.isFinite(parsed.rate.cancelFeeCents)
          ? parsed.rate.cancelFeeCents / 100
          : null,
      energyRateTiersJson:
        rateType !== "TIME_OF_USE" && typeof flatEnergyRateCents === "number" && Number.isFinite(flatEnergyRateCents)
          ? [
              {
                label: "Energy",
                minKWh: 0,
                maxKWh: null,
                rateCentsPerKwh: Number(flatEnergyRateCents.toFixed(4)),
              },
            ]
          : null,
      timeOfUseConfigJson: touWindowsNormalized.length ? touWindowsNormalized : touWindows,
      billCreditsJson: billCredits,
      rateStructure,
      parserVersion: "current-plan-efl-v1",
      confidenceScore: null,
    };

    const record =
      existing
        ? await parsedDelegate.update({ where: { id: existing.id }, data: entryData })
        : await parsedDelegate.create({ data: entryData });

    // Persist a cross-bill "plan template" for current plans (current-plan module DB).
    // This is the canonical "current plan template" analogue to offer RatePlan templates:
    // it stores the plan-level structure so future bills/users can reuse it without re-parsing.
    try {
      const baseChargeCentsPerMonth =
        typeof (parsed as any)?.rate?.baseMonthlyFeeCents === "number" &&
        Number.isFinite((parsed as any).rate.baseMonthlyFeeCents)
          ? Math.round((parsed as any).rate.baseMonthlyFeeCents)
          : null;

      const providerKey = String(entryData.providerName ?? "").trim().toUpperCase();
      const planKey = String(entryData.planName ?? "").trim().toUpperCase();
      const finalStatus = String(((pipeline as any)?.finalValidation?.status ?? "") as any).toUpperCase();
      const calcReq = derivePlanCalcRequirementsFromTemplate({ rateStructure });
      const canPromoteTemplate = Boolean(pipeline) && finalStatus === "PASS" && calcReq.planCalcStatus === "COMPUTABLE";

      if (providerKey && planKey && canPromoteTemplate) {
        const billPlanTemplateDelegate = (currentPlanPrisma as any).billPlanTemplate as any;
        await billPlanTemplateDelegate.upsert({
          where: { providerNameKey_planNameKey: { providerNameKey: providerKey, planNameKey: planKey } },
          create: {
            providerNameKey: providerKey,
            planNameKey: planKey,
            providerName: entryData.providerName,
            planName: entryData.planName,
            rateType: rateType,
            variableIndexType: null,
            termMonths: entryData.termMonths ?? null,
            contractEndDate: null,
            earlyTerminationFeeCents: entryData.earlyTerminationFeeCents ?? null,
            baseChargeCentsPerMonth,
            energyRateTiersJson: entryData.energyRateTiersJson ?? null,
            timeOfUseConfigJson: entryData.timeOfUseConfigJson ?? null,
            billCreditsJson: entryData.billCreditsJson ?? null,
          },
          update: {
            providerName: entryData.providerName,
            planName: entryData.planName,
            rateType: rateType,
            termMonths: entryData.termMonths ?? null,
            earlyTerminationFeeCents: entryData.earlyTerminationFeeCents ?? null,
            baseChargeCentsPerMonth,
            energyRateTiersJson: entryData.energyRateTiersJson ?? null,
            timeOfUseConfigJson: entryData.timeOfUseConfigJson ?? null,
            billCreditsJson: entryData.billCreditsJson ?? null,
          },
        });
      }
    } catch (e) {
      console.error("[current-plan/efl-parse] Failed to upsert BillPlanTemplate", e);
      // best-effort only
    }

    // Also upsert into CurrentPlanManualEntry so the customer-facing current-plan flow sees it immediately.
    try {
      const manualDelegate = (currentPlanPrisma as any).currentPlanManualEntry as any;
      const existingManual = await manualDelegate.findFirst({
        where: { userId: user.id, ...(houseId ? { houseId } : {}) },
        orderBy: { updatedAt: "desc" },
        select: { id: true },
      });

      const manualData = {
        userId: user.id,
        houseId,
        providerName: entryData.providerName ?? "Unknown provider",
        planName: entryData.planName ?? "Unknown plan",
        rateType: rateType,
        energyRateCents: flatEnergyRateCents != null ? flatEnergyRateCents : null,
        // Do NOT store the usage-charge threshold as a flat base fee; the engine encodes it as a minimum rule in rateStructure.
        baseMonthlyFee: null,
        billCreditDollars: null,
        termLengthMonths: entryData.termLengthMonths ?? null,
        contractEndDate: null,
        earlyTerminationFee: typeof entryData.earlyTerminationFee === "number" ? entryData.earlyTerminationFee : null,
        esiId: null,
        accountNumberLast4: null,
        notes: "Imported from current plan EFL (fact label).",
        rateStructure,
        normalizedAt: new Date(),
        lastConfirmedAt: null,
      };

      if (existingManual?.id) {
        await manualDelegate.update({ where: { id: existingManual.id }, data: manualData });
      } else {
        await manualDelegate.create({ data: manualData });
      }

      await ensureCurrentPlanEntry(user.id, houseId);
    } catch {
      // Best-effort only; never block customer flow.
    }

    // Compute and store (homeId-scoped) current-plan estimate totals for transparency and compare UX.
    // This is NOT an offers template; it is only for the current home.
    let currentPlanEstimate: any | null = null;
    try {
      if (houseId) {
        const house = await prisma.houseAddress.findUnique({
          where: { id: houseId } as any,
          select: { id: true, tdspSlug: true, esiid: true },
        });
        const tdspSlug = String((house as any)?.tdspSlug ?? "").trim().toLowerCase() || null;
        const esiid = String((house as any)?.esiid ?? "").trim() || null;
        if (tdspSlug) {
          const requiredKeys = requiredBucketsForRateStructure({ rateStructure }).map((b) => b.key);

          // This call checks bucket coverage and triggers computation only when missing.
          // (Implemented in buildUsageBucketsForEstimate so it also applies to offer estimate endpoints.)
          const now = new Date();
          const cutoff = new Date(now.getTime() - 365 * 24 * 60 * 60 * 1000);
          const bucketBuild = await buildUsageBucketsForEstimate({
            homeId: houseId,
            usageSource: "SMT",
            esiid,
            windowEnd: now,
            cutoff,
            requiredBucketKeys: requiredKeys,
            monthsCount: 12,
          });

          const annualKwh = bucketBuild.annualKwh;
          if (annualKwh != null && annualKwh > 0) {
            const tdspRates = await getTdspDeliveryRates({ tdspSlug, asOf: new Date() }).catch(() => null);
            if (tdspRates) {
              currentPlanEstimate = estimateTrueCost({
                annualKwh,
                monthsCount: 12,
                rateStructure,
                usageBucketsByMonth: bucketBuild.usageBucketsByMonth,
                tdspRates: {
                  perKwhDeliveryChargeCents: Number(tdspRates.perKwhDeliveryChargeCents ?? 0) || 0,
                  monthlyCustomerChargeDollars: Number(tdspRates.monthlyCustomerChargeDollars ?? 0) || 0,
                  effectiveDate: tdspRates.effectiveDate ?? null,
                },
              });
            }
          }
        }
      }
    } catch {
      currentPlanEstimate = null;
    }

    // Quarantine into the shared EFL review queue when parsing is incomplete/unsupported.
    // Note: deterministicEflExtract() may emit "missing" warnings even when we can extract the values
    // from the raw text reliably. Filter those to avoid confusing user-facing messaging.
    const detWarningsRaw: string[] = (((det.warnings ?? []) as any[]) ?? []).map((x) => String(x)).filter(Boolean);
    const detWarnings = detWarningsRaw.filter((w) => {
      const s = String(w ?? "");
      if (/Missing\s+REP\s+PUCT\s+Certificate/i.test(s)) return !repPuctCertificateFromText;
      if (/Missing\s+EFL\s+Ver/i.test(s) || /Missing\s+EFL\s+Ver\.\s*#/i.test(s) || /Missing\s+EFL\s+Ver\s*#/i.test(s)) {
        return !eflVersionCodeFromText;
      }
      return true;
    });

    const warnings: string[] = [
      ...detWarnings,
      ...(templateUsed ? ["Template reused: BillPlanTemplate matched by provider+plan; skipped full EFL pipeline."] : []),
      ...(templateMatched && !templateUsed ? ["Template matched, but full EFL pipeline ran (template missing required seasonal/price fields)."] : []),
      ...(((pipeline?.parseWarnings ?? []) as any[]) ?? []).map((x) => String(x)),
    ].filter(Boolean);

    const reasonParts: string[] = [];
    if (!entryData.providerName) reasonParts.push("missing_provider");
    if (!entryData.planName) reasonParts.push("missing_plan_name");
    if (rateType !== "TIME_OF_USE" && flatEnergyRateCents == null) reasonParts.push("missing_flat_energy_rate");
    if (rateType === "TIME_OF_USE" && (!Array.isArray((rateStructure as any)?.tiers) || (rateStructure as any).tiers.length === 0)) {
      reasonParts.push("missing_tou_tiers");
    }

    // When we skipped the full pipeline, still run avg-table validation deterministically so the queue
    // can auto-resolve when the EFL is accurate.
    const validationForQueue = templateUsed
      ? await (async () => {
          try {
            // IMPORTANT:
            // The validator uses PlanRules (EFL CDM) and the plan cost engine.
            // For TOU-like current-plan templates, we must pass `timeOfUsePeriods` (not just RateStructure tiers),
            // otherwise the engine can fail and validation status becomes missing/FAIL even when the plan is
            // clearly computable (as seen in the admin fact-card pipeline).
            const baseCents =
              typeof (rateStructure as any)?.baseMonthlyFeeCents === "number"
                ? Math.round((rateStructure as any).baseMonthlyFeeCents)
                : typeof (parsed as any)?.rate?.baseMonthlyFeeCents === "number"
                  ? Math.round((parsed as any).rate.baseMonthlyFeeCents)
                  : null;

            const pr: any =
              rateType === "TIME_OF_USE"
                ? {
                    planType: "tou",
                    rateType,
                    termMonths: typeof entryData.termMonths === "number" ? entryData.termMonths : null,
                    defaultRateCentsPerKwh: null,
                    baseChargePerMonthCents: baseCents,
                    solarBuyback: null,
                    billCredits: [],
                    timeOfUsePeriods: (touWindowsNormalized.length ? touWindowsNormalized : touWindows)
                      .map((t: any) => {
                        const start = typeof t?.start === "string" ? t.start : null;
                        const end = typeof t?.end === "string" ? t.end : null;
                        const startHour = start ? hhmmToHour(start) : null;
                        const endHour = end ? hhmmToHour(end) : null;
                        const months = Array.isArray(t?.monthsOfYear) ? t.monthsOfYear : undefined;
                        const cents = typeof t?.cents === "number" && Number.isFinite(t.cents) ? t.cents : null;
                        if (startHour == null || endHour == null || cents == null) return null;
                        return {
                          label: typeof t?.label === "string" && t.label.trim() ? t.label.trim() : "Time-of-use",
                          startHour,
                          endHour,
                          daysOfWeek: [0, 1, 2, 3, 4, 5, 6],
                          ...(months && months.length ? { months } : {}),
                          rateCentsPerKwh: cents,
                          isFree: false,
                        };
                      })
                      .filter(Boolean),
                  }
                : {
                    rateType,
                    planType: "flat",
                    termMonths: typeof entryData.termMonths === "number" ? entryData.termMonths : null,
                    ...(typeof flatEnergyRateCents === "number" ? { defaultRateCentsPerKwh: flatEnergyRateCents } : {}),
                    ...(typeof baseCents === "number" ? { baseChargePerMonthCents: baseCents } : {}),
                    solarBuyback: null,
                    billCredits: [],
                    timeOfUsePeriods: [],
                  };
            return await validateEflAvgPriceTable({ rawText, planRules: pr, rateStructure });
          } catch {
            return null;
          }
        })()
      : ((pipeline as any)?.finalValidation ?? null);

    const finalValidationStatus = String(validationForQueue?.status ?? "").toUpperCase();
    // Conservative:
    // - Only explicit PASS* counts as a pass (PASS, PASS_WITH_ASSUMPTIONS, etc.)
    // - Missing/empty status is treated as not-passing so we don't incorrectly auto-pass unknown validations
    const validationPass = Boolean(finalValidationStatus) && finalValidationStatus.startsWith("PASS");
    // For current plan templates: warnings are common and should not automatically quarantine.
    // We quarantine only when:
    // - Identity/required pricing fields are missing, OR
    // - Avg-table validation explicitly FAILs (manual review needed), OR
    // - Plan is not computable.
    const planCalcReq = derivePlanCalcRequirementsFromTemplate({ rateStructure });
    const planCalcStatus = planCalcReq.planCalcStatus;
    if (!validationPass) reasonParts.push(`validation_${finalValidationStatus || "MISSING"}`);
    if (planCalcStatus && planCalcStatus !== "COMPUTABLE") reasonParts.push(`planCalc_${planCalcReq.planCalcReasonCode}`);

    const needsReview = reasonParts.length > 0;
    if (needsReview) {
      const queueReasonFromValidation = typeof validationForQueue?.queueReason === "string" ? validationForQueue.queueReason : null;
      const queueReason = `CURRENT_PLAN_EFL: ${reasonParts.join(", ")}`
        + (queueReasonFromValidation ? `\nvalidation: ${queueReasonFromValidation}` : "")
        + (warnings.length ? `\nwarnings: ${warnings.join(" | ")}` : "");
      try {
        await (prisma as any).eflParseReviewQueue.upsert({
          where: { eflPdfSha256: det.eflPdfSha256 },
          create: {
            source: "current_plan_efl",
            kind: "EFL_PARSE",
            dedupeKey: `current_plan:${det.eflPdfSha256}`,
            eflPdfSha256: det.eflPdfSha256,
            repPuctCertificate: repPuctCertificateFromText ?? (pipeline as any)?.deterministic?.repPuctCertificate ?? null,
            eflVersionCode: eflVersionCodeFromText ?? (pipeline as any)?.deterministic?.eflVersionCode ?? null,
            offerId: null,
            supplier: entryData.providerName,
            planName: entryData.planName,
            eflUrl: null,
            tdspName: null,
            termMonths: entryData.termMonths,
            rawText: rawText.slice(0, 250_000),
            planRules: pipeline?.effectivePlanRules ?? pipeline?.planRules ?? null,
            rateStructure: pipeline?.effectiveRateStructure ?? pipeline?.rateStructure ?? rateStructure ?? null,
            validation: pipeline?.validation ?? null,
            derivedForValidation: {
              ...(pipeline?.derivedForValidation ?? {}),
              userEmail,
            },
            finalStatus: validationPass ? "PASS" : (finalValidationStatus || "FAIL"),
            queueReason,
            solverApplied: (pipeline as any)?.derivedForValidation?.solverApplied ?? null,
          },
          update: {
            updatedAt: new Date(),
            source: "current_plan_efl",
            kind: "EFL_PARSE",
            dedupeKey: `current_plan:${det.eflPdfSha256}`,
            supplier: entryData.providerName,
            planName: entryData.planName,
            termMonths: entryData.termMonths,
            rawText: rawText.slice(0, 250_000),
            planRules: pipeline?.effectivePlanRules ?? pipeline?.planRules ?? null,
            rateStructure: pipeline?.effectiveRateStructure ?? pipeline?.rateStructure ?? rateStructure ?? null,
            validation: pipeline?.validation ?? null,
            derivedForValidation: {
              ...(pipeline?.derivedForValidation ?? {}),
              userEmail,
            },
            finalStatus: validationPass ? "PASS" : (finalValidationStatus || "FAIL"),
            queueReason,
            resolvedAt: null,
            resolvedBy: null,
            resolutionNotes: null,
          },
        });
      } catch {
        // Best-effort only; never break the customer flow.
      }
    }

    const customerMessage = needsReview
      ? "We uploaded your EFL, but we couldn't confidently calculate your current plan automatically. You'll still see the best available plans, but we can't show a savings comparison until you enter your current plan details manually below."
      : "EFL parsed successfully.";

    return NextResponse.json(
      {
        ok: true,
        extractedFrom: "EFL_PDF",
        eflPdfSha256: det.eflPdfSha256,
        extractorMethod: (det as any)?.extractorMethod ?? null,
        templateMatched,
        templateUsed,
        templateId,
        templateKey: templateMatched && providerKey && planKey ? `${providerKey}::${planKey}` : null,
        warnings,
        parsedWarnings: ((pipeline?.parseWarnings ?? []) as any[]) as string[],
        notes: ((pipeline as any)?.parseWarnings ?? []) as string[],
        rawTextPreview: rawText.slice(0, 5000),
        savedParsedCurrentPlanId: record?.id ?? null,
        queuedForReview: needsReview,
        canComputeFromEfl: !needsReview,
        customerMessage,
        currentPlanEstimate,
        prefill: {
          providerName: labels.providerName ?? null,
          planName: labels.planName ?? null,
          rateType,
          termLengthMonths: typeof (parsed as any)?.rate?.termMonths === "number" ? (parsed as any).rate.termMonths : null,
          energyRateCentsPerKwh: flatEnergyRateCents,
          baseMonthlyFeeDollars:
            typeof (parsed as any)?.rate?.baseMonthlyFeeCents === "number" ? (parsed as any).rate.baseMonthlyFeeCents / 100 : null,
          earlyTerminationFeeDollars:
            typeof (parsed as any)?.rate?.cancelFeeCents === "number" ? (parsed as any).rate.cancelFeeCents / 100 : null,
          avgPricesCentsPerKwh: {
            kwh500: null,
            kwh1000: null,
            kwh2000: null,
          },
          billCredits,
          touWindows: touWindowsNormalized.length ? touWindowsNormalized : touWindows,
        },
      },
      { status: 200 },
    );
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: e?.message ?? String(e) }, { status: 500 });
  }
}


