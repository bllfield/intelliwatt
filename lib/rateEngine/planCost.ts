export type MonthKey = string;

export interface MonthlyUsage {
  month: MonthKey;
  kWh: number;
}

export type PlanRateComponentType = 'per_kwh' | 'fixed_monthly' | 'tiered_per_kwh';

export interface PlanRateTier {
  upToKWh: number | null;
  ratePerKwh: number;
}

export interface PlanRateComponent {
  id: string;
  label: string;
  type: PlanRateComponentType;
  ratePerKwh?: number;
  fixedMonthlyAmount?: number;
  tiers?: PlanRateTier[];
  passthrough?: boolean;
}

export interface PlanDefinition {
  id: string;
  name: string;
  providerName?: string;
  components: PlanRateComponent[];
  termMonths?: number;
  factSheetUrl?: string;
}

export interface MonthlyPlanCostComponent {
  id: string;
  label: string;
  type: PlanRateComponentType;
  cost: number;
}

export interface MonthlyPlanCost {
  month: MonthKey;
  usageKWh: number;
  components: MonthlyPlanCostComponent[];
  totalCost: number;
  effectiveRate: number;
}

export interface PlanCostSummary {
  plan: PlanDefinition;
  months: MonthlyPlanCost[];
  totalCost: number;
  totalKWh: number;
  blendedRate: number;
}

function calculateComponentCost(component: PlanRateComponent, usageKWh: number): number {
  switch (component.type) {
    case 'per_kwh': {
      const rate = component.ratePerKwh ?? 0;
      return usageKWh * rate;
    }
    case 'fixed_monthly': {
      return component.fixedMonthlyAmount ?? 0;
    }
    case 'tiered_per_kwh': {
      const tiers = component.tiers ?? [];
      if (tiers.length === 0) {
        return 0;
      }

      let remaining = usageKWh;
      let tierCost = 0;

      for (const tier of tiers) {
        if (remaining <= 0) break;
        const tierLimit = tier.upToKWh ?? remaining;
        const kWhInTier = Math.min(remaining, tierLimit);
        tierCost += kWhInTier * tier.ratePerKwh;
        remaining -= kWhInTier;
      }

      // If tiers do not cover entire usage but final tier had null upToKWh,
      // remaining will be zero. Otherwise, any leftover usage is priced at the
      // last provided tier rate.
      if (remaining > 0 && tiers.length > 0) {
        const lastTierRate = tiers[tiers.length - 1].ratePerKwh;
        tierCost += remaining * lastTierRate;
      }

      return tierCost;
    }
    default:
      return 0;
  }
}

export function calculatePlanCostForUsage(
  usage: MonthlyUsage[],
  plan: PlanDefinition,
): PlanCostSummary {
  if (!Array.isArray(usage) || usage.length === 0 || plan.components.length === 0) {
    const safeUsage = usage ?? [];
    const totalKWh = safeUsage.reduce((sum, u) => sum + (u.kWh || 0), 0);
    return {
      plan,
      months: safeUsage.map((u) => ({
        month: u.month,
        usageKWh: u.kWh,
        components: plan.components.map((component) => ({
          id: component.id,
          label: component.label,
          type: component.type,
          cost: 0,
        })),
        totalCost: 0,
        effectiveRate: 0,
      })),
      totalCost: 0,
      totalKWh,
      blendedRate: 0,
    };
  }

  const months: MonthlyPlanCost[] = usage.map((monthUsage) => {
    const components = plan.components.map((component) => {
      const cost = calculateComponentCost(component, monthUsage.kWh);
      return {
        id: component.id,
        label: component.label,
        type: component.type,
        cost: Number.isFinite(cost) ? cost : 0,
      };
    });

    const totalCost = components.reduce((sum, component) => sum + component.cost, 0);
    const effectiveRate = monthUsage.kWh > 0 ? totalCost / monthUsage.kWh : 0;

    return {
      month: monthUsage.month,
      usageKWh: monthUsage.kWh,
      components,
      totalCost,
      effectiveRate,
    };
  });

  const totalCost = months.reduce((sum, month) => sum + month.totalCost, 0);
  const totalKWh = months.reduce((sum, month) => sum + month.usageKWh, 0);
  const blendedRate = totalKWh > 0 ? totalCost / totalKWh : 0;

  return {
    plan,
    months,
    totalCost,
    totalKWh,
    blendedRate,
  };
}

