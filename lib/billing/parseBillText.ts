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

import { logOpenAIUsage } from '@/lib/admin/openaiUsage';

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

  // If there is no OpenAI key, just return baseline
  if (!process.env.OPENAI_API_KEY) {
    return baseline;
  }

  let aiResult: OpenAIBillParseResult | null = null;

  try {
    // Dynamic import to avoid bundling OpenAI client in environments
    // where it is not needed (e.g., client bundles).
    const { openai } = await import('@/lib/ai/openai');

    const systemPrompt = `
You are an expert at reading Texas residential electricity bills and extracting structured plan data.
You MUST return ONLY valid JSON that matches the given TypeScript type:

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

  rawText: string;
};

If a field is not clearly present on the bill, set it to null (for scalars) or [] (for arrays).
Do NOT guess or hallucinate missing values.
All money fields must be in CENTS (integer).
All dates must be in ISO format (yyyy-mm-dd) if you can infer them, otherwise null.
`;

    const userPrompt = `
Here is the full text of a residential electricity bill:

----- BILL TEXT START -----
${rawText}
----- BILL TEXT END -----

Hints (may be null):
- esiidHint: ${hints.esiidHint ?? 'null'}
- addressLine1Hint: ${hints.addressLine1Hint ?? 'null'}
- cityHint: ${hints.cityHint ?? 'null'}
- stateHint: ${hints.stateHint ?? 'null'}

Return ONLY a JSON object matching ParsedCurrentPlanPayload (no extra keys, no comments).
`;

    const completion = await openai.chat.completions.create({
      model: 'gpt-4.1-mini',
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userPrompt },
      ],
      temperature: 0,
    });

    // Best-effort usage logging
    const usage = (completion as any).usage;
    if (usage) {
      const inputTokens =
        usage.prompt_tokens ?? usage.input_tokens ?? 0;
      const outputTokens =
        usage.completion_tokens ?? usage.output_tokens ?? 0;
      const totalTokens =
        usage.total_tokens ?? inputTokens + outputTokens;

      // Approximate cost in USD (update if pricing changes)
      // gpt-4.1-mini example pricing assumptions:
      // - input: $0.00025 per 1K tokens
      // - output: $0.00075 per 1K tokens
      const inputCost = (inputTokens / 1000) * 0.00025;
      const outputCost = (outputTokens / 1000) * 0.00075;
      const costUsd = inputCost + outputCost;

      // Fire-and-forget; internal helper swallows errors.
      void logOpenAIUsage({
        module: 'current-plan',
        operation: 'bill-parse-v2',
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

    const content = completion.choices[0]?.message?.content ?? '';
    const jsonStart = content.indexOf('{');
    const jsonEnd = content.lastIndexOf('}');

    if (jsonStart !== -1 && jsonEnd !== -1 && jsonEnd > jsonStart) {
      const jsonText = content.slice(jsonStart, jsonEnd + 1);
      aiResult = JSON.parse(jsonText) as OpenAIBillParseResult;
    }
  } catch (err) {
    // Swallow OpenAI errors and fall back to regex-only.
    console.error('OpenAI bill parse failed; using baseline only', err);
    return baseline;
  }

  if (!aiResult) {
    return baseline;
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

    // always keep rawText from baseline
    rawText: baseline.rawText,
  };

  return merged;
}

