import { prisma } from '@/lib/db';
import { getCurrentPlanPrisma } from '@/lib/prismaCurrentPlan';

type NormalizeOptions = {
  userId?: string;
  homeId?: string;
};

type RateTypeValue = 'FIXED' | 'VARIABLE' | 'TIME_OF_USE' | 'OTHER';

type BillCreditRuleJson = {
  label: string;
  creditAmountCents: number;
  minUsageKWh: number;
  maxUsageKWh?: number;
  monthsOfYear?: number[];
};

type BillCreditsJson = {
  hasBillCredit: boolean;
  rules: BillCreditRuleJson[];
};

const EMPTY_BILL_CREDITS: BillCreditsJson = { hasBillCredit: false, rules: [] };

export async function normalizeCurrentPlanForUserOrHome({ userId, homeId }: NormalizeOptions) {
  const currentPlanDb = getCurrentPlanPrisma() as any;

  const where: Record<string, unknown> = {};
  if (userId) {
    where.userId = userId;
  }
  if (homeId) {
    where.houseId = homeId;
  }

  if (!where.userId && !where.houseId) {
    return;
  }

  const entry = await currentPlanDb.currentPlanManualEntry.findFirst({
    where,
    orderBy: { updatedAt: 'desc' },
  });

  if (!entry) {
    const normalizedCurrentPlan = (prisma as any).normalizedCurrentPlan;
    if (normalizedCurrentPlan) {
      await normalizedCurrentPlan.deleteMany({
        where: {
          sourceModule: 'current-plan',
          ...(userId ? { userId } : {}),
          ...(homeId ? { homeId } : {}),
        },
      });
    }
    return;
  }

  const rateType = mapRateType(entry.rateType);
  const rateStructure = buildRateStructure(entry, rateType);
  const flatEnergyRateCents =
    rateType === 'FIXED'
      ? valueOrNull(rateStructure.energyRateCents ?? entry.energyRateCents)
      : null;

  const baseMonthlyFeeCents =
    valueOrNull(rateStructure.baseMonthlyFeeCents) ?? convertDollarsToCents(entry.baseMonthlyFee);

  const normalizedCurrentPlan = (prisma as any).normalizedCurrentPlan;

  if (!normalizedCurrentPlan) {
    return;
  }

  await normalizedCurrentPlan.upsert({
    where: {
      sourceModule_sourceEntryId: {
        sourceModule: 'current-plan',
        sourceEntryId: entry.id,
      },
    },
    create: {
      userId: entry.userId ?? null,
      homeId: entry.houseId ?? null,
      providerName: entry.providerName,
      planName: entry.planName,
      rateType,
      rateStructure,
      flatEnergyRateCents,
      baseMonthlyFeeCents,
      termLengthMonths: entry.termLengthMonths ?? null,
      contractEndDate: entry.contractEndDate ?? null,
      sourceEntryId: entry.id,
      sourceUpdatedAt: entry.updatedAt,
    },
    update: {
      userId: entry.userId ?? null,
      homeId: entry.houseId ?? null,
      providerName: entry.providerName,
      planName: entry.planName,
      rateType,
      rateStructure,
      flatEnergyRateCents,
      baseMonthlyFeeCents,
      termLengthMonths: entry.termLengthMonths ?? null,
      contractEndDate: entry.contractEndDate ?? null,
      sourceUpdatedAt: entry.updatedAt,
    },
  });

  await currentPlanDb.currentPlanManualEntry.update({
    where: { id: entry.id },
    data: { normalizedAt: new Date() },
  });
}

function mapRateType(value: unknown): RateTypeValue {
  switch (String(value).toUpperCase()) {
    case 'FIXED':
      return 'FIXED';
    case 'VARIABLE':
      return 'VARIABLE';
    case 'TIME_OF_USE':
      return 'TIME_OF_USE';
    default:
      return 'OTHER';
  }
}

function buildRateStructure(entry: any, rateType: RateTypeValue) {
  const fallbackBaseFee = convertDollarsToCents(entry?.baseMonthlyFee);
  const fallbackBillCredits = buildFallbackBillCredits(entry);

  const raw =
    entry?.rateStructure && typeof entry.rateStructure === 'object' ? entry.rateStructure : null;

  if (raw) {
    const structure = cloneToPlainObject(raw);
    structure.type = mapRateType(structure.type ?? rateType);
    if (structure.baseMonthlyFeeCents == null && fallbackBaseFee != null) {
      structure.baseMonthlyFeeCents = fallbackBaseFee;
    }
    structure.billCredits = normalizeBillCredits(structure.billCredits, fallbackBillCredits);
    return structure;
  }

  const fallback: Record<string, unknown> = {
    type: rateType,
    baseMonthlyFeeCents: fallbackBaseFee,
    billCredits: fallbackBillCredits,
  };

  const energyRate = valueOrNull(entry?.energyRateCents);
  if (rateType === 'FIXED' && energyRate != null) {
    fallback.energyRateCents = energyRate;
  }
  if (rateType === 'VARIABLE' && energyRate != null) {
    fallback.currentBillEnergyRateCents = energyRate;
  }

  if (Array.isArray(entry?.rateStructure?.tiers)) {
    fallback.tiers = entry.rateStructure.tiers;
  }

  return fallback;
}

function cloneToPlainObject(value: any): any {
  if (value == null || typeof value !== 'object') {
    return value;
  }
  if (Array.isArray(value)) {
    return value.map((item) => cloneToPlainObject(item));
  }
  const result: Record<string, any> = {};
  for (const [key, val] of Object.entries(value)) {
    const numericValue = valueOrNull(val);
    if (numericValue != null) {
      result[key] = numericValue;
    } else {
      result[key] = cloneToPlainObject(val);
    }
  }
  return result;
}

function valueOrNull(value: any): number | null {
  if (value == null) {
    return null;
  }
  if (typeof value === 'number') {
    return Number.isFinite(value) ? value : null;
  }
  if (typeof value === 'string') {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
  }
  if (typeof value === 'bigint') {
    return Number(value);
  }
  if (typeof value === 'object' && typeof value.toNumber === 'function') {
    const parsed = value.toNumber();
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

function convertDollarsToCents(value: any): number | null {
  const numeric = valueOrNull(value);
  if (numeric == null) {
    return null;
  }
  return Math.round(numeric * 100);
}

function buildFallbackBillCredits(entry: any): BillCreditsJson {
  const dollarValue = valueOrNull(entry?.billCreditDollars);
  if (dollarValue == null || dollarValue <= 0) {
    return EMPTY_BILL_CREDITS;
  }
  return {
    hasBillCredit: true,
    rules: [
      {
        label: 'Bill credit',
        creditAmountCents: Math.round(dollarValue * 100),
        minUsageKWh: 0,
      },
    ],
  };
}

function normalizeBillCredits(input: any, fallback: BillCreditsJson): BillCreditsJson {
  if (!input || typeof input !== 'object') {
    return fallback;
  }

  const hasBillCredit = input.hasBillCredit === true;
  const rawRules = Array.isArray(input.rules) ? input.rules : [];

  const rules: BillCreditsJson['rules'] = rawRules
    .map((rule: any) => {
      if (!rule || typeof rule !== 'object') {
        return null;
      }
      const label = typeof rule.label === 'string' ? rule.label.trim() : '';
      const creditAmountCents = valueOrNull(rule.creditAmountCents);
      const minUsageKWh = valueOrNull(rule.minUsageKWh) ?? 0;
      const maxUsageKWhRaw = valueOrNull(rule.maxUsageKWh);
      const maxUsageKWh = maxUsageKWhRaw != null ? Math.max(0, maxUsageKWhRaw) : undefined;

      let monthsOfYear: number[] | undefined;
      if (Array.isArray(rule.monthsOfYear)) {
    const monthSet = new Set<number>(
      rule.monthsOfYear
        .map((month: any) => valueOrNull(month))
        .filter((month: number | null): month is number => month != null),
    );
    monthsOfYear = Array.from(monthSet).filter((month: number) => month >= 1 && month <= 12);
        if (monthsOfYear.length === 0) {
          monthsOfYear = undefined;
        }
      }

      if (!label || creditAmountCents == null || creditAmountCents <= 0 || minUsageKWh < 0) {
        return null;
      }

      return {
        label,
        creditAmountCents: Math.round(creditAmountCents),
        minUsageKWh: Math.max(0, minUsageKWh),
        ...(maxUsageKWh != null ? { maxUsageKWh } : {}),
        ...(monthsOfYear ? { monthsOfYear } : {}),
      };
    })
    .filter(
      (rule: BillCreditRuleJson | null): rule is BillCreditRuleJson => Boolean(rule),
    );

  if (!hasBillCredit) {
    return { hasBillCredit: false, rules };
  }

  return {
    hasBillCredit: true,
    rules: rules.length > 0 ? rules : fallback.rules,
  };
}

