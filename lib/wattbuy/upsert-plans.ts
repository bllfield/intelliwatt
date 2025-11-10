import { prisma } from '@/lib/db';
import type { Plan as TransformedPlan } from './normalize-plans';

// unchanged signature — just fill the new fields when present
export async function upsertPlans(plans: TransformedPlan[]) {
  const results: { id: string; supplier?: string | null; planName?: string | null }[] = [];

  for (const p of plans) {
    const utilityId = p.utility_id!;
    const state = (p.state || '').toLowerCase();
    const supplier = p.supplier ?? null;
    const planName = p.plan_name ?? null;
    const term = p.term_months ?? null;
    const isTariff = Boolean(p.is_utility_tariff);

    const rec = await prisma.ratePlan.upsert({
      where: {
        utilityId_state_supplier_planName_termMonths_isUtilityTariff: {
          utilityId,
          state,
          supplier: supplier ?? null,
          planName: planName ?? null,
          termMonths: term ?? 0,
          isUtilityTariff: isTariff,
        } as any,
      },
      update: {
        externalId: p.external_id || undefined,
        rate500: toNum(p.rate_500_kwh),
        rate1000: toNum(p.rate_1000_kwh),
        rate2000: toNum(p.rate_2000_kwh),
        cancelFee: p.cancel_fee ?? undefined,
        eflUrl: p.efl_url ?? undefined,
        tosUrl: p.tos_url ?? undefined,
        yracUrl: p.yrac_url ?? undefined,
        isUtilityTariff: isTariff,
        tariffStructure: (p.tariff_structure as any) ?? undefined,
        customerCharge: toNum(p.customer_charge),
        minimumBill: toNum(p.minimum_bill),
        effectiveStart: toDate(p.effective_start),
        effectiveEnd: toDate(p.effective_end),
        sourceRateUrl: p.source_rate_url ?? undefined,
        sourceParentUrl: p.source_parent_url ?? undefined,
        lastSeenAt: new Date(),
      },
      create: {
        externalId: p.external_id || undefined,
        utilityId,
        state,
        supplier: supplier || undefined,
        supplierPUCT: p.supplier_puct || undefined,
        planName: planName || undefined,
        termMonths: term ?? undefined,
        rate500: toNum(p.rate_500_kwh),
        rate1000: toNum(p.rate_1000_kwh),
        rate2000: toNum(p.rate_2000_kwh),
        cancelFee: p.cancel_fee ?? undefined,
        eflUrl: p.efl_url ?? undefined,
        tosUrl: p.tos_url ?? undefined,
        yracUrl: p.yrac_url ?? undefined,
        isUtilityTariff: isTariff,
        tariffStructure: (p.tariff_structure as any) ?? undefined,
        customerCharge: toNum(p.customer_charge),
        minimumBill: toNum(p.minimum_bill),
        effectiveStart: toDate(p.effective_start),
        effectiveEnd: toDate(p.effective_end),
        sourceRateUrl: p.source_rate_url ?? undefined,
        sourceParentUrl: p.source_parent_url ?? undefined,
      },
      select: { id: true, supplier: true, planName: true },
    });

    results.push(rec);
  }

  return { count: results.length, ids: results.map(r => r.id) };
}

function toNum(x: any): number | null {
  const n = Number(x);
  return Number.isFinite(n) ? n : null;
}

function toDate(x: any): Date | undefined {
  const d = x ? new Date(x) : null;
  return d && !isNaN(d.valueOf()) ? d : undefined;
}

