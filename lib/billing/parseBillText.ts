export type EnergyRateTier = {
  minKWh: number;
  maxKWh: number | null;
  rateCentsPerKWh: number;
};

export type TimeOfUsePeriod = {
  days: Array<'MON' | 'TUE' | 'WED' | 'THU' | 'FRI' | 'SAT' | 'SUN'>;
  startMinutes: number; // 0–1439
  endMinutes: number; // 0–1439 (can wrap midnight)
  rateCentsPerKWh: number;
};

export type TimeOfUseConfig = {
  periods: TimeOfUsePeriod[];
};

export type BillCreditRule = {
  kind: 'AUTOPAY' | 'PAPERLESS' | 'USAGE_THRESHOLD' | 'FLAT_OTHER';
  amountCents: number;
  minKWh: number | null;
  maxKWh: number | null;
};

export type BillCredits = {
  enabled: boolean;
  rules: BillCreditRule[];
};

export type ParsedCurrentPlanPayload = {
  // Identification / account
  esiid: string | null;
  meterNumber: string | null;
  providerName: string | null;
  tdspName: string | null;
  accountNumber: string | null;

  // Customer + address
  customerName: string | null;
  serviceAddressLine1: string | null;
  serviceAddressLine2: string | null;
  serviceAddressCity: string | null;
  serviceAddressState: string | null;
  serviceAddressZip: string | null;

  // Plan type + contract
  rateType: 'FIXED' | 'VARIABLE' | 'TIME_OF_USE' | 'OTHER' | null;
  variableIndexType: 'ERCOT' | 'FUEL' | 'OTHER' | null;
  planName: string | null;
  termMonths: number | null;
  contractStartDate: string | null; // ISO date or null
  contractEndDate: string | null;
  earlyTerminationFeeCents: number | null;

  // Prices (non-TOU)
  baseChargeCentsPerMonth: number | null;
  energyRateTiers: EnergyRateTier[];

  // TOU + credits
  timeOfUse: TimeOfUseConfig | null;
  billCredits: BillCredits;

  // Billing-cycle meta
  billingPeriodStart: string | null;
  billingPeriodEnd: string | null;
  billIssueDate: string | null;
  billDueDate: string | null;
  totalAmountDueCents: number | null;

  // For debugging / re-parsing
  rawText: string;
};

export type BillParseHints = {
  esiidHint?: string | null;
  addressLine1Hint?: string | null;
  cityHint?: string | null;
  stateHint?: string | null;
};

const ESIID_REGEX = /\b(ESI[\s-]*ID[:\s]*)(\d{17,22})\b/i;
const METER_REGEX = /\b(Meter(?:\s*Number)?[:\s#]*)([A-Za-z0-9\-]+)\b/i;
const PROVIDER_REGEX = /\b(?:Provider|Retail Electric Provider|REP)[:\s]+(.+?)\b/;
const ACCOUNT_REGEX = /\b(Account(?:\s*Number)?[:\s#]*)([A-Za-z0-9\-]+)\b/;

export function extractCurrentPlanFromBillText(
  rawText: string,
  hints: BillParseHints = {},
): ParsedCurrentPlanPayload {
  const text = rawText || '';

  // Basic ESIID
  let esiid: string | null = null;
  const esiidMatch = text.match(ESIID_REGEX);
  if (esiidMatch && esiidMatch[2]) {
    esiid = esiidMatch[2].trim();
  } else if (hints.esiidHint) {
    esiid = hints.esiidHint;
  }

  // Basic meter number
  let meterNumber: string | null = null;
  const meterMatch = text.match(METER_REGEX);
  if (meterMatch && meterMatch[2]) {
    meterNumber = meterMatch[2].trim();
  }

  // Basic provider name (best-effort; can improve later)
  let providerName: string | null = null;
  const providerMatch = text.match(PROVIDER_REGEX);
  if (providerMatch && providerMatch[1]) {
    providerName = providerMatch[1].trim();
  }

  // Account number
  let accountNumber: string | null = null;
  const accountMatch = text.match(ACCOUNT_REGEX);
  if (accountMatch && accountMatch[2]) {
    accountNumber = accountMatch[2].trim();
  }

  // TODO: add smarter parsing for tdspName, planName, TOU windows, bill credits, etc.
  // For now, we return nulls/placeholders so the form can still autofill what we do know.

  const payload: ParsedCurrentPlanPayload = {
    esiid,
    meterNumber,
    providerName,
    tdspName: null,
    accountNumber,

    customerName: null,
    serviceAddressLine1: hints.addressLine1Hint ?? null,
    serviceAddressLine2: null,
    serviceAddressCity: hints.cityHint ?? null,
    serviceAddressState: hints.stateHint ?? null,
    serviceAddressZip: null,

    rateType: null,
    variableIndexType: null,
    planName: null,
    termMonths: null,
    contractStartDate: null,
    contractEndDate: null,
    earlyTerminationFeeCents: null,

    baseChargeCentsPerMonth: null,
    energyRateTiers: [],

    timeOfUse: null,
    billCredits: {
      enabled: false,
      rules: [],
    },

    billingPeriodStart: null,
    billingPeriodEnd: null,
    billIssueDate: null,
    billDueDate: null,
    totalAmountDueCents: null,

    rawText,
  };

  return payload;
}

