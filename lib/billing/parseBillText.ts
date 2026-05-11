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

const EFL_VERSION_REGEX = /\bVer\.?\s*#?\s*([A-Za-z0-9][A-Za-z0-9.\-_/]*)\b/i;

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

  // Optional EFL version code (e.g., "Ver. #12345") when the bill text clearly includes it.
  eflVersionCode: string | null;

  // For debugging / re-parsing
  rawText: string;
};

export type BillParseHints = {
  esiidHint?: string | null;
  addressLine1Hint?: string | null;
  cityHint?: string | null;
  stateHint?: string | null;
};

import { logOpenAIUsage } from '@/lib/admin/openaiUsage';

// Bills commonly show:
// - "ESIID: 1044..."
// - "ESI ID: 1044..."
// - "ESI: 1044..."
// Accept all of the above.
const ESIID_REGEX = /\b((?:ESI(?:[\s-]*ID)?)[\s:#]*)(\d{17,22})\b/i;
const METER_INLINE_REGEX = /\bMeter(?:\s*Number)?[:\s#]*([A-Za-z0-9\-]{6,24})\b/i;
const PROVIDER_REGEX = /\b(?:Provider|Retail Electric Provider|REP)[:\s]+([^\n]+)\b/i;
const ACCOUNT_INLINE_REGEX =
  /\bAccount(?:\s*(?:No\.?|Number))?[:\s#]*([A-Za-z0-9\-]{4,24})\b/i;
const ADDRESS_INLINE_REGEX =
  /\bAddress:\s*([^,\n]+),\s*([A-Za-z][A-Za-z.\s'-]+),\s*([A-Z]{2})\s+(\d{5}(?:-\d{4})?)\b/i;
const CITY_STATE_ZIP_REGEX =
  /\b([A-Za-z][A-Za-z.\s'-]+),\s*([A-Z]{2})\s+(\d{5}(?:-\d{4})?)\b/;
const BILLING_PERIOD_REGEX =
  /\bBilling Period:\s*(\d{1,2}\/\d{1,2}\/\d{4})\s*-\s*(\d{1,2}\/\d{1,2}\/\d{4})\b/i;
const INVOICE_DATE_REGEX = /\bInvoice date:\s*([A-Za-z]{3,9}\s+\d{1,2}\s+\d{4})\b/i;
const DUE_DATE_INLINE_REGEX = /\bDue Date[:\s]*([0-9]{1,2}\/[0-9]{1,2}\/[0-9]{4})\b/i;
const DUE_DATE_FALLBACK_REGEX =
  /\b(?:if paid after|paid by due dat)\s*([0-9]{1,2}\/[0-9]{1,2}\/[0-9]{4})\b/i;
const TOTAL_AMOUNT_DUE_REGEX =
  /(?:^|\n)Total Amount Due(?! with)[^\n$]*\$\s*([0-9][0-9,]*\.\d{2})/im;
const AMOUNT_DUE_REGEX = /\bAmount due[^\n$]*\$?\s*([0-9][0-9,]*\.\d{2})\b/i;
const CONTRACT_END_DATE_REGEX =
  /\bestimated contract end date is\s*([0-9]{1,2}\/[0-9]{1,2}\/[0-9]{4})\b/i;
const PROVIDER_NAME_LINE_REGEX =
  /^([A-Za-z][A-Za-z&.'-]*(?:\s+[A-Za-z&.'-]+){0,4}\s+(?:Energy|Electric|Power|Utilities|Utility))$/i;
const STREET_LINE_REGEX =
  /^\d{1,6}[A-Za-z]?(?:\s+[A-Za-z0-9.'#-]+){1,7}$/i;

function normalizeWhitespace(value: string): string {
  return String(value ?? '')
    .replace(/\s+/g, ' ')
    .trim();
}

function toNormalizedLines(text: string): string[] {
  return String(text ?? '')
    .split(/\r?\n/)
    .map((line) => normalizeWhitespace(line))
    .filter(Boolean);
}

function normalizeStreetLine(value: string): string {
  const trimmed = normalizeWhitespace(value).replace(/^Address:\s*/i, '');
  return trimmed.replace(/^0(?=\d{3,5}\b)/, '');
}

function isIgnoredLabeledCandidate(value: string): boolean {
  return /^(reading|information|summary|amount|date|usage|meter|account|invoice|current|previous|actual|multi|total|units|rate)$/i.test(
    normalizeWhitespace(value),
  );
}

function isLikelyMeterNumber(value: string): boolean {
  const candidate = normalizeWhitespace(value);
  if (!candidate || isIgnoredLabeledCandidate(candidate)) return false;
  if (!/[0-9]/.test(candidate)) return false;
  return /^[A-Za-z0-9-]{6,24}$/.test(candidate);
}

function isLikelyAccountNumber(value: string): boolean {
  const candidate = normalizeWhitespace(value);
  if (!candidate || isIgnoredLabeledCandidate(candidate)) return false;
  if (!/[0-9]/.test(candidate)) return false;
  return /^[A-Za-z0-9-]{4,24}$/.test(candidate);
}

function isLikelyStreetLine(value: string): boolean {
  const candidate = normalizeStreetLine(value);
  if (!candidate || !/[0-9]/.test(candidate)) return false;
  if (/^(page|invoice|account|meter|electricity|important|customer service)\b/i.test(candidate)) {
    return false;
  }
  return STREET_LINE_REGEX.test(candidate);
}

function titleCaseWords(value: string): string {
  return normalizeWhitespace(value)
    .toLowerCase()
    .replace(/\b([a-z])/g, (match) => match.toUpperCase());
}

function parseMonthName(monthToken: string): number | null {
  const month = monthToken.toLowerCase();
  const months = [
    'january',
    'february',
    'march',
    'april',
    'may',
    'june',
    'july',
    'august',
    'september',
    'october',
    'november',
    'december',
  ];
  const idx = months.findIndex((name) => name.startsWith(month));
  return idx >= 0 ? idx + 1 : null;
}

function parseDateToIso(value: string): string | null {
  const raw = normalizeWhitespace(value);
  if (!raw) return null;

  const slashMatch = raw.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if (slashMatch) {
    const month = Number(slashMatch[1]);
    const day = Number(slashMatch[2]);
    const year = Number(slashMatch[3]);
    if (month >= 1 && month <= 12 && day >= 1 && day <= 31) {
      return `${String(year).padStart(4, '0')}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
    }
  }

  const monthMatch = raw.match(/^([A-Za-z]{3,9})\s+(\d{1,2})[,]?\s+(\d{4})$/);
  if (monthMatch) {
    const month = parseMonthName(monthMatch[1]);
    const day = Number(monthMatch[2]);
    const year = Number(monthMatch[3]);
    if (month && day >= 1 && day <= 31) {
      return `${String(year).padStart(4, '0')}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
    }
  }

  return null;
}

function parseMoneyToCents(value: string): number | null {
  const normalized = normalizeWhitespace(value).replace(/[$,]/g, '');
  if (!/^-?\d+(?:\.\d{2})?$/.test(normalized)) return null;
  const amount = Number(normalized);
  if (!Number.isFinite(amount)) return null;
  return Math.round(amount * 100);
}

function findValueAfterLabel(
  lines: string[],
  labelRegex: RegExp,
  validator: (value: string) => boolean,
  maxOffset = 3,
): string | null {
  for (let idx = 0; idx < lines.length; idx += 1) {
    if (!labelRegex.test(lines[idx] ?? '')) continue;
    for (let offset = 1; offset <= maxOffset; offset += 1) {
      const candidate = normalizeWhitespace(lines[idx + offset] ?? '');
      if (!candidate) continue;
      if (validator(candidate)) return candidate;
    }
  }
  return null;
}

function extractProviderName(text: string, lines: string[]): string | null {
  const explicit = text.match(PROVIDER_REGEX)?.[1];
  if (explicit) {
    const candidate = normalizeWhitespace(explicit);
    if (candidate && !isIgnoredLabeledCandidate(candidate)) return candidate;
  }

  for (const line of lines.slice(0, 20)) {
    const candidate = normalizeWhitespace(line);
    if (!candidate) continue;
    if (/invoice|summary|details|usage|page \d/i.test(candidate)) continue;
    if (PROVIDER_NAME_LINE_REGEX.test(candidate)) return titleCaseWords(candidate);
  }

  const puctMatch = text.match(/([A-Za-z][A-Za-z&.'-]*(?:\s+[A-Za-z&.'-]+){0,4}\s+(?:Energy|Electric|Power|Utilities|Utility))\s+PUCT Certificate/i);
  if (puctMatch?.[1]) return titleCaseWords(puctMatch[1]);

  const domainMatch = text.match(/\b(?:www\.)?([a-z]+)energy\.com\b/i);
  if (domainMatch?.[1]) {
    return `${titleCaseWords(domainMatch[1])} Energy`;
  }

  return null;
}

function extractAddress(lines: string[], text: string) {
  const inlineMatch = text.match(ADDRESS_INLINE_REGEX);
  let inlineAddress:
    | {
        line1: string | null;
        city: string | null;
        state: string | null;
        zip: string | null;
      }
    | null = null;
  if (inlineMatch) {
    inlineAddress = {
      line1: normalizeStreetLine(inlineMatch[1] ?? ''),
      city: titleCaseWords(inlineMatch[2] ?? ''),
      state: normalizeWhitespace(inlineMatch[3] ?? '').toUpperCase(),
      zip: normalizeWhitespace(inlineMatch[4] ?? ''),
    };
  }

  for (let idx = 0; idx < lines.length; idx += 1) {
    const cityLine = normalizeWhitespace(lines[idx] ?? '');
    const cityMatch = cityLine.match(CITY_STATE_ZIP_REGEX);
    if (!cityMatch) continue;
    const priorLine = normalizeWhitespace(lines[idx - 1] ?? '');
    if (!isLikelyStreetLine(priorLine)) continue;
    return {
      line1: normalizeStreetLine(priorLine),
      city: titleCaseWords(cityMatch[1] ?? ''),
      state: normalizeWhitespace(cityMatch[2] ?? '').toUpperCase(),
      zip: normalizeWhitespace(cityMatch[3] ?? ''),
    };
  }

  return inlineAddress ?? {
    line1: null,
    city: null,
    state: null,
    zip: null,
  };
}

function extractCustomerName(lines: string[]): string | null {
  for (let idx = 1; idx < Math.min(lines.length, 12); idx += 1) {
    const current = normalizeWhitespace(lines[idx] ?? '');
    const next = normalizeWhitespace(lines[idx + 1] ?? '');
    if (!current || !next) continue;
    if (!isLikelyStreetLine(next)) continue;
    if (!/^[A-Z][A-Z\s.'-]+$/.test(current)) continue;
    if (/gexa|energy|invoice|summary|details/i.test(current)) continue;
    return titleCaseWords(current);
  }
  return null;
}

function shouldDiscardLikelyCustomerServiceHoursTou(args: {
  rawText: string;
  timeOfUse: TimeOfUseConfig | null | undefined;
  energyRateTiers: EnergyRateTier[] | null | undefined;
}): boolean {
  const tou = args.timeOfUse;
  if (!tou || !Array.isArray(tou.periods) || tou.periods.length === 0) return false;

  // Only consider dropping very small/simple schedules (the common false-positive shape).
  if (tou.periods.length > 2) return false;

  const t = String(args.rawText ?? '').toLowerCase();
  if (!t) return false;

  // Strong-ish "customer service hours" signal in many bills.
  const hasCustomerServiceContext =
    t.includes('customer service') ||
    t.includes('service@') ||
    t.includes('call ') ||
    t.includes('daily ') ||
    t.includes('am') ||
    t.includes('pm');

  if (!hasCustomerServiceContext) return false;

  // If the bill text contains actual TOU signals, do NOT discard.
  const hasTouKeywords =
    t.includes('time of use') ||
    t.includes('tou') ||
    t.includes('on-peak') ||
    t.includes('off-peak') ||
    t.includes('shoulder') ||
    t.includes('free nights') ||
    t.includes('free weekends') ||
    t.includes('nights free') ||
    t.includes('weekend') ||
    t.includes('solar days');

  if (hasTouKeywords) return false;

  // Customer service hour blocks often look like: "Daily 7:00 AM - 10:00 PM CST"
  const hasDailyHoursPattern = /daily\s+\d{1,2}:\d{2}\s*(am|pm)\s*-\s*\d{1,2}:\d{2}\s*(am|pm)\s*(cst|ct|central)?/i.test(
    args.rawText,
  );
  if (!hasDailyHoursPattern) return false;

  // Heuristic: if the TOU schedule is all-days and looks like business hours, it's likely wrong.
  const allDays = ['MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT', 'SUN'];
  const isAllDays = (days: any) =>
    Array.isArray(days) && allDays.every((d) => days.includes(d));

  const tierRates = (args.energyRateTiers ?? [])
    .map((r) => Number((r as any)?.rateCentsPerKWh))
    .filter((n) => Number.isFinite(n));
  const singleTierRate = tierRates.length ? tierRates[0]! : null;

  const looksLikeBusinessHours = tou.periods.every((p: any) => {
    const start = Number(p?.startMinutes);
    const end = Number(p?.endMinutes);
    const rate = Number(p?.rateCentsPerKWh);
    if (!Number.isFinite(start) || !Number.isFinite(end) || !Number.isFinite(rate)) return false;
    if (!isAllDays(p?.days)) return false;
    // 6:00–9:00am start, 6:00–11:59pm end is a common "office hours" window.
    const startOk = start >= 360 && start <= 540;
    const endOk = end >= 1080 && end <= 1439;
    if (!startOk || !endOk) return false;
    // If TOU rate matches the flat energy rate, even more likely a false positive.
    if (singleTierRate != null && Number.isFinite(singleTierRate)) {
      if (Math.abs(rate - singleTierRate) > 0.01) return false;
    }
    return true;
  });

  return looksLikeBusinessHours;
}

export function extractCurrentPlanFromBillText(
  rawText: string,
  hints: BillParseHints = {},
): ParsedCurrentPlanPayload {
  const text = rawText || '';
  const lines = toNormalizedLines(text);

  // Basic ESIID
  let esiid: string | null = null;
  const esiidMatch = text.match(ESIID_REGEX);
  if (esiidMatch && esiidMatch[2]) {
    esiid = esiidMatch[2].trim();
  } else if (hints.esiidHint) {
    esiid = hints.esiidHint;
  }

  // Basic meter number
  const inlineMeter = text.match(METER_INLINE_REGEX)?.[1] ?? null;
  let meterNumber: string | null = isLikelyMeterNumber(inlineMeter ?? '')
    ? normalizeWhitespace(inlineMeter ?? '')
    : null;
  if (!meterNumber) {
    meterNumber = findValueAfterLabel(
      lines,
      /^Meter(?:\s*Number)?\.?$/i,
      isLikelyMeterNumber,
      2,
    );
  }

  // Basic provider name
  const providerName = extractProviderName(text, lines);

  // Account number
  const inlineAccount = text.match(ACCOUNT_INLINE_REGEX)?.[1] ?? null;
  let accountNumber: string | null = isLikelyAccountNumber(inlineAccount ?? '')
    ? normalizeWhitespace(inlineAccount ?? '')
    : null;
  if (!accountNumber) {
    accountNumber = findValueAfterLabel(
      lines,
      /^Account(?:\s*(?:No\.?|Number))?\.?$/i,
      isLikelyAccountNumber,
      4,
    );
  }

  const address = extractAddress(lines, text);
  const customerName = extractCustomerName(lines);

  const billingPeriodMatch = text.match(BILLING_PERIOD_REGEX);
  const billingPeriodStart = billingPeriodMatch?.[1]
    ? parseDateToIso(billingPeriodMatch[1])
    : null;
  const billingPeriodEnd = billingPeriodMatch?.[2]
    ? parseDateToIso(billingPeriodMatch[2])
    : null;

  const invoiceDateRaw = text.match(INVOICE_DATE_REGEX)?.[1] ?? null;
  const dueDateRaw =
    text.match(DUE_DATE_INLINE_REGEX)?.[1] ??
    text.match(DUE_DATE_FALLBACK_REGEX)?.[1] ??
    null;
  const totalAmountDueRaw =
    text.match(TOTAL_AMOUNT_DUE_REGEX)?.[1] ??
    text.match(AMOUNT_DUE_REGEX)?.[1] ??
    null;
  const contractEndDateRaw = text.match(CONTRACT_END_DATE_REGEX)?.[1] ?? null;

  // TODO: add smarter parsing for tdspName, planName, TOU windows, bill credits, etc.
  // For now, we return nulls/placeholders so the form can still autofill what we do know.

  // Best-effort extraction of an EFL version code when the bill includes a "Ver." identifier.
  let eflVersionCode: string | null = null;
  const verMatch = text.match(EFL_VERSION_REGEX);
  if (verMatch && verMatch[1]) {
    eflVersionCode = verMatch[1].trim();
  }

  const payload: ParsedCurrentPlanPayload = {
    esiid,
    meterNumber,
    providerName,
    tdspName: null,
    accountNumber,

    customerName,
    serviceAddressLine1: address.line1 ?? hints.addressLine1Hint ?? null,
    serviceAddressLine2: null,
    serviceAddressCity: address.city ?? hints.cityHint ?? null,
    serviceAddressState: address.state ?? hints.stateHint ?? null,
    serviceAddressZip: address.zip,

    rateType: null,
    variableIndexType: null,
    planName: null,
    termMonths: null,
    contractStartDate: null,
    contractEndDate: contractEndDateRaw ? parseDateToIso(contractEndDateRaw) : null,
    earlyTerminationFeeCents: null,

    baseChargeCentsPerMonth: null,
    energyRateTiers: [],

    timeOfUse: null,
    billCredits: {
      enabled: false,
      rules: [],
    },

    billingPeriodStart,
    billingPeriodEnd,
    billIssueDate: invoiceDateRaw ? parseDateToIso(invoiceDateRaw) : null,
    billDueDate: dueDateRaw ? parseDateToIso(dueDateRaw) : null,
    totalAmountDueCents: totalAmountDueRaw ? parseMoneyToCents(totalAmountDueRaw) : null,

    rawText,
    eflVersionCode,
  };

  return payload;
}

// Simple field merge helper: prefer b when it’s not null/undefined, else a.
function prefer<T>(
  a: T | null | undefined,
  b: T | null | undefined,
): T | null | undefined {
  if (b !== null && b !== undefined) return b;
  return a;
}

// This is the shape we expect back from OpenAI: a ParsedCurrentPlanPayload-like object.
export type OpenAIBillParseResult = ParsedCurrentPlanPayload;

// Async function that calls OpenAI and merges results over the regex baseline.
export async function extractCurrentPlanFromBillTextWithOpenAI(
  rawText: string,
  hints: BillParseHints = {},
): Promise<ParsedCurrentPlanPayload> {
  // First pass: existing regex-based parser
  const baseline = extractCurrentPlanFromBillText(rawText, hints);

  let aiResult: OpenAIBillParseResult | null = null;

  try {
    const {
      billParserAiEnabled,
      getOpenAiBillClient,
    } = await import("@/lib/ai/openaiBillParser");

    // Feature flag: if Bill Parser AI is disabled, fall back to baseline-only.
    if (!billParserAiEnabled()) {
      return baseline;
    }

    const openaiBillParser = getOpenAiBillClient();
    if (!openaiBillParser) {
      // No usable API key configured; fall back to baseline-only behaviour.
      return baseline;
    }

    const systemPrompt = `
You are an expert at reading Texas residential electricity bills and extracting structured plan data.

Your job:
- Interpret the bill as precisely as possible.
- Recover the FULL contract-level structure for the plan:
  • rateType
  • base charges
  • energy rate tiers
  • time-of-use windows
  • bill credits (autopay, paperless, usage-based)
- Fill in as MANY details as the bill explicitly or implicitly provides.
- When the bill clearly defines a TOU or tiered structure, you MUST translate it into the structured fields below.
- When the bill includes phrases like "On-peak", "Off-peak", "Shoulder", "Solar days", "Free nights", etc.,
  map those to TimeOfUsePeriod entries with correct days + minutes + rates.
- When usage-based bill credits are present (e.g. "Credit of $20 when usage between 1000-1200 kWh"),
  encode them as BillCreditRule entries.
- IMPORTANT: Do NOT interpret "Customer Service" / "Customer Care" contact hours (e.g. "Daily 7:00 AM - 10:00 PM CST")
  as time-of-use pricing. Only create timeOfUse.periods when the bill explicitly indicates different energy prices
  by time/day (on-peak/off-peak/free nights/weekends) and provides corresponding energy rates.

You MUST return ONLY valid JSON that matches this TypeScript type:

type EnergyRateTier = {
  minKWh: number;
  maxKWh: number | null;
  rateCentsPerKWh: number;
};

type TimeOfUsePeriod = {
  days: Array<'MON' | 'TUE' | 'WED' | 'THU' | 'FRI' | 'SAT' | 'SUN'>;
  startMinutes: number; // 0–1439
  endMinutes: number;   // 0–1439
  rateCentsPerKWh: number;
};

type TimeOfUseConfig = {
  periods: TimeOfUsePeriod[];
};

type BillCreditRule = {
  kind: 'AUTOPAY' | 'PAPERLESS' | 'USAGE_THRESHOLD' | 'FLAT_OTHER';
  amountCents: number;
  minKWh: number | null;
  maxKWh: number | null;
};

type BillCredits = {
  enabled: boolean;
  rules: BillCreditRule[];
};

                type ParsedCurrentPlanPayload = {
                esiid: string | null;
                meterNumber: string | null;
                providerName: string | null;
                tdspName: string | null;
                accountNumber: string | null;

                customerName: string | null;
                serviceAddressLine1: string | null;
                serviceAddressLine2: string | null;
                serviceAddressCity: string | null;
                serviceAddressState: string | null;
                serviceAddressZip: string | null;

                rateType: 'FIXED' | 'VARIABLE' | 'TIME_OF_USE' | 'OTHER' | null;
                variableIndexType: 'ERCOT' | 'FUEL' | 'OTHER' | null;
                planName: string | null;
                termMonths: number | null;
                contractStartDate: string | null;  // ISO date
                contractEndDate: string | null;
                earlyTerminationFeeCents: number | null;

                baseChargeCentsPerMonth: number | null;
                energyRateTiers: EnergyRateTier[];

                timeOfUse: TimeOfUseConfig | null;
                billCredits: BillCredits;

                billingPeriodStart: string | null;
                billingPeriodEnd: string | null;
                billIssueDate: string | null;
                billDueDate: string | null;
                totalAmountDueCents: number | null;

                // Optional EFL version code when the bill text clearly includes a "Ver." identifier.
                eflVersionCode: string | null;

                rawText: string;
                };

Rules:
- If a field is clearly present, you MUST fill it.
- If TOU logic is present (e.g. different prices at different times of day or days of week),
  you MUST express it in timeOfUse.periods.
- If bill credits are present (autopay, paperless, usage thresholds), set billCredits.enabled = true
  and include appropriate rules.
- If a value truly does not appear anywhere, set it to null (for scalars) or [] (for arrays).
- Do NOT invent imaginary products or charges not supported by the text.
- All money fields must be in CENTS (integer).
- All dates must be in ISO format (yyyy-mm-dd) if you can infer them, otherwise null.
`;

    const hintSummary = `
Hints (may be null):
- esiidHint: ${hints.esiidHint ?? 'null'}
- addressLine1Hint: ${hints.addressLine1Hint ?? 'null'}
- cityHint: ${hints.cityHint ?? 'null'}
- stateHint: ${hints.stateHint ?? 'null'}
`;

    const userPrompt = `
Here is the full text of a residential electricity bill:

----- BILL TEXT START -----
${rawText}
----- BILL TEXT END -----

${hintSummary}

Return ONLY a JSON object matching ParsedCurrentPlanPayload (no extra keys, no comments).
`;

    const completion = await (openaiBillParser as any).chat.completions.create({
      model: "gpt-4.1-mini",
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: userPrompt },
      ],
      temperature: 0,
      response_format: { type: "json_object" },
    });

    const usage = (completion as any).usage;
    if (usage) {
      const inputTokens = usage.prompt_tokens ?? usage.input_tokens ?? 0;
      const outputTokens = usage.completion_tokens ?? usage.output_tokens ?? 0;
      const totalTokens = usage.total_tokens ?? inputTokens + outputTokens;

      const inputCost = (inputTokens / 1000) * 0.00025;
      const outputCost = (outputTokens / 1000) * 0.00075;
      const costUsd = inputCost + outputCost;

      await logOpenAIUsage({
        module: 'current-plan',
        operation: 'bill-parse-v3-json',
        model: (completion as any).model ?? 'gpt-4.1-mini',
        inputTokens,
        outputTokens,
        totalTokens,
        costUsd,
        requestId: (completion as any).id ?? null,
        userId: null,
        houseId: null,
        metadata: {
          source: 'bill-parse-text',
        },
      });
    }

    const content = completion.choices[0]?.message?.content ?? "";
    if (!content) {
      return baseline;
    }

    aiResult = JSON.parse(content) as OpenAIBillParseResult;
  } catch (err) {
    // Swallow OpenAI errors and fall back to regex-only.
    console.error('OpenAI bill parse failed; using baseline only', err);
    return baseline;
  }

  if (!aiResult) {
    return baseline;
  }

  // Basic numeric sanity guards
  const clampMoney = (value: number | null | undefined, maxCents: number): number | null => {
    if (value == null) return null;
    if (!Number.isFinite(value)) return null;
    if (value < 0) return null;
    if (value > maxCents) return null;
    return Math.round(value);
  };

  aiResult.baseChargeCentsPerMonth = clampMoney(aiResult.baseChargeCentsPerMonth, 500_00); // ≤ $500
  aiResult.earlyTerminationFeeCents = clampMoney(aiResult.earlyTerminationFeeCents, 1_000_00); // ≤ $1000
  aiResult.totalAmountDueCents = clampMoney(aiResult.totalAmountDueCents, 5_000_00); // ≤ $5000

  if (aiResult.timeOfUse && Array.isArray(aiResult.timeOfUse.periods)) {
    aiResult.timeOfUse.periods = aiResult.timeOfUse.periods
      .map((p) => {
        const start = Math.max(0, Math.min(1439, (p as any).startMinutes ?? 0));
        const end = Math.max(0, Math.min(1439, (p as any).endMinutes ?? 0));
        return { ...p, startMinutes: start, endMinutes: end };
      })
      .filter((p) => Number.isFinite((p as any).rateCentsPerKWh) && (p as any).rateCentsPerKWh >= 0);
  }

  // Guardrail: customer-service contact hours are frequently misread as TOU pricing windows.
  // Drop suspicious TOU schedules so FIXED plans don't get polluted with fake periods.
  if (shouldDiscardLikelyCustomerServiceHoursTou({
    rawText,
    timeOfUse: aiResult.timeOfUse,
    energyRateTiers: aiResult.energyRateTiers,
  })) {
    aiResult.timeOfUse = null;
    if (aiResult.rateType === 'TIME_OF_USE') {
      // Best-effort: if we also have a usable tiered rate, treat as FIXED instead of TOU.
      if (Array.isArray(aiResult.energyRateTiers) && aiResult.energyRateTiers.length > 0) {
        aiResult.rateType = 'FIXED';
      }
    }
  }

  if (!aiResult.billCredits) {
    aiResult.billCredits = { enabled: false, rules: [] };
  } else if (!Array.isArray(aiResult.billCredits.rules)) {
    aiResult.billCredits.rules = [];
  }

  // Merge baseline (regex) + AI (OpenAI) — AI wins when it provides something.
  const merged: ParsedCurrentPlanPayload = {
    // identification
    esiid: prefer(baseline.esiid, aiResult.esiid) ?? null,
    meterNumber: prefer(baseline.meterNumber, aiResult.meterNumber) ?? null,
    providerName: prefer(baseline.providerName, aiResult.providerName) ?? null,
    tdspName: prefer(baseline.tdspName, aiResult.tdspName) ?? null,
    accountNumber: prefer(baseline.accountNumber, aiResult.accountNumber) ?? null,

    // customer + address
    customerName: prefer(baseline.customerName, aiResult.customerName) ?? null,
    serviceAddressLine1:
      prefer(baseline.serviceAddressLine1, aiResult.serviceAddressLine1) ?? null,
    serviceAddressLine2:
      prefer(baseline.serviceAddressLine2, aiResult.serviceAddressLine2) ?? null,
    serviceAddressCity:
      prefer(baseline.serviceAddressCity, aiResult.serviceAddressCity) ?? null,
    serviceAddressState:
      prefer(baseline.serviceAddressState, aiResult.serviceAddressState) ?? null,
    serviceAddressZip:
      prefer(baseline.serviceAddressZip, aiResult.serviceAddressZip) ?? null,

    // plan type + contract
    rateType: (aiResult.rateType ?? baseline.rateType) ?? null,
    variableIndexType:
      (aiResult.variableIndexType ?? baseline.variableIndexType) ?? null,
    planName: prefer(baseline.planName, aiResult.planName) ?? null,
    termMonths: prefer(baseline.termMonths, aiResult.termMonths) ?? null,
    contractStartDate:
      prefer(baseline.contractStartDate, aiResult.contractStartDate) ?? null,
    contractEndDate:
      prefer(baseline.contractEndDate, aiResult.contractEndDate) ?? null,
    earlyTerminationFeeCents:
      prefer(
        baseline.earlyTerminationFeeCents,
        aiResult.earlyTerminationFeeCents,
      ) ?? null,

    // base + tiers
    baseChargeCentsPerMonth:
      prefer(baseline.baseChargeCentsPerMonth, aiResult.baseChargeCentsPerMonth) ??
      null,
    energyRateTiers:
      aiResult.energyRateTiers?.length
        ? aiResult.energyRateTiers
        : baseline.energyRateTiers,

    // TOU and credits
    timeOfUse: aiResult.timeOfUse ?? baseline.timeOfUse,
    billCredits: aiResult.billCredits ?? baseline.billCredits,

    // billing cycle meta
    billingPeriodStart:
      prefer(baseline.billingPeriodStart, aiResult.billingPeriodStart) ?? null,
    billingPeriodEnd:
      prefer(baseline.billingPeriodEnd, aiResult.billingPeriodEnd) ?? null,
    billIssueDate:
      prefer(baseline.billIssueDate, aiResult.billIssueDate) ?? null,
    billDueDate: prefer(baseline.billDueDate, aiResult.billDueDate) ?? null,
    totalAmountDueCents:
      prefer(baseline.totalAmountDueCents, aiResult.totalAmountDueCents) ?? null,

    // EFL version code (if any) is carried forward from either baseline or AI.
    eflVersionCode:
      prefer(baseline.eflVersionCode, aiResult.eflVersionCode) ?? null,

    // always keep rawText from baseline
    rawText: baseline.rawText,
  };

  return merged;
}

