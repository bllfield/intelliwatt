import { prisma } from "@/lib/db";
import { getCurrentPlanPrisma } from "@/lib/prismaCurrentPlan";
import { normalizeEmail } from "@/lib/utils/email";
import { extractProviderAndPlanNameFromEflText } from "@/lib/efl/eflExtractor";

function upperKey(s: string | null | undefined): string | null {
  const t = String(s ?? "").trim();
  if (!t) return null;
  return t.toUpperCase();
}

function pickRateTypeFromRateStructure(rs: any): "FIXED" | "VARIABLE" | "TIME_OF_USE" | "OTHER" {
  const t = String(rs?.type ?? "").toUpperCase();
  if (t === "FIXED" || t === "VARIABLE" || t === "TIME_OF_USE") return t as any;
  return "OTHER";
}

export async function adminPersistCurrentPlanFromEflPipeline(args: {
  usageEmail: string;
  usageHomeId?: string | null;
  pipelineResult: {
    rawTextPreview?: string | null;
    rawTextLen?: number | null;
    rawTextTruncated?: boolean | null;
    eflPdfSha256?: string | null;
    repPuctCertificate?: string | null;
    eflVersionCode?: string | null;
    planRules?: any | null;
    rateStructure?: any | null;
    finalValidation?: any | null;
    passStrength?: any | null;
    queued?: boolean | null;
    queueReason?: string | null;
  };
}) {
  const email = normalizeEmail(args.usageEmail);
  if (!email) {
    return { ok: false as const, error: "missing_usage_email" as const };
  }

  const user = await prisma.user.findUnique({
    where: { email },
    select: { id: true, email: true },
  });
  if (!user) {
    return { ok: false as const, error: "user_not_found" as const, email };
  }

  const rs = args.pipelineResult.rateStructure ?? null;
  if (!rs || typeof rs !== "object") {
    return { ok: false as const, error: "missing_rate_structure" as const, email };
  }

  // Require validator PASS before we write a canonical current-plan template.
  const fvStatus = String((args.pipelineResult.finalValidation as any)?.status ?? "").toUpperCase();
  if (fvStatus && fvStatus !== "PASS") {
    return { ok: false as const, error: "validation_not_pass" as const, status: fvStatus, email };
  }

  const rawText = String(args.pipelineResult.rawTextPreview ?? "");
  const labels = extractProviderAndPlanNameFromEflText(rawText);
  const providerName = labels.providerName ?? null;
  const planName = labels.planName ?? null;

  const providerKey = upperKey(providerName);
  const planKey = upperKey(planName);
  if (!providerKey || !planKey) {
    return { ok: false as const, error: "missing_provider_or_plan" as const, email, providerName, planName };
  }

  const houseId =
    (typeof args.usageHomeId === "string" && args.usageHomeId.trim().length > 0 ? args.usageHomeId.trim() : null) ??
    (await prisma.houseAddress
      .findFirst({
        where: { userId: user.id, archivedAt: null },
        orderBy: [{ isPrimary: "desc" }, { createdAt: "desc" }],
        select: { id: true },
      })
      .then((h) => h?.id ?? null));

  if (!houseId) {
    return { ok: false as const, error: "house_not_found" as const, email };
  }

  const planRules: any = args.pipelineResult.planRules ?? null;
  const rateTypeFromRules = String(planRules?.rateType ?? "").toUpperCase();
  const rateType: any =
    rateTypeFromRules === "FIXED" || rateTypeFromRules === "VARIABLE" || rateTypeFromRules === "TIME_OF_USE"
      ? rateTypeFromRules
      : pickRateTypeFromRateStructure(rs);

  const termMonths =
    typeof planRules?.termMonths === "number" && Number.isFinite(planRules.termMonths) ? Math.round(planRules.termMonths) : null;

  const earlyTerminationFeeCents =
    typeof planRules?.cancelFeeCents === "number" && Number.isFinite(planRules.cancelFeeCents)
      ? Math.round(planRules.cancelFeeCents)
      : null;

  const baseChargeCentsPerMonth =
    typeof planRules?.baseChargePerMonthCents === "number" && Number.isFinite(planRules.baseChargePerMonthCents)
      ? Math.round(planRules.baseChargePerMonthCents)
      : (typeof rs?.baseMonthlyFeeCents === "number" && Number.isFinite(rs.baseMonthlyFeeCents)
          ? Math.round(rs.baseMonthlyFeeCents)
          : null);

  const energyRateCents =
    typeof rs?.energyRateCents === "number" && Number.isFinite(rs.energyRateCents)
      ? Number(rs.energyRateCents)
      : typeof rs?.currentBillEnergyRateCents === "number" && Number.isFinite(rs.currentBillEnergyRateCents)
        ? Number(rs.currentBillEnergyRateCents)
        : null;

  const currentPlanPrisma = getCurrentPlanPrisma();
  const parsedDelegate = (currentPlanPrisma as any).parsedCurrentPlan as any;
  const templateDelegate = (currentPlanPrisma as any).billPlanTemplate as any;
  const manualDelegate = (currentPlanPrisma as any).currentPlanManualEntry as any;

  // Upsert ParsedCurrentPlan for this home (so Compare can pick it up immediately).
  const existingParsed = await parsedDelegate.findFirst({
    where: { userId: user.id, houseId },
    orderBy: { createdAt: "desc" },
    select: { id: true },
  });

  const parsedData = {
    userId: user.id,
    houseId,
    sourceUploadId: null,
    uploadId: null,
    rawText: rawText ? rawText.slice(0, 250_000) : null,
    rawTextSnippet: rawText ? rawText.slice(0, 5000) : null,
    providerName,
    planName,
    rateType,
    termMonths,
    termLengthMonths: termMonths,
    earlyTerminationFeeCents,
    baseChargeCentsPerMonth,
    energyRateCents: energyRateCents != null ? energyRateCents : null,
    rateStructure: rs,
    parserVersion: "admin-fact-cards-efl-v1",
    confidenceScore: null,
  };

  const parsedRow = existingParsed?.id
    ? await parsedDelegate.update({ where: { id: existingParsed.id }, data: parsedData })
    : await parsedDelegate.create({ data: parsedData });

  const billCreditsJson = (() => {
    const rules = (rs as any)?.billCredits?.rules;
    if (!Array.isArray(rules)) return null;
    const out = rules
      .map((r: any) => ({
        label: typeof r?.label === "string" ? r.label : "Bill credit",
        creditCents: typeof r?.creditAmountCents === "number" && Number.isFinite(r.creditAmountCents) ? Math.round(r.creditAmountCents) : null,
        thresholdKwh: typeof r?.minUsageKWh === "number" && Number.isFinite(r.minUsageKWh) ? Math.round(r.minUsageKWh) : null,
      }))
      .filter((x: any) => typeof x.creditCents === "number" && x.creditCents !== 0 && typeof x.thresholdKwh === "number" && x.thresholdKwh > 0);
    return out.length ? out : null;
  })();

  const timeOfUseConfigJson = (() => {
    const tiers = Array.isArray((rs as any)?.tiers) ? (rs as any).tiers : [];
    if (!tiers.length) return null;
    const out = tiers
      .map((t: any) => ({
        label: typeof t?.label === "string" ? t.label : null,
        start: typeof t?.startTime === "string" ? t.startTime : null,
        end: typeof t?.endTime === "string" ? t.endTime : null,
        cents: typeof t?.priceCents === "number" && Number.isFinite(t.priceCents) ? Number(t.priceCents) : null,
        monthsOfYear: Array.isArray(t?.monthsOfYear) ? t.monthsOfYear : null,
      }))
      .filter((x: any) => x.start && x.end && typeof x.cents === "number");
    return out.length ? out : null;
  })();

  const energyRateTiersJson = (() => {
    const cents =
      typeof (rs as any)?.energyRateCents === "number" && Number.isFinite((rs as any).energyRateCents)
        ? Number((rs as any).energyRateCents)
        : typeof (rs as any)?.currentBillEnergyRateCents === "number" && Number.isFinite((rs as any).currentBillEnergyRateCents)
          ? Number((rs as any).currentBillEnergyRateCents)
          : null;
    if (cents == null) return null;
    return [
      {
        label: "Energy",
        minKWh: 0,
        maxKWh: null,
        rateCentsPerKwh: Number(cents.toFixed(4)),
      },
    ];
  })();

  // Upsert plan-level BillPlanTemplate (so it shows up in Fact Cards "Current plan templates").
  await templateDelegate.upsert({
    where: { providerNameKey_planNameKey: { providerNameKey: providerKey, planNameKey: planKey } },
    create: {
      providerNameKey: providerKey,
      planNameKey: planKey,
      providerName,
      planName,
      rateType,
      termMonths,
      contractEndDate: null,
      earlyTerminationFeeCents,
      baseChargeCentsPerMonth,
      energyRateTiersJson,
      timeOfUseConfigJson,
      billCreditsJson,
    },
    update: {
      providerName,
      planName,
      rateType,
      termMonths,
      earlyTerminationFeeCents,
      baseChargeCentsPerMonth,
      energyRateTiersJson,
      timeOfUseConfigJson,
      billCreditsJson,
      updatedAt: new Date(),
    },
  });

  // Best-effort: also ensure a CurrentPlanManualEntry exists for this home so the customer-facing
  // snapshot and Compare can converge on a single canonical rateStructure.
  try {
    const existingManual = await manualDelegate.findFirst({
      where: { userId: user.id, houseId },
      orderBy: { updatedAt: "desc" },
      select: { id: true },
    });
    const manualData = {
      userId: user.id,
      houseId,
      providerName: providerName ?? "Unknown provider",
      planName: planName ?? "Unknown plan",
      rateType,
      energyRateCents: energyRateCents != null ? energyRateCents : null,
      baseMonthlyFee: null,
      billCreditDollars: null,
      termLengthMonths: termMonths,
      contractEndDate: null,
      earlyTerminationFee: earlyTerminationFeeCents != null ? earlyTerminationFeeCents / 100 : null,
      esiId: null,
      accountNumberLast4: null,
      notes: "Imported from admin Fact Cards (current-plan template).",
      rateStructure: rs,
      normalizedAt: new Date(),
      lastConfirmedAt: null,
    };
    if (existingManual?.id) {
      await manualDelegate.update({ where: { id: existingManual.id }, data: manualData });
    } else {
      await manualDelegate.create({ data: manualData });
    }
  } catch {
    // best-effort only
  }

  return {
    ok: true as const,
    email,
    userId: user.id,
    houseId,
    providerName,
    planName,
    providerNameKey: providerKey,
    planNameKey: planKey,
    parsedCurrentPlanId: String(parsedRow?.id ?? ""),
  };
}

