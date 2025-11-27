import { cookies } from 'next/headers';
import { NextRequest, NextResponse } from 'next/server';
import { normalizeEmail } from '@/lib/utils/email';
import { prisma } from '@/lib/db';
import { getCurrentPlanPrisma, CurrentPlanPrisma } from '@/lib/prismaCurrentPlan';
import { ensureCurrentPlanEntry } from '@/lib/current-plan/ensureEntry';

const VALID_RATE_TYPES = new Set(['FIXED', 'VARIABLE', 'TIME_OF_USE', 'OTHER']);

export const dynamic = 'force-dynamic';

type ManualEntryPayload = {
  providerName?: unknown;
  planName?: unknown;
  rateType?: unknown;
  energyRateCents?: unknown;
  baseMonthlyFee?: unknown;
  termLengthMonths?: unknown;
  contractEndDate?: unknown;
  earlyTerminationFee?: unknown;
  esiId?: unknown;
  accountNumberLast4?: unknown;
  notes?: unknown;
  houseId?: unknown;
};

const decimalFromNumber = (
  value: number,
  precision: number,
  scale: number,
): CurrentPlanPrisma.Decimal => {
  const multiplier = 10 ** scale;
  const rounded = Math.round(value * multiplier) / multiplier;
  return new CurrentPlanPrisma.Decimal(rounded.toFixed(scale));
};

export async function POST(request: NextRequest) {
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

    const body = (await request.json().catch(() => null)) as ManualEntryPayload | null;

    if (!body) {
      return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
    }

    const errors: string[] = [];

    const providerName =
      typeof body.providerName === 'string' && body.providerName.trim().length > 0
        ? body.providerName.trim()
        : '';
    const planName =
      typeof body.planName === 'string' && body.planName.trim().length > 0
        ? body.planName.trim()
        : '';

    if (!providerName) {
      errors.push('providerName is required.');
    }

    if (!planName) {
      errors.push('planName is required.');
    }

    const rateType =
      typeof body.rateType === 'string' && VALID_RATE_TYPES.has(body.rateType)
        ? (body.rateType as 'FIXED' | 'VARIABLE' | 'TIME_OF_USE' | 'OTHER')
        : null;

    if (!rateType) {
      errors.push('rateType must be one of FIXED, VARIABLE, TIME_OF_USE, OTHER.');
    }

    const parseNumber = (value: unknown) => {
      if (typeof value === 'number') {
        return value;
      }
      if (typeof value === 'string' && value.trim().length > 0) {
        const parsed = Number(value);
        if (Number.isFinite(parsed)) {
          return parsed;
        }
      }
      return null;
    };

    const energyRateInput = parseNumber(body.energyRateCents);
    let energyRateCents: CurrentPlanPrisma.Decimal | null = null;
    if (energyRateInput === null || energyRateInput <= 0) {
      errors.push('energyRateCents must be a positive number.');
    } else {
      energyRateCents = decimalFromNumber(energyRateInput, 8, 4);
    }

    const baseMonthlyFeeInput = parseNumber(body.baseMonthlyFee);
    const baseMonthlyFee =
      baseMonthlyFeeInput !== null && baseMonthlyFeeInput >= 0
        ? decimalFromNumber(baseMonthlyFeeInput, 8, 2)
        : null;
    if (baseMonthlyFeeInput !== null && baseMonthlyFeeInput < 0) {
      errors.push('baseMonthlyFee cannot be negative.');
    }

    const termLengthInput = parseNumber(body.termLengthMonths);
    let termLengthMonths: number | null = null;
    if (termLengthInput !== null) {
      const roundedTerm = Math.trunc(termLengthInput);
      if (roundedTerm <= 0) {
        errors.push('termLengthMonths must be a positive whole number when provided.');
      } else {
        termLengthMonths = roundedTerm;
      }
    }

    const earlyTerminationFeeInput = parseNumber(body.earlyTerminationFee);
    const earlyTerminationFee =
      earlyTerminationFeeInput !== null && earlyTerminationFeeInput >= 0
        ? decimalFromNumber(earlyTerminationFeeInput, 8, 2)
        : null;
    if (earlyTerminationFeeInput !== null && earlyTerminationFeeInput < 0) {
      errors.push('earlyTerminationFee cannot be negative.');
    }

    let contractEndDate: Date | null = null;
    if (typeof body.contractEndDate === 'string' && body.contractEndDate.trim().length > 0) {
      const parsedDate = new Date(body.contractEndDate);
      if (Number.isNaN(parsedDate.getTime())) {
        errors.push('contractEndDate must be a valid ISO date string.');
      } else {
        contractEndDate = parsedDate;
      }
    }

    const esiId =
      typeof body.esiId === 'string' && body.esiId.trim().length > 0
        ? body.esiId.trim().slice(0, 64)
        : null;
    const accountNumberLast4 =
      typeof body.accountNumberLast4 === 'string' && body.accountNumberLast4.trim().length > 0
        ? body.accountNumberLast4.trim().slice(0, 8)
        : null;

    if (accountNumberLast4 && accountNumberLast4.length > 8) {
      errors.push('accountNumberLast4 must be 8 characters or fewer.');
    }

    const notes =
      typeof body.notes === 'string' && body.notes.trim().length > 0
        ? body.notes.trim().slice(0, 2000)
        : null;

    const houseId =
      typeof body.houseId === 'string' && body.houseId.trim().length > 0
        ? body.houseId.trim()
        : null;

    if (houseId) {
      const ownsHouse = await prisma.houseAddress.findFirst({
        where: { id: houseId, userId: user.id },
        select: { id: true },
      });

      if (!ownsHouse) {
        errors.push('houseId does not belong to the current user.');
      }
    }

    if (errors.length > 0 || !energyRateCents || !rateType) {
      return NextResponse.json({ error: 'Validation failed', details: errors }, { status: 400 });
    }

    const currentPlanPrisma = getCurrentPlanPrisma();

    const entry = await currentPlanPrisma.currentPlanManualEntry.create({
      data: {
        userId: user.id,
        houseId,
        providerName,
        planName,
        rateType,
        energyRateCents,
        baseMonthlyFee,
        termLengthMonths: termLengthMonths ?? undefined,
        contractEndDate: contractEndDate ?? undefined,
        earlyTerminationFee,
        esiId,
        accountNumberLast4,
        notes,
      },
      select: { id: true },
    });

    const entryResult = await ensureCurrentPlanEntry(user.id, houseId);

    return NextResponse.json({
      ok: true,
      id: entry.id,
      entryAwarded: entryResult.entryAwarded,
      alreadyAwarded: entryResult.alreadyAwarded,
    });
  } catch (error) {
    console.error('[current-plan/manual] Failed to save manual entry', error);
    return NextResponse.json({ error: 'Failed to save manual entry' }, { status: 500 });
  }
}

