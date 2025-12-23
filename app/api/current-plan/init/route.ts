import { cookies } from 'next/headers';
import { NextRequest, NextResponse } from 'next/server';
import { normalizeEmail } from '@/lib/utils/email';
import { prisma } from '@/lib/db';
import { getCurrentPlanPrisma, CurrentPlanPrisma } from '@/lib/prismaCurrentPlan';
import { refreshUserEntryStatuses } from '@/lib/hitthejackwatt/entryLifecycle';
import { getTdspDeliveryRates } from '@/lib/plan-engine/getTdspDeliveryRates';

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

  const latestManual: ManualEntry | null = await manualDelegate.findFirst({
      where: {
        userId: user.id,
        ...(houseId ? { houseId } : {}),
      },
      orderBy: { updatedAt: 'desc' },
    });

  let effectiveHouseId: string | null = houseId ?? latestManual?.houseId ?? null;

  let latestParsed: ParsedEntry | null = null;
  if (effectiveHouseId) {
    latestParsed = await parsedDelegate.findFirst({
      where: {
        userId: user.id,
        houseId: effectiveHouseId,
      },
      orderBy: { createdAt: 'desc' },
    });
  } else {
    // If there is no manual entry and no explicit houseId, fall back to the most recent
    // parsed bill for this user so parsed data can still pre-fill the form.
    latestParsed = await parsedDelegate.findFirst({
      where: {
        userId: user.id,
      },
      orderBy: { createdAt: 'desc' },
    });
    if (latestParsed && !effectiveHouseId) {
      effectiveHouseId = latestParsed.houseId ?? null;
    }
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

    const planVariablesList: Array<{ key: string; label: string; value: string }> = [];
    const rs: any = effectivePlan?.rateStructure ?? null;
    const rt = String(rateType ?? '').toUpperCase();

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

    const creditsRules = rs?.billCredits?.hasBillCredit && Array.isArray(rs?.billCredits?.rules) ? rs.billCredits.rules : [];
    if (creditsRules.length > 0) {
      planVariablesList.push({ key: 'rep.credits', label: 'Bill credits', value: `${creditsRules.length} rule(s)` });
    }

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
    });
  } catch (error) {
    console.error('[current-plan/init] Failed to fetch current plan init payload', error);
    return NextResponse.json(
      { error: 'Failed to fetch current plan initialization data' },
      { status: 500 },
    );
  }
}


