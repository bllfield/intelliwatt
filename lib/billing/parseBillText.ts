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

