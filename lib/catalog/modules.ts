export type ModuleDef = {
  id: number
  name: string
  purpose: string
  endpoint?: string
  inputs: string[]
  outputs: string[]
  estDevTime: string
}

export const modulesCatalog: ModuleDef[] = [
  {
    id: 57,
    name: 'WattBuy Probe API',
    purpose: 'Debug/probe WattBuy connectivity by ESID/address',
    endpoint: 'GET /api/wattbuy/probe',
    inputs: ['esiid OR address+city+state+zip'],
    outputs: ['Raw WattBuy offers payload'],
    estDevTime: '0.5d'
  },
  {
    id: 62,
    name: 'Master Plans DB',
    purpose: 'Schema for storing canonical plan offers with normalized join keys',
    inputs: ['Offer JSON', 'Join keys nameId/planId'],
    outputs: ['master_plans rows'],
    estDevTime: '1d'
  },
  {
    id: 63,
    name: 'Ingestion job',
    purpose: 'Nightly ingest WattBuy offers into master_plans',
    inputs: ['Zips', 'Monthly usage profiles'],
    outputs: ['master_plans upserts'],
    estDevTime: '1d'
  },
  {
    id: 64,
    name: 'EFL parser',
    purpose: 'Parse EFL text into structured rate_model JSON',
    inputs: ['EFL PDF/Text'],
    outputs: ['rate_model JSON'],
    estDevTime: '1d'
  },
  {
    id: 65,
    name: 'QA Harness',
    purpose: 'Detect quirks in rate models and disclosures',
    inputs: ['MasterPlan + rate_model'],
    outputs: ['QAFlags'],
    estDevTime: '0.5d'
  },
  {
    id: 66,
    name: 'TDSP corroboration',
    purpose: 'Ingest TDSP delivery charge snapshots',
    inputs: ['TDSP JSON'],
    outputs: ['tdsp_rate_snapshot'],
    estDevTime: '0.5d'
  },
  {
    id: 67,
    name: 'Matcher',
    purpose: 'Link incoming offers to existing MasterPlans',
    inputs: ['Normalized offer'],
    outputs: ['MatchResult'],
    estDevTime: '0.5d'
  },
  {
    id: 68,
    name: 'Cost engine',
    purpose: 'Compute bill given SMT intervals + rate_model + TDSP',
    inputs: ['Intervals', 'RateModel', 'TDSP snapshot'],
    outputs: ['CostBreakdown'],
    estDevTime: '1.5d'
  },
  {
    id: 69,
    name: 'Recommendation API',
    purpose: 'Rank plans and return cost estimates with disclosures',
    endpoint: 'POST /api/recommendations',
    inputs: ['Intervals', 'TDSP', 'Period'],
    outputs: ['Ranked Recommendation[]'],
    estDevTime: '1d'
  },
  {
    id: 70,
    name: 'Results UI',
    purpose: 'User-facing results page with cards, costs, disclosures',
    endpoint: '/results',
    inputs: ['User-provided usage (intervals or monthly kWh)'],
    outputs: ['Rendered plan list with outbound links'],
    estDevTime: '1.5d'
  },
  {
    id: 71,
    name: 'Compliance/Consent',
    purpose: 'Show TX disclaimers and enforce consent gating',
    inputs: ['Checkbox state'],
    outputs: ['Consent gating'],
    estDevTime: '0.5d'
  },
  {
    id: 72,
    name: 'Observability/Audit',
    purpose: 'Log offers shown/selected for payout reconciliation',
    inputs: ['Plan metadata'],
    outputs: ['OfferAudit rows'],
    estDevTime: '1d'
  },
  {
    id: 73,
    name: 'Feature Flags & Supplier Controls',
    purpose: 'Toggle features, blocklist suppliers, rollouts, fallback messaging',
    inputs: ['Flag keys', 'SupplierControl rows'],
    outputs: ['Filtered recommendations'],
    estDevTime: '1.5d'
  },
  {
    id: 74,
    name: 'Module Catalog',
    purpose: 'Document and expose all IntelliWatt modules with metadata',
    endpoint: 'GET /api/admin/modules',
    inputs: ['Module definitions'],
    outputs: ['Module catalog JSON'],
    estDevTime: '0.5d'
  },
  {
    id: 75,
    name: 'EFL Fact Card Engine',
    purpose: 'EFL → PlanRules engine and internal test harness',
    endpoint: '/admin/efl/tests',
    inputs: ['EFL PDF/Text'],
    outputs: ['PlanRules JSON', 'Test harness output'],
    estDevTime: '1d'
  },
  {
    id: 76,
    name: 'EFL Link Runner',
    purpose: 'Vendor-agnostic EFL PDF opener and SHA-256 fingerprint tool',
    endpoint: '/admin/efl/links',
    inputs: ['EFL PDF URL'],
    outputs: ['PDF headers', 'SHA-256 fingerprint'],
    estDevTime: '0.5d'
  },
  {
    id: 77,
    name: 'Plan Analyzer Engine',
    purpose: 'Library harness for per-plan and multi-plan costing',
    endpoint: '/admin/plan-analyzer/tests',
    inputs: ['Synthetic usage', 'PlanRules samples'],
    outputs: ['PlanCostResult JSON', 'PlanComparisonResult JSON'],
    estDevTime: '0.5d'
  }
  // Add future modules here as project evolves
]
