import { cookies } from 'next/headers';
import { NextRequest, NextResponse } from 'next/server';
import { normalizeEmail } from '@/lib/utils/email';
import { prisma } from '@/lib/db';
import { getCurrentPlanPrisma, CurrentPlanPrisma } from '@/lib/prismaCurrentPlan';
import { refreshUserEntryStatuses } from '@/lib/hitthejackwatt/entryLifecycle';
import { getTdspDeliveryRates } from '@/lib/plan-engine/getTdspDeliveryRates';
import { requiredBucketsForRateStructure } from '@/lib/plan-engine/requiredBucketsForPlan';
import { computeMonthsRemainingOnContract } from '@/lib/current-plan/contractTerm';

export const dynamic = 'force-dynamic';

const decimalToNumber = (value: unknown): number | null => {
  if (value === null || value === undefined) return null;
  if (typeof value === 'number') return Number.isFinite(value) ? value : null;
  if (typeof value === 'string') {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
  }
  if (typeof value === 'object' && value && 'toNumber' in (value as Record<string, unknown>)) {
    try {
      const result = (value as { toNumber?: () => number }).toNumber?.();
      return typeof result === 'number' && Number.isFinite(result) ? result : null;
    } catch {
      return null;
    }
  }
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
};

function readSwitchingServiceFeeMonthlyFromRateStructure(rateStructure: unknown): number | null {
  const rs = rateStructure as any;
  const v =
    rs?.comparisonAdjustments?.switchingServiceFeeMonthlyDollars ??
    rs?.switchingServiceFeeMonthlyDollars ??
    null;
  if (v == null || v === '') return null;
  const n = Number(v);
  return Number.isFinite(n) && n >= 0 ? n : null;
}

type ManualEntry = {
  id: string;
  userId: string;
  houseId: string | null;
  providerName: string;
  planName: string;
  rateType: string;
  energyRateCents: CurrentPlanPrisma.Decimal | null;
  baseMonthlyFee: CurrentPlanPrisma.Decimal | null;
  billCreditDollars: CurrentPlanPrisma.Decimal | null;
  termLengthMonths: number | null;
  contractEndDate: Date | null;
  earlyTerminationFee: CurrentPlanPrisma.Decimal | null;
  esiId: string | null;
  accountNumberLast4: string | null;
  notes: string | null;
  rateStructure: unknown | null;
  normalizedAt: Date | null;
  lastConfirmedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
};

type ParsedEntry = {
  id: string;
  userId: string;
  houseId: string;
  providerName: string | null;
  planName: string | null;
  rateType: string | null;
  energyRateCents: CurrentPlanPrisma.Decimal | null;
  baseMonthlyFee: CurrentPlanPrisma.Decimal | null;
  billCreditDollars: CurrentPlanPrisma.Decimal | null;
  termLengthMonths: number | null;
  contractEndDate: Date | null;
  earlyTerminationFee: CurrentPlanPrisma.Decimal | null;
  esiId: string | null;
  accountNumberLast4: string | null;
  notes: string | null;
  rateStructure: unknown | null;
  parserVersion: string | null;
  confidenceScore: number | null;
  createdAt: Date;
  updatedAt: Date;
};

const serializeManualPlan = (entry: ManualEntry | null) => {
  if (!entry) return null;
  return {
    id: entry.id,
    userId: entry.userId,
    houseId: entry.houseId,
    providerName: entry.providerName,
    planName: entry.planName,
    rateType: entry.rateType,
    energyRateCents: decimalToNumber(entry.energyRateCents),
    baseMonthlyFee: decimalToNumber(entry.baseMonthlyFee),
    billCreditDollars: decimalToNumber(entry.billCreditDollars),
    termLengthMonths: entry.termLengthMonths,
    contractEndDate: entry.contractEndDate ? entry.contractEndDate.toISOString() : null,
    earlyTerminationFee: decimalToNumber(entry.earlyTerminationFee),
    esiId: entry.esiId,
    accountNumberLast4: entry.accountNumberLast4,
    switchingServiceFeeMonthly: readSwitchingServiceFeeMonthlyFromRateStructure(entry.rateStructure),
    notes: entry.notes,
    rateStructure: entry.rateStructure,
    normalizedAt: entry.normalizedAt ? entry.normalizedAt.toISOString() : null,
    lastConfirmedAt: entry.lastConfirmedAt ? entry.lastConfirmedAt.toISOString() : null,
    createdAt: entry.createdAt.toISOString(),
    updatedAt: entry.updatedAt.toISOString(),
  };
};

const serializeParsedPlan = (entry: ParsedEntry | null) => {
  if (!entry) return null;
  return {
    id: entry.id,
    userId: entry.userId,
    houseId: entry.houseId,
    providerName: entry.providerName,
    planName: entry.planName,
    rateType: entry.rateType,
    meterNumber: (entry as any).meterNumber ?? null,
    energyRateCents: decimalToNumber(entry.energyRateCents),
    baseMonthlyFee: decimalToNumber(entry.baseMonthlyFee),
    billCreditDollars: decimalToNumber(entry.billCreditDollars),
    termLengthMonths: entry.termLengthMonths,
    contractEndDate: entry.contractEndDate ? entry.contractEndDate.toISOString() : null,
    earlyTerminationFee: decimalToNumber(entry.earlyTerminationFee),
    esiId: entry.esiId,
    accountNumberLast4: entry.accountNumberLast4,
    switchingServiceFeeMonthly: readSwitchingServiceFeeMonthlyFromRateStructure(entry.rateStructure),
    notes: entry.notes,
    rateStructure: entry.rateStructure,
    parserVersion: entry.parserVersion,
    confidenceScore:
      typeof entry.confidenceScore === 'number' && Number.isFinite(entry.confidenceScore)
        ? entry.confidenceScore
        : null,
    createdAt: entry.createdAt.toISOString(),
    updatedAt: entry.updatedAt.toISOString(),
  };
};

function pickNumber(a: any, b: any): number | null {
  const na = typeof a === 'number' ? a : a == null ? null : Number(a);
  if (na != null && Number.isFinite(na)) return na;
  const nb = typeof b === 'number' ? b : b == null ? null : Number(b);
  if (nb != null && Number.isFinite(nb)) return nb;
  return null;
}

function deriveRepEnergyCentsPerKwh(args: {
  rateType: string | null | undefined;
  rateStructure: any | null | undefined;
  energyRateCents: number | null | undefined;
}): number | null {
  const rt = String(args.rateType ?? '').toUpperCase();
  const rs: any = args.rateStructure ?? null;

  // Fixed: prefer structured rate, then top-level value.
  if (rt === 'FIXED') {
    return pickNumber(rs?.energyRateCents, args.energyRateCents);
  }

  // Variable: prefer current bill rate field, then top-level value.
  if (rt === 'VARIABLE') {
    return pickNumber(rs?.currentBillEnergyRateCents, args.energyRateCents);
  }

  // TOU: no single REP energy rate.
  return null;
}

function deriveRepFixedMonthlyDollars(args: {
  rateStructure: any | null | undefined;
  baseMonthlyFee: number | null | undefined;
}): number | null {
  const rs: any = args.rateStructure ?? null;
  const cents = pickNumber(rs?.baseMonthlyFeeCents, null);
  if (cents != null) return Math.round(cents) / 100;
  const dollars = pickNumber(args.baseMonthlyFee, null);
  return dollars != null ? dollars : null;
}

function isRateStructurePresent(rs: any): boolean {
  if (!rs || typeof rs !== 'object') return false;
  const t = String((rs as any)?.type ?? '').toUpperCase();
  if (t === 'FIXED') return typeof (rs as any)?.energyRateCents === 'number';
  if (t === 'VARIABLE') return typeof (rs as any)?.currentBillEnergyRateCents === 'number';
  if (t === 'TIME_OF_USE') return Array.isArray((rs as any)?.tiers) && (rs as any).tiers.length > 0;
  return false;
}

export async function GET(request: NextRequest) {
  try {
    if (!process.env.CURRENT_PLAN_DATABASE_URL) {
      return NextResponse.json(
        { error: 'CURRENT_PLAN_DATABASE_URL is not configured' },
        { status: 500 },
      );
    }

    const cookieStore = cookies();
    const userEmailRaw = cookieStore.get('intelliwatt_user')?.value ?? null;

    if (!userEmailRaw) {
      return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });
    }

    const userEmail = normalizeEmail(userEmailRaw);
    const user = await prisma.user.findUnique({
      where: { email: userEmail },
      select: { id: true },
    });

    if (!user) {
      return NextResponse.json({ error: 'User not found' }, { status: 404 });
    }

    const { searchParams } = new URL(request.url);
    const houseIdParam = searchParams.get('houseId');
    const houseId =
      houseIdParam && houseIdParam.trim().length > 0 ? houseIdParam.trim() : null;

    if (houseId) {
      const ownsHouse = await prisma.houseAddress.findFirst({
        where: { id: houseId, userId: user.id },
        select: { id: true },
      });
      if (!ownsHouse) {
        return NextResponse.json(
          { error: 'houseId does not belong to the current user' },
          { status: 403 },
        );
      }
    }

    await refreshUserEntryStatuses(user.id);

    const currentPlanPrisma = getCurrentPlanPrisma();
    const manualDelegate = currentPlanPrisma.currentPlanManualEntry as any;
    const parsedDelegate = (currentPlanPrisma as any).parsedCurrentPlan as any;

    const latestManualRaw: ManualEntry | null = await manualDelegate.findFirst({
      where: {
        userId: user.id,
        ...(houseId ? { houseId } : {}),
      },
      orderBy: { updatedAt: 'desc' },
    });

    const isAutoImportedFromBill = (m: any): boolean => {
      const notes = typeof m?.notes === 'string' ? m.notes : '';
      const confirmed = m?.lastConfirmedAt instanceof Date;
      return !confirmed && /imported\s+from\s+uploaded\s+bill/i.test(notes);
    };

    // Do not treat auto-imported bill parses as "manual overrides" (they should not override EFL-derived plans).
    const latestManual: ManualEntry | null =
      latestManualRaw && !isAutoImportedFromBill(latestManualRaw) ? latestManualRaw : null;

    let effectiveHouseId: string | null = houseId ?? latestManual?.houseId ?? null;

    // Parsed current plan: prefer EFL-derived parses when present; otherwise fall back to statement-bill parses.
    // EFL uploads are tagged in CurrentPlanBillUpload.filename with prefix "EFL:".
    const parsedWhereBase: any = effectiveHouseId
      ? { userId: user.id, houseId: effectiveHouseId }
      : { userId: user.id };

    const latestParsedEfl: ParsedEntry | null = await parsedDelegate.findFirst({
      where: {
        ...parsedWhereBase,
        uploadId: { not: null },
        // Prisma `startsWith` does not support `mode: "insensitive"`.
        // We tag EFL uploads with an exact uppercase "EFL:" prefix.
        billUpload: { filename: { startsWith: 'EFL:' } },
      },
      orderBy: { createdAt: 'desc' },
    });
    const latestParsedBill: ParsedEntry | null = await parsedDelegate.findFirst({
      where: {
        ...parsedWhereBase,
        uploadId: { not: null },
        // Prisma `startsWith` does not support `mode: "insensitive"`.
        // We tag EFL uploads with an exact uppercase "EFL:" prefix.
        billUpload: { filename: { not: { startsWith: 'EFL:' } } },
      },
      orderBy: { createdAt: 'desc' },
    });
    const latestParsed: ParsedEntry | null = latestParsedEfl ?? latestParsedBill ?? null;

    if (latestParsed && !effectiveHouseId) {
      effectiveHouseId = (latestParsed as any).houseId ?? null;
    }

  // If the parsed payload includes an ESIID, prefer resolving the house by ESIID
  // (this is more reliable than "primary" when users have multiple homes).
  if (!effectiveHouseId) {
    const esiidCandidate =
      (typeof (latestManual as any)?.esiId === 'string' && (latestManual as any).esiId.trim().length > 0
        ? (latestManual as any).esiId.trim()
        : null) ??
      (typeof (latestParsed as any)?.esiId === 'string' && (latestParsed as any).esiId.trim().length > 0
        ? (latestParsed as any).esiId.trim()
        : null) ??
      (typeof (latestParsed as any)?.esiid === 'string' && (latestParsed as any).esiid.trim().length > 0
        ? (latestParsed as any).esiid.trim()
        : null);

    if (esiidCandidate) {
      const houseByEsiid = await prisma.houseAddress.findFirst({
        where: { userId: user.id, archivedAt: null, esiid: esiidCandidate },
        select: { id: true },
      });
      if (houseByEsiid?.id) {
        effectiveHouseId = houseByEsiid.id;
      }
    }
  }

  // If we still don't have a house context (common when users upload a current-plan EFL
  // before selecting a specific house), fall back to the user's primary/recent house.
  if (!effectiveHouseId) {
    const bestHouse = await prisma.houseAddress.findFirst({
      where: { userId: user.id, archivedAt: null },
      orderBy: [{ isPrimary: 'desc' }, { createdAt: 'desc' }],
      select: { id: true },
    });
    if (bestHouse?.id) {
      effectiveHouseId = bestHouse.id;
    }
  }

    const entry = await prisma.entry.findFirst({
      where: {
        userId: user.id,
        type: 'current_plan_details',
        ...(effectiveHouseId ? { houseId: effectiveHouseId } : { houseId: null }),
      },
      orderBy: { createdAt: 'desc' },
      select: {
        id: true,
        status: true,
        expiresAt: true,
        lastValidated: true,
        amount: true,
        houseId: true,
      },
    });

    const usageEntries = await prisma.entry.findMany({
      where: {
        userId: user.id,
        type: 'smart_meter_connect',
      },
      orderBy: [{ createdAt: 'desc' }],
      select: {
        id: true,
        status: true,
        expiresAt: true,
        lastValidated: true,
        houseId: true,
      },
    });

    const isLiveStatus = (status: string | null | undefined) =>
      status === 'ACTIVE' || status === 'EXPIRING_SOON';

    const matchingHouseEntries = effectiveHouseId
      ? usageEntries.filter((u) => u.houseId === effectiveHouseId)
      : usageEntries;

    const usageEntry =
      matchingHouseEntries.find((u) => isLiveStatus(u.status)) ??
      matchingHouseEntries[0] ??
      usageEntries.find((u) => isLiveStatus(u.status)) ??
      usageEntries[0] ??
      null;

    // If we still don't have a house context, prefer the active usage entry's houseId.
    // This aligns TDSP variables + comparisons with the home that actually has usage.
    if (!effectiveHouseId && usageEntry?.houseId) {
      effectiveHouseId = usageEntry.houseId as string;
    }

    const hasActiveUsage = usageEntries.some((u) => isLiveStatus(u.status));

    const serializeEntrySnapshot = (snap: any | null) =>
      snap
        ? {
            ...snap,
            expiresAt: snap.expiresAt ? snap.expiresAt.toISOString() : null,
            lastValidated: snap.lastValidated ? snap.lastValidated.toISOString() : null,
          }
        : null;

    const savedCurrentPlan = serializeManualPlan(latestManual);
    const parsedCurrentPlan = serializeParsedPlan(latestParsed);

    // Plan variables used (for transparency, like offer detail).
    let tdspApplied: any | null = null;
    let prefillSignals: { esiId: string | null; meterNumber: string | null; sources: string[] } = {
      esiId: null,
      meterNumber: null,
      sources: [],
    };
    try {
      if (effectiveHouseId) {
        const house = await prisma.houseAddress.findFirst({
          where: { id: effectiveHouseId, userId: user.id },
          select: { tdspSlug: true, esiid: true },
        });
        const houseEsiid = typeof house?.esiid === 'string' && house.esiid.trim().length > 0 ? house.esiid.trim() : null;
        if (houseEsiid) {
          prefillSignals.esiId = houseEsiid;
          prefillSignals.sources.push('houseAddress.esiid');
        }

        // SMT authorization (if any) can provide meter number (and a canonical ESIID).
        try {
          const auth = await prisma.smtAuthorization.findFirst({
            where: { houseAddressId: effectiveHouseId, archivedAt: null },
            orderBy: { createdAt: 'desc' },
            select: { esiid: true, meterNumber: true },
          });
          const authEsiid = typeof auth?.esiid === 'string' && auth.esiid.trim().length > 0 ? auth.esiid.trim() : null;
          const authMeter = typeof auth?.meterNumber === 'string' && auth.meterNumber.trim().length > 0 ? auth.meterNumber.trim() : null;
          if (authEsiid && !prefillSignals.esiId) {
            prefillSignals.esiId = authEsiid;
            prefillSignals.sources.push('smtAuthorization.esiid');
          }
          if (authMeter) {
            prefillSignals.meterNumber = authMeter;
            prefillSignals.sources.push('smtAuthorization.meterNumber');
          }
        } catch {
          // ignore
        }

        const tdspSlug = String(house?.tdspSlug ?? '').trim().toLowerCase();
        if (tdspSlug) {
          const tdsp = await getTdspDeliveryRates({ tdspSlug, asOf: new Date() });
          if (tdsp) {
            tdspApplied = {
              perKwhDeliveryChargeCents: typeof tdsp.perKwhDeliveryChargeCents === 'number' ? tdsp.perKwhDeliveryChargeCents : null,
              monthlyCustomerChargeDollars: typeof tdsp.monthlyCustomerChargeDollars === 'number' ? tdsp.monthlyCustomerChargeDollars : null,
              effectiveDate: tdsp.effectiveDate ?? null,
            };
          }
        }
      }
    } catch {
      tdspApplied = null;
    }

    const effectivePlan = savedCurrentPlan ?? parsedCurrentPlan ?? null;
    const rateType = effectivePlan?.rateType ?? null;
    const repEnergyCentsPerKwh = deriveRepEnergyCentsPerKwh({
      rateType,
      rateStructure: effectivePlan?.rateStructure ?? null,
      energyRateCents: effectivePlan?.energyRateCents ?? null,
    });
    const repFixedMonthlyDollars = deriveRepFixedMonthlyDollars({
      rateStructure: effectivePlan?.rateStructure ?? null,
      baseMonthlyFee: effectivePlan?.baseMonthlyFee ?? null,
    });
    const switchingServiceFeeMonthly = readSwitchingServiceFeeMonthlyFromRateStructure(
      effectivePlan?.rateStructure ?? null,
    );

    const planVariablesList: Array<{ key: string; label: string; value: string }> = [];
    const rs: any = effectivePlan?.rateStructure ?? null;
    const rt = String(rateType ?? '').toUpperCase();

    const contractEndDateIso = effectivePlan?.contractEndDate ?? null;
    const monthsRemainingOnContract = computeMonthsRemainingOnContract({
      contractEndDate: contractEndDateIso,
      asOf: new Date(),
    });

    // Buckets used by this plan (authoritative from rateStructure).
    const requiredBuckets = requiredBucketsForRateStructure({ rateStructure: rs ?? null });
    const requiredBucketKeys = requiredBuckets.map((b) => b.key);

    // Customer-facing guidance: if we have a plan record but it is not computable yet,
    // tell the customer to finish the manual entry (prefilled from bill/EFL).
    const missingFields: string[] = [];
    const providerName = typeof effectivePlan?.providerName === 'string' ? effectivePlan.providerName.trim() : '';
    const planName = typeof effectivePlan?.planName === 'string' ? effectivePlan.planName.trim() : '';
    const rtUpper = String(rateType ?? '').toUpperCase();
    if (!providerName) missingFields.push('providerName');
    if (!planName) missingFields.push('planName');
    if (!['FIXED', 'VARIABLE', 'TIME_OF_USE'].includes(rtUpper)) missingFields.push('rateType');
    if (rtUpper === 'FIXED') {
      const hasFixedRate =
        (rs && typeof (rs as any)?.energyRateCents === 'number') ||
        (typeof effectivePlan?.energyRateCents === 'number' && Number.isFinite(effectivePlan.energyRateCents));
      if (!hasFixedRate) missingFields.push('energyRateCentsPerKwh');
    }
    if (rtUpper === 'VARIABLE') {
      const hasVarRate =
        (rs && typeof (rs as any)?.currentBillEnergyRateCents === 'number') ||
        (typeof effectivePlan?.energyRateCents === 'number' && Number.isFinite(effectivePlan.energyRateCents));
      if (!hasVarRate) missingFields.push('currentBillEnergyRateCentsPerKwh');
    }
    if (rtUpper === 'TIME_OF_USE') {
      const tiersOk = Array.isArray((rs as any)?.tiers) && (rs as any).tiers.length > 0;
      if (!tiersOk) missingFields.push('timeOfUseTiers');
    }

    const computableNow = isRateStructurePresent(rs);
    const needsManualCompletion = Boolean(effectivePlan) && !computableNow;
    const manualCompletionMessage = needsManualCompletion
      ? `We pre-filled what we could from your uploaded bill/EFL. To calculate your current rate and show savings, please review the form below, fill in any missing fields, and click Save.`
      : null;

    if (rt === 'TIME_OF_USE') {
      const tiers = Array.isArray(rs?.tiers) ? rs.tiers : [];
      planVariablesList.push({ key: 'rep.tou_tiers', label: 'REP time-of-use tiers', value: String(tiers.length || 0) });
    } else if (rt === 'VARIABLE') {
      planVariablesList.push({
        key: 'rep.energy',
        label: 'REP energy (current bill)',
        value: repEnergyCentsPerKwh != null ? `${Number(repEnergyCentsPerKwh).toFixed(4)}¢/kWh` : '—',
      });
      const indexType = String(rs?.indexType ?? rs?.variableIndexType ?? '').trim();
      if (indexType) {
        planVariablesList.push({ key: 'rep.index', label: 'Variable index', value: indexType });
      }
    } else {
      planVariablesList.push({
        key: 'rep.energy',
        label: 'REP energy',
        value: repEnergyCentsPerKwh != null ? `${Number(repEnergyCentsPerKwh).toFixed(4)}¢/kWh` : '—',
      });
    }

    planVariablesList.push({
      key: 'rep.fixed',
      label: 'REP fixed',
      value: repFixedMonthlyDollars != null ? `$${Number(repFixedMonthlyDollars).toFixed(2)}/mo` : '—/mo',
    });
    if (switchingServiceFeeMonthly != null) {
      planVariablesList.push({
        key: 'current.switching_service_fee_monthly',
        label: 'Switching service fee',
        value: `$${Number(switchingServiceFeeMonthly).toFixed(2)}/mo`,
      });
    }

    const creditsRules = rs?.billCredits?.hasBillCredit && Array.isArray(rs?.billCredits?.rules) ? rs.billCredits.rules : [];
    if (creditsRules.length > 0) {
      planVariablesList.push({ key: 'rep.credits', label: 'Bill credits', value: `${creditsRules.length} rule(s)` });
    }

    // Minimum usage fee (encoded as a negative bill credit rule).
    const minFeeRule = creditsRules.find((r: any) => {
      const label = String(r?.label ?? '');
      const cents = typeof r?.creditAmountCents === 'number' ? r.creditAmountCents : Number(r?.creditAmountCents);
      const minUsage = typeof r?.minUsageKWh === 'number' ? r.minUsageKWh : Number(r?.minUsageKWh);
      return /minimum\s*usage\s*fee/i.test(label) && Number.isFinite(cents) && cents < 0 && Number.isFinite(minUsage) && minUsage > 0;
    });
    if (minFeeRule) {
      const feeCentsAbs = Math.abs(Number(minFeeRule.creditAmountCents));
      const threshold = Number(minFeeRule.minUsageKWh);
      planVariablesList.push({
        key: 'rep.minimum_usage_fee',
        label: 'Minimum usage fee',
        value: feeCentsAbs > 0 && threshold > 0 ? `$${(feeCentsAbs / 100).toFixed(2)} when < ${threshold} kWh` : '—',
      });
    }

    // Delivery included flag (prevents double-counting TDSP). Always show as a variable (Yes/No).
    planVariablesList.push({
      key: 'tdsp.included',
      label: 'TDSP delivery included in REP rate',
      value: rs?.tdspDeliveryIncludedInEnergyCharge === true ? 'Yes' : 'No',
    });

    if (tdspApplied) {
      planVariablesList.push({
        key: 'tdsp.delivery',
        label: 'TDSP delivery',
        value: tdspApplied.perKwhDeliveryChargeCents != null ? `${Number(tdspApplied.perKwhDeliveryChargeCents).toFixed(4)}¢/kWh` : '—',
      });
      planVariablesList.push({
        key: 'tdsp.customer',
        label: 'TDSP customer',
        value: tdspApplied.monthlyCustomerChargeDollars != null ? `$${Number(tdspApplied.monthlyCustomerChargeDollars).toFixed(2)}/mo` : '—/mo',
      });
      if (tdspApplied.effectiveDate) {
        planVariablesList.push({ key: 'tdsp.effective', label: 'TDSP effective', value: String(tdspApplied.effectiveDate).slice(0, 10) });
      }
    }

    return NextResponse.json({
      ok: true,
      // Backwards-compatible fields used by existing UI:
      savedCurrentPlan,
      parsedCurrentPlan,
      prefillSignals,
      contract: {
        contractEndDate: contractEndDateIso,
        monthsRemainingOnContract,
        asOf: new Date().toISOString(),
      },
      requiredBuckets,
      requiredBucketKeys,
      planVariablesUsed: {
        rep: {
          energyCentsPerKwh: repEnergyCentsPerKwh,
          fixedMonthlyChargeDollars: repFixedMonthlyDollars,
        },
        tdsp: tdspApplied,
      },
      planVariablesList,
      entry: serializeEntrySnapshot(entry),
      usage: serializeEntrySnapshot(usageEntry),
      hasActiveUsage,
      // Aliases matching the bill parsing system overview contract:
      saved: savedCurrentPlan,
      parsed: parsedCurrentPlan,
      manualCompletion: {
        needed: needsManualCompletion,
        computableNow,
        missingFields,
        message: manualCompletionMessage,
      },
    });
  } catch (error) {
    console.error('[current-plan/init] Failed to fetch current plan init payload', error);
    return NextResponse.json(
      { error: 'Failed to fetch current plan initialization data' },
      { status: 500 },
    );
  }
}


