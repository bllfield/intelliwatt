export type Plan = {
  // unified, normalized
  external_id?: string;
  supplier?: string | null;
  supplier_puct?: string | null;
  plan_name?: string | null;
  term_months?: number | null;
  rate_500_kwh?: number | null;
  rate_1000_kwh?: number | null;
  rate_2000_kwh?: number | null;
  cancel_fee?: string | null;
  efl_url?: string | null;
  tos_url?: string | null;
  yrac_url?: string | null;
  utility_id?: string;
  state?: string;

  // tariff extras
  is_utility_tariff?: boolean;
  tariff_structure?: any[] | null;
  customer_charge?: number | null;
  minimum_bill?: number | null;
  effective_start?: string | null;
  effective_end?: string | null;
  source_rate_url?: string | null;
  source_parent_url?: string | null;
};

export function toPlans(payload: any, context: { utilityID: string; state: string }): Plan[] {
  // Two shapes seen:
  // A) REP list: payload is an array of plans
  // B) Tariff list: payload is an object { count, next, data: [...] }
  const { utilityID, state } = context;
  const lowerState = (state || '').toLowerCase();

  if (Array.isArray(payload)) {
    // REP plan shape (keep existing mapping best-effort)
    return payload.map((r: any) => mapRepRow(r, utilityID, lowerState));
  }

  if (payload && Array.isArray(payload.data)) {
    // Tariff shape (City of Lubbock example)
    return payload.data.map((t: any) => mapTariffRow(t, utilityID, lowerState));
  }

  // Unknown/no data
  return [];
}

function mapRepRow(r: any, utilityID: string, state: string): Plan {
  return {
    external_id: first(r.id, r.plan_id)?.toString(),
    supplier: first(r.supplier_name, r.retailer, r.brand) ?? null,
    supplier_puct: first(r.supplier_puct_id, r.puct_id) ?? null,
    plan_name: first(r.plan_name, r.name) ?? null,
    term_months: num(first(r.term_months, r.term)),
    rate_500_kwh: num(first(r.rate_500, r.rate_500_kwh)),
    rate_1000_kwh: num(first(r.rate_1000, r.rate_1000_kwh)),
    rate_2000_kwh: num(first(r.rate_2000, r.rate_2000_kwh)),
    cancel_fee: first(r.cancel_fee, r.early_termination_fee) ?? null,
    efl_url: first(r.efl_url, r.efl) ?? null,
    tos_url: first(r.tos_url, r.tos) ?? null,
    yrac_url: first(r.yrac_url, r.your_rights) ?? null,
    utility_id: utilityID,
    state,
    is_utility_tariff: false,
  };
}

function mapTariffRow(t: any, utilityID: string, state: string): Plan {
  // Example fields from City of Lubbock:
  // _id, utility_id, rate_name, rate_structure[], utility_name, state,
  // source.rate, source.rate_parent, structure, minimum_bill.amount, customer_charge.amount,
  // effective_start_date, effective_end_date
  return {
    external_id: t._id ? String(t._id) : undefined,
    supplier: t.utility_name || null,          // utility is the "supplier" in tariff context
    plan_name: t.rate_name || null,
    utility_id: String(utilityID),
    state,

    // REP-only fields remain null
    term_months: null,
    rate_500_kwh: null,
    rate_1000_kwh: null,
    rate_2000_kwh: null,
    cancel_fee: null,
    efl_url: null,
    tos_url: null,
    yrac_url: null,

    // Tariff flags/extras
    is_utility_tariff: true,
    tariff_structure: Array.isArray(t.rate_structure) ? t.rate_structure : null,
    customer_charge: num(t?.customer_charge?.amount),
    minimum_bill: num(t?.minimum_bill?.amount),
    effective_start: t?.effective_start_date || null,
    effective_end: t?.effective_end_date || null,
    source_rate_url: t?.source?.rate || null,
    source_parent_url: t?.source?.rate_parent || null,
  };
}

function first(...xs: any[]) {
  for (const x of xs) if (x !== undefined && x !== null && x !== '') return x;
  return undefined;
}

function num(x: any): number | null {
  const n = Number(x);
  return Number.isFinite(n) ? n : null;
}

