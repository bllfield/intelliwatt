export type ParsedCurrentPlanFields = {
  providerName?: string | null;
  planName?: string | null;
  rateType?: 'FIXED' | 'VARIABLE' | 'TIME_OF_USE' | 'OTHER' | null;
  energyRateCents?: number | null;
  baseMonthlyFeeDollars?: number | null;
  billCreditDollars?: number | null;
  termLengthMonths?: number | null;
  contractEndDate?: string | null;
  earlyTerminationFeeDollars?: number | null;
  esiId?: string | null;
  accountNumberLast4?: string | null;
  notes?: string | null;
  rateStructure?: unknown | null;
};

export type ParseBillTextInput = {
  text: string;
  fileName?: string | null;
  contentType?: string | null;
};

export type ParseBillTextResult = ParsedCurrentPlanFields & {
  parserVersion: string;
  confidenceScore: number | null;
  warnings: string[];
};

/**
 * Very minimal v1 parser.
 *
 * For now we support two modes:
 *  - If the "text" is JSON, we try to parse structured fields directly.
 *  - Otherwise, we return an empty structured result plus a warning.
 *
 * This keeps all logic additive and allows future parsers (PDF/OCR) to evolve
 * without changing the contract consumed by the API and UI.
 */
export function parseBillText(input: ParseBillTextInput): ParseBillTextResult {
  const { text } = input;
  const warnings: string[] = [];

  const base: ParsedCurrentPlanFields = {
    providerName: null,
    planName: null,
    rateType: null,
    energyRateCents: null,
    baseMonthlyFeeDollars: null,
    billCreditDollars: null,
    termLengthMonths: null,
    contractEndDate: null,
    earlyTerminationFeeDollars: null,
    esiId: null,
    accountNumberLast4: null,
    notes: null,
    rateStructure: null,
  };

  const toNumber = (value: unknown): number | null => {
    if (value === null || value === undefined) return null;
    if (typeof value === 'number') return Number.isFinite(value) ? value : null;
    if (typeof value === 'string') {
      const parsed = Number(value);
      return Number.isFinite(parsed) ? parsed : null;
    }
    return null;
  };

  const trimOrNull = (value: unknown): string | null => {
    if (typeof value !== 'string') return null;
    const trimmed = value.trim();
    return trimmed.length > 0 ? trimmed : null;
  };

  let parsedJson: any = null;
  try {
    const maybe = text.trim();
    if (maybe.startsWith('{') && maybe.endsWith('}')) {
      parsedJson = JSON.parse(maybe);
    }
  } catch {
    warnings.push('Bill text looked like JSON but could not be parsed; ignoring JSON mode.');
  }

  if (!parsedJson || typeof parsedJson !== 'object') {
    // Non-JSON mode: just store a snippet in notes for later manual review.
    return {
      ...base,
      notes: null,
      parserVersion: 'bill-text-v1-json-or-empty',
      confidenceScore: null,
      warnings: [
        ...warnings,
        'Bill parser v1 did not detect a structured JSON payload. No fields were auto-filled.',
      ],
    };
  }

  const rateTypeRaw = trimOrNull(parsedJson.rateType) ?? trimOrNull(parsedJson.rate_type);
  const normalizedRateType =
    rateTypeRaw && ['FIXED', 'VARIABLE', 'TIME_OF_USE', 'OTHER'].includes(rateTypeRaw.toUpperCase())
      ? (rateTypeRaw.toUpperCase() as ParsedCurrentPlanFields['rateType'])
      : null;

  const result: ParsedCurrentPlanFields = {
    providerName: trimOrNull(parsedJson.providerName ?? parsedJson.provider_name),
    planName: trimOrNull(parsedJson.planName ?? parsedJson.plan_name),
    rateType: normalizedRateType,
    energyRateCents: toNumber(parsedJson.energyRateCents ?? parsedJson.energy_rate_cents),
    baseMonthlyFeeDollars: toNumber(
      parsedJson.baseMonthlyFeeDollars ??
        parsedJson.base_monthly_fee_dollars ??
        parsedJson.baseMonthlyFee ??
        parsedJson.base_monthly_fee,
    ),
    billCreditDollars: toNumber(
      parsedJson.billCreditDollars ??
        parsedJson.bill_credit_dollars ??
        parsedJson.billCredit ??
        parsedJson.bill_credit,
    ),
    termLengthMonths: (() => {
      const raw = toNumber(
        parsedJson.termLengthMonths ??
          parsedJson.term_length_months ??
          parsedJson.termLength ??
          parsedJson.term_length,
      );
      if (raw === null) return null;
      const rounded = Math.trunc(raw);
      return rounded > 0 ? rounded : null;
    })(),
    contractEndDate:
      trimOrNull(parsedJson.contractEndDate ?? parsedJson.contract_end_date) ?? null,
    earlyTerminationFeeDollars: toNumber(
      parsedJson.earlyTerminationFeeDollars ??
        parsedJson.early_termination_fee_dollars ??
        parsedJson.earlyTerminationFee ??
        parsedJson.early_termination_fee,
    ),
    esiId: trimOrNull(parsedJson.esiId ?? parsedJson.esiid ?? parsedJson.ESIID),
    accountNumberLast4: trimOrNull(
      parsedJson.accountNumberLast4 ??
        parsedJson.account_number_last4 ??
        parsedJson.accountNumber ??
        parsedJson.account_number,
    ),
    notes: trimOrNull(parsedJson.notes),
    rateStructure: parsedJson.rateStructure ?? parsedJson.rate_structure ?? null,
  };

  return {
    ...base,
    ...result,
    parserVersion: 'bill-text-v1-json-or-empty',
    confidenceScore: 0.8,
    warnings,
  };
}


