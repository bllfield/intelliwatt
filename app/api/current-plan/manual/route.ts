import { cookies } from 'next/headers';
import { NextRequest, NextResponse } from 'next/server';
import { normalizeEmail } from '@/lib/utils/email';
import { prisma } from '@/lib/db';
import { getCurrentPlanPrisma, CurrentPlanPrisma } from '@/lib/prismaCurrentPlan';
import { ensureCurrentPlanEntry } from '@/lib/current-plan/ensureEntry';
import { normalizeCurrentPlanForUserOrHome } from '@/lib/normalization/currentPlan';
import { refreshUserEntryStatuses } from '@/lib/hitthejackwatt/entryLifecycle';

const VALID_RATE_TYPES = new Set(['FIXED', 'VARIABLE', 'TIME_OF_USE', 'OTHER']);
const VALID_VARIABLE_INDEX_TYPES = new Set(['ERCOT', 'FUEL', 'OTHER']);
const VALID_DAY_CODES = new Set(['MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT', 'SUN']);
const DAY_ORDER: Array<'MON' | 'TUE' | 'WED' | 'THU' | 'FRI' | 'SAT' | 'SUN'> = [
  'MON',
  'TUE',
  'WED',
  'THU',
  'FRI',
  'SAT',
  'SUN',
];
const VALID_MONTHS = new Set([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12]);

type BillCreditRule = {
  label: string;
  creditAmountCents: number;
  minUsageKWh: number;
  maxUsageKWh?: number | null;
  monthsOfYear?: number[] | null;
};

type BillCreditStructure = {
  hasBillCredit: boolean;
  rules: BillCreditRule[];
};

type FixedRateStructure = {
  type: 'FIXED';
  energyRateCents: number;
  baseMonthlyFeeCents?: number;
  billCredits?: BillCreditStructure | null;
};

type VariableRateStructure = {
  type: 'VARIABLE';
  currentBillEnergyRateCents: number;
  baseMonthlyFeeCents?: number;
  indexType?: 'ERCOT' | 'FUEL' | 'OTHER';
  variableNotes?: string;
  billCredits?: BillCreditStructure | null;
};

type TimeOfUseTier = {
  label: string;
  priceCents: number;
  startTime: string;
  endTime: string;
  daysOfWeek: Array<'MON' | 'TUE' | 'WED' | 'THU' | 'FRI' | 'SAT' | 'SUN'> | 'ALL';
  monthsOfYear?: number[];
};

type TimeOfUseRateStructure = {
  type: 'TIME_OF_USE';
  baseMonthlyFeeCents?: number;
  tiers: TimeOfUseTier[];
  billCredits?: BillCreditStructure | null;
};

type RateStructure = FixedRateStructure | VariableRateStructure | TimeOfUseRateStructure;

export const dynamic = 'force-dynamic';

type ManualEntryPayload = {
  providerName?: unknown;
  planName?: unknown;
  rateType?: unknown;
  energyRateCents?: unknown;
  baseMonthlyFee?: unknown;
  rateStructure?: unknown;
  termLengthMonths?: unknown;
  contractEndDate?: unknown;
  earlyTerminationFee?: unknown;
  esiId?: unknown;
  accountNumberLast4?: unknown;
  notes?: unknown;
  houseId?: unknown;
};

const decimalToNumber = (value: unknown): number | null => {
  if (value === null || value === undefined) {
    return null;
  }
  if (typeof value === 'number') {
    return value;
  }
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

const decimalFromNumber = (
  value: number,
  precision: number,
  scale: number,
): CurrentPlanPrisma.Decimal => {
  const multiplier = 10 ** scale;
  const rounded = Math.round(value * multiplier) / multiplier;
  return new CurrentPlanPrisma.Decimal(rounded.toFixed(scale));
};

export async function GET() {
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

    await refreshUserEntryStatuses(user.id);

    const currentPlanPrisma = getCurrentPlanPrisma();
    const manualEntryDelegate = currentPlanPrisma.currentPlanManualEntry as any;

    const latestPlan = await manualEntryDelegate.findFirst({
      where: { userId: user.id },
      orderBy: { updatedAt: 'desc' },
    });

    const planEntry = await prisma.entry.findFirst({
      where: {
        userId: user.id,
        type: 'current_plan_details',
        ...(latestPlan?.houseId ? { houseId: latestPlan.houseId } : { houseId: null }),
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
      orderBy: [
        { createdAt: 'desc' },
      ],
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

    const matchingHouseEntries = latestPlan?.houseId
      ? usageEntries.filter((entry) => entry.houseId === latestPlan.houseId)
      : usageEntries;

    const usageEntry =
      matchingHouseEntries.find((entry) => isLiveStatus(entry.status)) ??
      matchingHouseEntries[0] ??
      usageEntries.find((entry) => isLiveStatus(entry.status)) ??
      usageEntries[0] ??
      null;

    const hasActiveUsage = usageEntries.some((entry) => isLiveStatus(entry.status));

    const serializedPlan = latestPlan
      ? {
          id: latestPlan.id as string,
          userId: latestPlan.userId as string,
          houseId: latestPlan.houseId ?? null,
          providerName: latestPlan.providerName as string,
          planName: latestPlan.planName as string,
          rateType: latestPlan.rateType as string,
          energyRateCents: decimalToNumber(latestPlan.energyRateCents),
          baseMonthlyFee: decimalToNumber(latestPlan.baseMonthlyFee),
          billCreditDollars: decimalToNumber(latestPlan.billCreditDollars),
          termLengthMonths: latestPlan.termLengthMonths ?? null,
          contractEndDate: latestPlan.contractEndDate
            ? (latestPlan.contractEndDate as Date).toISOString()
            : null,
          earlyTerminationFee: decimalToNumber(latestPlan.earlyTerminationFee),
          esiId: latestPlan.esiId ?? null,
          accountNumberLast4: latestPlan.accountNumberLast4 ?? null,
          notes: latestPlan.notes ?? null,
          rateStructure: latestPlan.rateStructure ?? null,
          normalizedAt: latestPlan.normalizedAt
            ? (latestPlan.normalizedAt as Date).toISOString()
            : null,
          lastConfirmedAt: latestPlan.lastConfirmedAt
            ? (latestPlan.lastConfirmedAt as Date).toISOString()
            : null,
          createdAt: (latestPlan.createdAt as Date).toISOString(),
          updatedAt: (latestPlan.updatedAt as Date).toISOString(),
        }
      : null;

    return NextResponse.json({
      ok: true,
      plan: serializedPlan,
      entry: planEntry
        ? {
            ...planEntry,
            expiresAt: planEntry.expiresAt ? planEntry.expiresAt.toISOString() : null,
            lastValidated: planEntry.lastValidated ? planEntry.lastValidated.toISOString() : null,
          }
        : null,
      usage: usageEntry
        ? {
            ...usageEntry,
            expiresAt: usageEntry.expiresAt ? usageEntry.expiresAt.toISOString() : null,
            lastValidated: usageEntry.lastValidated ? usageEntry.lastValidated.toISOString() : null,
          }
        : null,
      hasActiveUsage,
    });
  } catch (error) {
    console.error('[current-plan/manual] Failed to fetch plan snapshot', error);
    return NextResponse.json(
      { error: 'Failed to fetch current plan snapshot' },
      { status: 500 },
    );
  }
}

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

    const isPlainObject = (value: unknown): value is Record<string, unknown> =>
      typeof value === 'object' && value !== null && !Array.isArray(value);

    const isValidTime = (value: unknown) => {
      if (typeof value !== 'string' || !/^\d{2}:\d{2}$/.test(value)) {
        return false;
      }
      const [hoursStr, minutesStr] = value.split(':');
      const hours = Number(hoursStr);
      const minutes = Number(minutesStr);
      return (
        Number.isInteger(hours) &&
        Number.isInteger(minutes) &&
        hours >= 0 &&
        hours < 24 &&
        minutes >= 0 &&
        minutes < 60
      );
    };

    const rawRateStructure = isPlainObject(body.rateStructure) ? body.rateStructure : null;
    let billCredits: BillCreditStructure = { hasBillCredit: false, rules: [] };
    let rateStructure: RateStructure | null = null;

    if (rateType && rateType !== 'OTHER') {
      if (rawRateStructure) {
        if ('billCredits' in rawRateStructure) {
          const rawBillCredits = rawRateStructure.billCredits as unknown;
          if (rawBillCredits === null || rawBillCredits === undefined) {
            billCredits = { hasBillCredit: false, rules: [] };
          } else if (!isPlainObject(rawBillCredits)) {
            errors.push('billCredits must be an object when provided.');
          } else {
            const hasBillCredit = rawBillCredits.hasBillCredit === true;
            const rawRules = Array.isArray(rawBillCredits.rules) ? rawBillCredits.rules : [];
            const normalizedRules: BillCreditRule[] = [];

            rawRules.forEach((ruleRaw, index) => {
              if (!isPlainObject(ruleRaw)) {
                errors.push(`billCredits.rules[${index}] must be an object.`);
                return;
              }

              const label =
                typeof ruleRaw.label === 'string' && ruleRaw.label.trim().length > 0
                  ? ruleRaw.label.trim().slice(0, 200)
                  : '';
              if (!label) {
                errors.push(`billCredits.rules[${index}].label is required.`);
              }

              const creditAmountValue = parseNumber(ruleRaw.creditAmountCents);
              if (creditAmountValue === null || creditAmountValue <= 0) {
                errors.push(`billCredits.rules[${index}].creditAmountCents must be a positive number.`);
              }

              const minUsageValue = parseNumber(ruleRaw.minUsageKWh);
              if (minUsageValue === null || minUsageValue < 0) {
                errors.push(`billCredits.rules[${index}].minUsageKWh must be zero or greater.`);
              }

              const maxUsageValueRaw = parseNumber(ruleRaw.maxUsageKWh);
              let maxUsageValue: number | undefined;
              if (maxUsageValueRaw !== null) {
                if (maxUsageValueRaw < 0) {
                  errors.push(`billCredits.rules[${index}].maxUsageKWh must be zero or greater.`);
                } else if (minUsageValue !== null && maxUsageValueRaw < minUsageValue) {
                  errors.push(
                    `billCredits.rules[${index}].maxUsageKWh must be greater than or equal to minUsageKWh.`,
                  );
                } else {
                  maxUsageValue = maxUsageValueRaw;
                }
              }

              let monthsOfYear: number[] | undefined;
              if ('monthsOfYear' in ruleRaw && ruleRaw.monthsOfYear != null) {
                if (!Array.isArray(ruleRaw.monthsOfYear)) {
                  errors.push(`billCredits.rules[${index}].monthsOfYear must be an array when provided.`);
                } else {
                  const parsedMonths: number[] = [];
                  let monthError = false;
                  ruleRaw.monthsOfYear.forEach((monthValue: unknown) => {
                    const monthNumber = parseNumber(monthValue);
                    if (
                      monthNumber === null ||
                      !Number.isInteger(monthNumber) ||
                      !VALID_MONTHS.has(monthNumber)
                    ) {
                      monthError = true;
                    } else {
                      parsedMonths.push(monthNumber);
                    }
                  });
                  if (monthError) {
                    errors.push(
                      `billCredits.rules[${index}].monthsOfYear must contain integers between 1 and 12.`,
                    );
                  } else if (parsedMonths.length > 0) {
                    monthsOfYear = Array.from(new Set(parsedMonths)).sort((a, b) => a - b);
                  }
                }
              }

              if (
                label &&
                creditAmountValue !== null &&
                creditAmountValue > 0 &&
                minUsageValue !== null &&
                minUsageValue >= 0
              ) {
                normalizedRules.push({
                  label,
                  creditAmountCents: Math.round(creditAmountValue),
                  minUsageKWh: minUsageValue,
                  ...(typeof maxUsageValue === 'number' ? { maxUsageKWh: maxUsageValue } : {}),
                  ...(monthsOfYear ? { monthsOfYear } : {}),
                });
              }
            });

            if (hasBillCredit) {
              if (normalizedRules.length === 0) {
                errors.push('billCredits.rules must contain at least one rule when hasBillCredit is true.');
                billCredits = { hasBillCredit: false, rules: [] };
              } else {
                billCredits = { hasBillCredit: true, rules: normalizedRules };
              }
            } else {
              billCredits = { hasBillCredit: false, rules: normalizedRules };
            }
          }
        }

        const structureType =
          typeof rawRateStructure.type === 'string'
            ? (rawRateStructure.type as string).toUpperCase()
            : null;

        if (!structureType || structureType !== rateType) {
          errors.push(`rateStructure.type must match rateType (${rateType}).`);
        } else {
          switch (rateType) {
            case 'FIXED': {
              const energyRate = parseNumber(rawRateStructure.energyRateCents);
              if (energyRate === null || energyRate <= 0) {
                errors.push('rateStructure.energyRateCents must be a positive number.');
              }
              const baseMonthlyFeeCentsValue = parseNumber(rawRateStructure.baseMonthlyFeeCents);
              if (baseMonthlyFeeCentsValue !== null && baseMonthlyFeeCentsValue < 0) {
                errors.push('rateStructure.baseMonthlyFeeCents cannot be negative.');
              }
              if (energyRate !== null && energyRate > 0) {
                rateStructure = {
                  type: 'FIXED',
                  energyRateCents: Number(energyRate.toFixed(4)),
                  ...(baseMonthlyFeeCentsValue !== null && baseMonthlyFeeCentsValue >= 0
                    ? { baseMonthlyFeeCents: Math.round(baseMonthlyFeeCentsValue) }
                    : {}),
                  billCredits,
                };
              }
              break;
            }
            case 'VARIABLE': {
              const currentRate = parseNumber(rawRateStructure.currentBillEnergyRateCents);
              if (currentRate === null || currentRate <= 0) {
                errors.push('rateStructure.currentBillEnergyRateCents must be a positive number.');
              }
              const baseMonthlyFeeCentsValue = parseNumber(rawRateStructure.baseMonthlyFeeCents);
              if (baseMonthlyFeeCentsValue !== null && baseMonthlyFeeCentsValue < 0) {
                errors.push('rateStructure.baseMonthlyFeeCents cannot be negative.');
              }
              let indexType: 'ERCOT' | 'FUEL' | 'OTHER' | undefined;
              if (
                typeof rawRateStructure.indexType === 'string' &&
                rawRateStructure.indexType.trim().length > 0
              ) {
                const normalizedIndex = rawRateStructure.indexType.trim().toUpperCase();
                if (VALID_VARIABLE_INDEX_TYPES.has(normalizedIndex)) {
                  indexType = normalizedIndex as 'ERCOT' | 'FUEL' | 'OTHER';
                } else {
                  errors.push('rateStructure.indexType must be ERCOT, FUEL, or OTHER when provided.');
                }
              }
              const variableNotes =
                typeof rawRateStructure.variableNotes === 'string' &&
                rawRateStructure.variableNotes.trim().length > 0
                  ? rawRateStructure.variableNotes.trim().slice(0, 500)
                  : undefined;

              if (currentRate !== null && currentRate > 0) {
                rateStructure = {
                  type: 'VARIABLE',
                  currentBillEnergyRateCents: Number(currentRate.toFixed(4)),
                  ...(baseMonthlyFeeCentsValue !== null && baseMonthlyFeeCentsValue >= 0
                    ? { baseMonthlyFeeCents: Math.round(baseMonthlyFeeCentsValue) }
                    : {}),
                  ...(indexType ? { indexType } : {}),
                  ...(variableNotes ? { variableNotes } : {}),
                  billCredits,
                };
              }
              break;
            }
            case 'TIME_OF_USE': {
              const baseMonthlyFeeCentsValue = parseNumber(rawRateStructure.baseMonthlyFeeCents);
              if (baseMonthlyFeeCentsValue !== null && baseMonthlyFeeCentsValue < 0) {
                errors.push('rateStructure.baseMonthlyFeeCents cannot be negative.');
              }

              if (!Array.isArray(rawRateStructure.tiers)) {
                errors.push('rateStructure.tiers must be an array for TIME_OF_USE plans.');
                break;
              }

              const sanitizedTiers: TimeOfUseTier[] = [];

              rawRateStructure.tiers.forEach((tierRaw, index) => {
                if (!isPlainObject(tierRaw)) {
                  errors.push(`rateStructure.tiers[${index}] must be an object.`);
                  return;
                }

                const label =
                  typeof tierRaw.label === 'string' ? tierRaw.label.trim() : '';
                if (!label) {
                  errors.push(`Time-of-use tier ${index + 1}: label is required.`);
                }

                const price = parseNumber(tierRaw.priceCents);
                if (price === null || price < 0) {
                  errors.push(
                    `Time-of-use tier ${index + 1}: priceCents must be zero or a positive number.`,
                  );
                }

                const startTime = tierRaw.startTime;
                if (!isValidTime(startTime)) {
                  errors.push(
                    `Time-of-use tier ${index + 1}: startTime must use 24-hour HH:MM format.`,
                  );
                }

                const endTime = tierRaw.endTime;
                if (!isValidTime(endTime)) {
                  errors.push(
                    `Time-of-use tier ${index + 1}: endTime must use 24-hour HH:MM format.`,
                  );
                }

                const rawDays = tierRaw.daysOfWeek;
                let daysOfWeek: TimeOfUseTier['daysOfWeek'] | null = null;
                if (rawDays === 'ALL') {
                  daysOfWeek = 'ALL';
                } else if (Array.isArray(rawDays) && rawDays.length > 0) {
                  const invalidDay = rawDays.some(
                    (day) => typeof day !== 'string' || !VALID_DAY_CODES.has(day),
                  );
                  if (invalidDay) {
                    errors.push(
                      `Time-of-use tier ${index + 1}: daysOfWeek must contain MON-SUN codes or 'ALL'.`,
                    );
                  } else {
                    const uniqueDays = Array.from(new Set(rawDays as string[])) as Array<
                      'MON' | 'TUE' | 'WED' | 'THU' | 'FRI' | 'SAT' | 'SUN'
                    >;
                    daysOfWeek = [...uniqueDays].sort(
                      (a, b) => DAY_ORDER.indexOf(a) - DAY_ORDER.indexOf(b),
                    );
                  }
                } else {
                  errors.push(
                    `Time-of-use tier ${index + 1}: daysOfWeek must be 'ALL' or a non-empty array of day codes.`,
                  );
                }

                let monthsOfYear: number[] | undefined;
                if ('monthsOfYear' in tierRaw && tierRaw.monthsOfYear !== undefined) {
                  if (!Array.isArray(tierRaw.monthsOfYear)) {
                    errors.push(
                      `Time-of-use tier ${index + 1}: monthsOfYear must be an array when provided.`,
                    );
                  } else {
                    const parsedMonths: number[] = [];
                    let monthError = false;
                    tierRaw.monthsOfYear.forEach((monthValue) => {
                      const monthNumber = parseNumber(monthValue);
                      if (
                        monthNumber === null ||
                        !Number.isInteger(monthNumber) ||
                        monthNumber < 1 ||
                        monthNumber > 12
                      ) {
                        monthError = true;
                      } else {
                        parsedMonths.push(monthNumber);
                      }
                    });
                    if (monthError) {
                      errors.push(
                        `Time-of-use tier ${index + 1}: monthsOfYear must contain integers between 1 and 12.`,
                      );
                    } else if (parsedMonths.length > 0) {
                      monthsOfYear = Array.from(new Set(parsedMonths)).sort((a, b) => a - b);
                    }
                  }
                }

                if (
                  label &&
                  price !== null &&
                  price >= 0 &&
                  isValidTime(startTime) &&
                  isValidTime(endTime) &&
                  daysOfWeek &&
                  (daysOfWeek === 'ALL' || (Array.isArray(daysOfWeek) && daysOfWeek.length > 0))
                ) {
                  sanitizedTiers.push({
                    label,
                    priceCents: Number(price.toFixed(4)),
                    startTime: startTime as string,
                    endTime: endTime as string,
                    daysOfWeek,
                    ...(monthsOfYear ? { monthsOfYear } : {}),
                  });
                }
              });

              if (sanitizedTiers.length === 0) {
                errors.push('At least one valid time-of-use tier is required.');
              } else {
                rateStructure = {
                  type: 'TIME_OF_USE',
                  tiers: sanitizedTiers,
                  ...(baseMonthlyFeeCentsValue !== null && baseMonthlyFeeCentsValue >= 0
                    ? { baseMonthlyFeeCents: Math.round(baseMonthlyFeeCentsValue) }
                    : {}),
                  billCredits,
                };
              }
              break;
            }
          }
        }
      } else if (rateType === 'TIME_OF_USE') {
        errors.push('rateStructure is required for TIME_OF_USE plans.');
      }
    }

    const baseMonthlyFeeInput = parseNumber(body.baseMonthlyFee);
    let baseMonthlyFee: CurrentPlanPrisma.Decimal | null = null;
    if (baseMonthlyFeeInput !== null) {
      if (baseMonthlyFeeInput < 0) {
        errors.push('baseMonthlyFee cannot be negative.');
      } else {
        baseMonthlyFee = decimalFromNumber(baseMonthlyFeeInput, 8, 2);
      }
    }

    let billCreditSummary: CurrentPlanPrisma.Decimal | null = null;
    if (billCredits.hasBillCredit && billCredits.rules.length > 0) {
      const maxCreditCents = Math.max(...billCredits.rules.map((rule) => rule.creditAmountCents));
      if (maxCreditCents > 0) {
        billCreditSummary = decimalFromNumber(maxCreditCents / 100, 8, 2);
      }
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

    const applyBaseMonthlyFeeCents = (value?: number) => {
      if (typeof value === 'number') {
        baseMonthlyFee = decimalFromNumber(value / 100, 8, 2);
      }
    };

    let energyRateCents: CurrentPlanPrisma.Decimal | null = null;

    if (rateStructure) {
      if (rateStructure.type === 'FIXED') {
        energyRateCents = decimalFromNumber(rateStructure.energyRateCents, 8, 4);
        applyBaseMonthlyFeeCents(rateStructure.baseMonthlyFeeCents);
      } else if (rateStructure.type === 'VARIABLE') {
        energyRateCents = decimalFromNumber(rateStructure.currentBillEnergyRateCents, 8, 4);
        applyBaseMonthlyFeeCents(rateStructure.baseMonthlyFeeCents);
      } else if (rateStructure.type === 'TIME_OF_USE') {
        applyBaseMonthlyFeeCents(rateStructure.baseMonthlyFeeCents);
      }
    }

    if (!energyRateCents && rateType && rateType !== 'TIME_OF_USE') {
      const legacyEnergyRateInput = parseNumber(body.energyRateCents);
      if (legacyEnergyRateInput === null || legacyEnergyRateInput <= 0) {
        errors.push('energyRateCents must be a positive number.');
      } else {
        energyRateCents = decimalFromNumber(legacyEnergyRateInput, 8, 4);
      }
    }

    if (errors.length > 0 || !rateType) {
      return NextResponse.json({ error: 'Validation failed', details: errors }, { status: 400 });
    }

    const currentPlanPrisma = getCurrentPlanPrisma();
    const manualEntryDelegate = currentPlanPrisma.currentPlanManualEntry as any;

    const entryData = {
        userId: user.id,
      houseId: houseId ?? null,
        providerName,
        planName,
        rateType,
      energyRateCents: energyRateCents ?? undefined,
        baseMonthlyFee,
      billCreditDollars: billCreditSummary ?? undefined,
        termLengthMonths: termLengthMonths ?? undefined,
        contractEndDate: contractEndDate ?? undefined,
        earlyTerminationFee,
        esiId,
        accountNumberLast4,
        notes,
      rateStructure: rateStructure ?? undefined,
      normalizedAt: null,
      lastConfirmedAt: new Date(),
    };

    const existingEntry = await manualEntryDelegate.findFirst({
      where: {
        userId: user.id,
        ...(houseId ? { houseId } : { houseId: null }),
      },
      orderBy: { updatedAt: 'desc' },
      select: { id: true },
    });

    const entry = existingEntry
      ? await manualEntryDelegate.update({
          where: { id: existingEntry.id },
          data: entryData,
          select: { id: true },
        })
      : await manualEntryDelegate.create({
          data: entryData,
      select: { id: true },
    });

    const entryResult = await ensureCurrentPlanEntry(user.id, houseId);

    try {
      await normalizeCurrentPlanForUserOrHome({ userId: user.id, homeId: houseId ?? undefined });
    } catch (normalizationError) {
      console.error('[current-plan/manual] Failed to normalize current plan', normalizationError);
    }

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

