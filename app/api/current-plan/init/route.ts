import { cookies } from 'next/headers';
import { NextRequest, NextResponse } from 'next/server';
import { normalizeEmail } from '@/lib/utils/email';
import { prisma } from '@/lib/db';
import { getCurrentPlanPrisma, CurrentPlanPrisma } from '@/lib/prismaCurrentPlan';
import { refreshUserEntryStatuses } from '@/lib/hitthejackwatt/entryLifecycle';

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

    return NextResponse.json({
      ok: true,
      // Backwards-compatible fields used by existing UI:
      savedCurrentPlan,
      parsedCurrentPlan,
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


