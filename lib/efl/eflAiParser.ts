import { Buffer } from "node:buffer";

import { openaiFactCardParser } from "@/lib/ai/openaiFactCardParser";

export interface EflAiParseResult {
  planRules: any | null;
  rateStructure: any | null;
  parseConfidence: number;
  parseWarnings: string[];
}

function filterParseWarnings(warnings: string[]): string[] {
  const ignorePatterns = [
    /TDU\b/i,
    /\bTDSP\b/i,
    /transmission and distribution/i,
    /underground facilities and cost recovery/i,
    /sales taxes? (are )?not included/i,
    /non-recurring fees?/i,
    /deposit requirements?/i,
    /terms of service/i,
  ];

  return warnings.filter(
    (w) => !ignorePatterns.some((rx) => rx.test(w)),
  );
}

// Guardrail: the slicer below may ONLY change the AI INPUT text. It must never
// remove or alter any fields from the EflAiParseResult output. If normalization
// produces text that is too small, we fail-open back to the original text.
function normalizeEflTextForAi(rawText: string): {
  text: string;
  notes: string[];
  droppedHints: string[];
  keptSections: string[];
  usedFallback: boolean;
} {
  const lines = rawText.split(/\r?\n/);
  const out: string[] = [];
  const notes: string[] = [];
  const droppedHints: string[] = [];
  const keptSections: string[] = [];

  let skippingAverages = false;
  let skippedAverages = false;
  let skippingTdu = false;
  let skippedTdu = false;

  for (const line of lines) {
    const trimmed = line.trim();
    const lower = trimmed.toLowerCase();

    // Start skipping "Average Monthly Use / Average Price per kWh" block.
    if (!skippingAverages && /average monthly use/i.test(trimmed)) {
      skippingAverages = true;
      skippedAverages = true;
      const hint = "Removed Average Monthly Use / Average Price per kWh table.";
      notes.push(hint);
      droppedHints.push(hint);
      continue;
    }

    if (skippingAverages) {
      // End of averages block: when we hit Base Charge, Type of Product, or Other Key terms.
      if (
        /base charge/i.test(trimmed) ||
        /your average price per kwh/i.test(trimmed) ||
        /^type of product/i.test(lower) ||
        /^other key/i.test(lower) ||
        /^terms and questions/i.test(lower)
      ) {
        skippingAverages = false;
        // Fall through to normal processing for this line.
      } else {
        continue;
      }
    }

    // Start skipping TDU Delivery Charges block.
    if (!skippingTdu && /tdu delivery charges/i.test(trimmed)) {
      skippingTdu = true;
      skippedTdu = true;
      notes.push("Removed TDU Delivery Charges passthrough block.");
      continue;
    }

    if (skippingTdu) {
      // End TDU block at blank or new section headers.
      if (
        trimmed === "" ||
        /^other key/i.test(lower) ||
        /^terms and questions/i.test(lower) ||
        /^type of product/i.test(lower)
      ) {
        skippingTdu = false;
        // Skip the current header line as well if it's just a section transition.
        if (trimmed === "") {
          continue;
        }
      } else {
        continue;
      }
    }

    // Drop known noisy lines even outside explicit blocks.
    if (/average prices per kwh listed above do not include/i.test(trimmed)) {
      const hint = "Removed average price disclaimer line.";
      notes.push(hint);
      droppedHints.push(hint);
      continue;
    }
    if (/for updated tdu delivery charges/i.test(lower)) {
      const hint = "Removed TDU delivery charges URL line.";
      notes.push(hint);
      droppedHints.push(hint);
      continue;
    }
    if (
      /passed through to customer as billed/i.test(lower) &&
      /tdu/i.test(lower)
    ) {
      const hint = "Removed generic TDU passthrough language.";
      notes.push(hint);
      droppedHints.push(hint);
      continue;
    }
    if (/sales tax|municipalfees|municipal fees/i.test(lower)) {
      const hint = "Removed generic tax/municipal fee language.";
      notes.push(hint);
      droppedHints.push(hint);
      continue;
    }

    out.push(line);
  }

  let normalized = out.join("\n");
  let usedFallback = false;

  // Fail-open safeguard: if the normalized text is too short, fall back
  // to the original raw text so downstream consumers still see a full EFL.
  const rawTrimmed = rawText.trim();
  if (normalized.trim().length < 200 && rawTrimmed.length > 0) {
    normalized = rawTrimmed;
    usedFallback = true;
    notes.push(
      "Slicer fallback: normalized EFL text was too short; using original text for AI input.",
    );
  } else {
    if (skippedAverages) {
      keptSections.push("Pricing components without Average Monthly Use table.");
    }
    if (skippedTdu) {
      keptSections.push("REP pricing sections without TDU passthrough blocks.");
    }
  }

  return {
    text: normalized,
    notes: Array.from(new Set(notes)),
    droppedHints: Array.from(new Set(droppedHints)),
    keptSections: Array.from(new Set(keptSections)),
    usedFallback,
  };
}

export async function parseEflTextWithAi(opts: {
  rawText: string;
  eflPdfSha256: string;
  extraWarnings?: string[];
}): Promise<EflAiParseResult> {
  const { rawText, eflPdfSha256, extraWarnings = [] } = opts;
  const {
    text: normalizedText,
    notes: normalizationNotes,
    usedFallback,
  } = normalizeEflTextForAi(rawText);

  const baseWarnings = [...extraWarnings, ...normalizationNotes];
  if (usedFallback) {
    baseWarnings.push(
      "Slicer fail-open: AI input uses original EFL text because normalized text was too short.",
    );
  }

  if (!process.env.OPENAI_IntelliWatt_Fact_Card_Parser) {
    return {
      planRules: null,
      rateStructure: null,
      parseConfidence: 0,
      // Infra/config error → do not filter; keep full message.
      parseWarnings: [
        ...baseWarnings,
        "OPENAI_IntelliWatt_Fact_Card_Parser is not configured; cannot run EFL AI text parser.",
      ],
    };
  }

  const systemPrompt = `
You are an expert Texas Electricity Facts Label (EFL) parser.

You will be given the normalized plain-text contents of an EFL PDF. Using ONLY this normalized text as the source of truth, extract detailed pricing rules into a JSON object with this structure.

CRITICAL GUARDRAILS:
- You MUST NOT guess, approximate, or invent any numeric value (rates, fees, credits, thresholds).
- If the EFL does not clearly provide a value, you MUST leave that field null or omit it,
  and you may include a parse warning instead.
- Do not fill in 'typical' values or make assumptions beyond what the EFL explicitly states.

SCOPE:
- Focus ONLY on REP (retail provider) energy charges, base monthly fees, usage tiers,
  bill credits, and core plan metadata (plan name, Ver. #, PUCT certificate number if present).
- Ignore any “Average Monthly Use / Average Price per kWh” tables.
- Ignore TDU/TDSP delivery charges entirely (handled by the Utility module), including passthrough
  language and underground facility charges.
- Ignore generic taxes/municipal fees and Terms of Service disclaimers unless they directly change
  the recurring REP charges in a way that cannot be represented in the contract.

PRICING COMPONENT FOCUS:
- Base Charge per month ($)
- Energy Charge tiered rates (¢/kWh) with min/max kWh
- Bill credits (e.g., "$50 if usage >= 800 kWh") as billCredits rules
- Product type (Fixed/Variable/TOU)
- Contract term
- Early cancellation fee amount

If any of these pricing components are missing from the normalized text:
- Set the corresponding field(s) to null.
- Add a parse warning describing what could not be extracted.

IDENTITY CONTEXT:
EFL PDF SHA-256: ${eflPdfSha256}

OUTPUT CONTRACT:
(same as the PDF-based contract; see planRules/rateStructure fields below)
`;

  let rawJson = "{}";
  try {
    const response = await (openaiFactCardParser as any).responses.create({
      model: process.env.OPENAI_EFL_MODEL || "gpt-4.1",
      text: { format: { type: "json_object" } },
      input: [
        {
          role: "system",
          content: systemPrompt,
        },
        {
          role: "user",
          content: [
            {
              type: "input_text",
              text: `Here is the normalized EFL text. Use ONLY this text as the source of truth.\n\n${normalizedText}`,
            },
          ],
        },
      ],
    });

    rawJson = (response as any).output?.[0]?.content?.[0]?.text ?? "{}";
  } catch (err: any) {
    const msg =
      err?.message ??
      (typeof err === "object" ? JSON.stringify(err) : String(err));

    return {
      planRules: null,
      rateStructure: null,
      parseConfidence: 0,
      // Infra/API error → do not filter; keep full message.
      parseWarnings: [
        ...baseWarnings,
        `EFL AI text call failed: ${msg}`,
      ],
    };
  }

  let parsed: any;
  try {
    parsed = JSON.parse(rawJson);
  } catch (err) {
    return {
      planRules: null,
      rateStructure: null,
      parseConfidence: 0,
      // JSON parse error → do not filter; keep full message.
      parseWarnings: [
        ...baseWarnings,
        `Failed to parse EFL AI text response JSON: ${
          err instanceof Error ? err.message : String(err)
        }`,
      ],
    };
  }

  const modelWarnings = Array.isArray(parsed.parseWarnings)
    ? parsed.parseWarnings
    : [];

  // Start with model-emitted warnings (domain-level only), then append any
  // deterministic fallback notes we add below. Infrastructure errors were
  // already returned earlier without filtering.
  const warnings: string[] = [
    ...baseWarnings,
    ...filterParseWarnings(modelWarnings),
  ];

  // Normalize planRules/rateStructure so we can safely mutate for fallbacks.
  let planRules: any = parsed.planRules ?? null;
  let rateStructure: any = parsed.rateStructure ?? null;

  if (!planRules || typeof planRules !== "object") {
    planRules = {};
  }

  // === Deterministic fallbacks for the "big 3" when the model leaves them empty. ===
  // Use the same normalizedText we gave to the model so we are operating on the
  // exact input it saw (or the raw text, if the slicer fail-opened).
  const fallbackSourceText = normalizedText;

  // Base Charge ($/month)
  if (planRules.baseChargePerMonthCents == null) {
    const base = fallbackExtractBaseChargePerMonthCents(fallbackSourceText);
    if (base != null) {
      planRules.baseChargePerMonthCents = base;
      warnings.push(
        "Fallback filled baseChargePerMonthCents from EFL text (Base Charge line).",
      );
    }
  }

  // Usage tiers (energy charge bands)
  const existingTiers: any[] = Array.isArray(planRules.usageTiers)
    ? planRules.usageTiers
    : [];

  if (existingTiers.length === 0) {
    const tiers = fallbackExtractEnergyChargeTiers(fallbackSourceText);
    if (tiers.length > 0) {
      planRules.usageTiers = tiers;
      warnings.push(
        "Fallback filled usageTiers from EFL Energy Charge tier lines.",
      );
    }
  }

  // Bill credits (threshold-based)
  const existingBillCredits: any[] = Array.isArray(planRules.billCredits)
    ? planRules.billCredits
    : [];

  if (existingBillCredits.length === 0) {
    const credits = fallbackExtractBillCredits(fallbackSourceText);
    if (credits.length > 0) {
      planRules.billCredits = credits;
      warnings.push(
        "Fallback filled billCredits from 'bill credit if usage >= threshold' line.",
      );
    }
  }

  // If FIXED rate and we now have usage tiers, ensure defaultRateCentsPerKwh
  // is set so callers that only know about a single rate still have a value.
  if (
    planRules.rateType === "FIXED" &&
    Array.isArray(planRules.usageTiers) &&
    planRules.usageTiers.length > 0 &&
    planRules.defaultRateCentsPerKwh == null
  ) {
    const firstTier = planRules.usageTiers[0];
    if (
      firstTier &&
      typeof firstTier.rateCentsPerKwh === "number" &&
      Number.isFinite(firstTier.rateCentsPerKwh)
    ) {
      planRules.defaultRateCentsPerKwh = firstTier.rateCentsPerKwh;
      warnings.push(
        "Fallback set defaultRateCentsPerKwh to first usage tier rate for FIXED plan.",
      );
    }
  }

  // Additional deterministic fallbacks for common single-rate EFLs and
  // metadata fields (Type of Product, Contract Term).
  const { rateType: fallbackRateType, termMonths: fallbackTerm } =
    fallbackExtractRateTypeAndTerm(fallbackSourceText);

  if (!planRules.rateType && fallbackRateType) {
    planRules.rateType = fallbackRateType;
    warnings.push(
      "Fallback filled rateType from 'Type of Product' line.",
    );
  }

  // Plan type mapping for UI classification when missing.
  if (!planRules.planType && fallbackRateType) {
    let inferredPlanType: string | null = null;
    if (fallbackRateType === "FIXED") inferredPlanType = "flat";
    else if (fallbackRateType === "TIME_OF_USE") inferredPlanType = "tou";
    else if (fallbackRateType === "VARIABLE") inferredPlanType = "other";

    if (inferredPlanType) {
      (planRules as any).planType = inferredPlanType;
      warnings.push(
        "Fallback filled planType based on Type of Product classification.",
      );
    }
  }

  if (
    fallbackTerm != null &&
    typeof (planRules as any).termMonths !== "number"
  ) {
    (planRules as any).termMonths = fallbackTerm;
    warnings.push(
      "Fallback filled contract term (months) from 'Contract Term' line.",
    );
  }

  const singleEnergy = fallbackExtractSingleEnergyChargeCents(
    fallbackSourceText,
  );

  if (
    singleEnergy != null &&
    (planRules.currentBillEnergyRateCents == null ||
      typeof planRules.currentBillEnergyRateCents !== "number")
  ) {
    planRules.currentBillEnergyRateCents = singleEnergy;
    warnings.push(
      "Fallback filled currentBillEnergyRateCents from single Energy Charge line.",
    );
  }

  if (
    singleEnergy != null &&
    planRules.rateType === "FIXED" &&
    (planRules.defaultRateCentsPerKwh == null ||
      typeof planRules.defaultRateCentsPerKwh !== "number")
  ) {
    planRules.defaultRateCentsPerKwh = singleEnergy;
    warnings.push(
      "Fallback set defaultRateCentsPerKwh from single Energy Charge line for FIXED plan.",
    );
  }

  // Deterministic parse confidence scoring based on completeness of the key
  // pricing components, rather than trusting the model to self-score.
  const baseChargePerMonthCents =
    typeof planRules.baseChargePerMonthCents === "number"
      ? planRules.baseChargePerMonthCents
      : null;
  const usageTiersCount = Array.isArray(planRules.usageTiers)
    ? planRules.usageTiers.length
    : 0;

  let fixedEnergyRateCents: number | null = null;
  if (planRules.rateType === "FIXED") {
    if (typeof planRules.defaultRateCentsPerKwh === "number") {
      fixedEnergyRateCents = planRules.defaultRateCentsPerKwh;
    } else if (
      Array.isArray(planRules.usageTiers) &&
      planRules.usageTiers.length > 0 &&
      typeof planRules.usageTiers[0]?.rateCentsPerKwh === "number"
    ) {
      fixedEnergyRateCents = planRules.usageTiers[0].rateCentsPerKwh;
    }
  }

  const billCreditsCount = Array.isArray(planRules.billCredits)
    ? planRules.billCredits.length
    : 0;

  const rateType =
    typeof planRules.rateType === "string" ? planRules.rateType : null;

  const termMonths =
    typeof (planRules as any).contractTermMonths === "number"
      ? (planRules as any).contractTermMonths
      : typeof (planRules as any).termMonths === "number"
        ? (planRules as any).termMonths
        : null;

  const computedConfidence = scoreParseConfidence({
    baseChargePerMonthCents,
    usageTiersCount,
    fixedEnergyRateCents,
    billCreditsCount,
    rateType,
    termMonths,
  });

  return {
    planRules: planRules ?? null,
    rateStructure: rateStructure ?? null,
    parseConfidence: computedConfidence,
    // Domain-level warnings from model are filtered; infra/config errors were
    // returned earlier; deterministic fallback notes are appended verbatim.
    parseWarnings: warnings,
  };
}

export async function parseEflPdfWithAi(opts: {
  pdfBytes: Uint8Array | Buffer;
  eflPdfSha256: string;
  rawText?: string;
}): Promise<EflAiParseResult> {
  const { rawText, eflPdfSha256 } = opts;
  const text = (rawText ?? "").trim();

  if (!text) {
    return {
      planRules: null,
      rateStructure: null,
      parseConfidence: 0,
      parseWarnings: [
        "EFL rawText is empty; AI parse skipped.",
      ],
    };
  }

  return parseEflTextWithAi({
    rawText: text,
    eflPdfSha256,
  });
}

// ----------------------------------------------------------------------
// Helper: money string -> cents (e.g. "$9.95" => 995)
// ----------------------------------------------------------------------
function dollarsToCents(dollars: string): number | null {
  const cleaned = dollars.replace(/[^0-9.]/g, "");
  if (!cleaned) return null;
  const n = Number(cleaned);
  if (!Number.isFinite(n)) return null;
  return Math.round(n * 100);
}

// ----------------------------------------------------------------------
// Helper: cents string -> number cents (e.g. "12.5000¢" => 12.5)
// ----------------------------------------------------------------------
function centsStringToNumber(cents: string): number | null {
  const cleaned = cents.replace(/[^0-9.]/g, "");
  if (!cleaned) return null;
  const n = Number(cleaned);
  if (!Number.isFinite(n)) return null;
  return n;
}

// ----------------------------------------------------------------------
// Fallback: Single, non-tiered energy charge (e.g. "Energy Charge 16.3500 ¢ per kWh")
// ----------------------------------------------------------------------
function fallbackExtractSingleEnergyChargeCents(text: string): number | null {
  const re =
    /Energy\s*Charge[\s:]*([0-9]+(?:\.[0-9]+)?)\s*¢?\s*per\s*kwh/i;
  const m = text.match(re);
  if (!m?.[1]) return null;
  return centsStringToNumber(`${m[1]}¢`);
}

// ----------------------------------------------------------------------
// Fallback: Base Charge per month ($)
// Matches: "Base Charge: Per Month ($) $9.95" or similar
// ----------------------------------------------------------------------
function fallbackExtractBaseChargePerMonthCents(text: string): number | null {
  const re =
    /Base\s*Charge[\s\S]{0,80}?Per\s*Month\s*\(\$\)\s*\$?\s*([0-9]+(?:\.[0-9]{1,2})?)/i;
  const m = text.match(re);
  if (!m?.[1]) return null;
  return dollarsToCents(m[1]);
}

// ----------------------------------------------------------------------
// Fallback: Energy Charge tiers
// Matches tier patterns like:
// "0 - 1200 kWh 12.5000¢"
// "> 1200 kWh 20.4000¢"
// Also supports "0-1200" without spaces.
// ----------------------------------------------------------------------
type UsageTier = { minKwh: number; maxKwh: number | null; rateCentsPerKwh: number };

function fallbackExtractEnergyChargeTiers(text: string): UsageTier[] {
  const lines = text.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);

  const tiers: UsageTier[] = [];

  // Range tier: 0 - 1200 kWh 12.5000¢
  const rangeRe =
    /^(\d{1,6})\s*-\s*(\d{1,6})\s*kwh\b[\s:]*([0-9]+(?:\.[0-9]+)?)\s*¢/i;

  // Greater-than tier: > 1200 kWh 20.4000¢
  const gtRe = /^>\s*(\d{1,6})\s*kwh\b[\s:]*([0-9]+(?:\.[0-9]+)?)\s*¢/i;

  // Only consider lines after "Energy Charge" anchor, but fail-open if not found.
  const anchorIdx = lines.findIndex((l) => /Energy\s*Charge/i.test(l));
  const search = anchorIdx >= 0 ? lines.slice(anchorIdx, anchorIdx + 80) : lines;

  for (const l of search) {
    let m = l.match(rangeRe);
    if (m?.[1] && m?.[2] && m?.[3]) {
      const minKwh = Number(m[1]);
      const maxKwh = Number(m[2]);
      const rate = centsStringToNumber(`${m[3]}¢`);
      if (
        Number.isFinite(minKwh) &&
        Number.isFinite(maxKwh) &&
        rate !== null
      ) {
        tiers.push({ minKwh, maxKwh, rateCentsPerKwh: rate });
      }
      continue;
    }

    m = l.match(gtRe);
    if (m?.[1] && m?.[2]) {
      const minKwh = Number(m[1]);
      const rate = centsStringToNumber(`${m[2]}¢`);
      if (Number.isFinite(minKwh) && rate !== null) {
        tiers.push({ minKwh, maxKwh: null, rateCentsPerKwh: rate });
      }
    }
  }

  // De-dup and sort by minKwh
  const uniq = new Map<string, UsageTier>();
  for (const t of tiers) {
    const key = `${t.minKwh}|${t.maxKwh ?? "null"}|${t.rateCentsPerKwh}`;
    if (!uniq.has(key)) uniq.set(key, t);
  }
  return Array.from(uniq.values()).sort((a, b) => a.minKwh - b.minKwh);
}

// ----------------------------------------------------------------------
// Fallback: Bill credit threshold
// Matches: "A bill credit of $50 ... usage is 800 kWh or more."
// Stores label + creditDollars + thresholdKwh
// ----------------------------------------------------------------------
type BillCredit = {
  label: string;
  creditDollars: number;
  thresholdKwh: number;
  monthsOfYear?: number[] | null;
  type?: string | null;
};

function fallbackExtractBillCredits(text: string): BillCredit[] {
  const credits: BillCredit[] = [];

  // Pattern 1: "A bill credit of $50 ... usage is 800 kWh or more."
  const re1 =
    /bill\s+credit\s+of\s+\$?\s*([0-9]+(?:\.[0-9]{1,2})?)\b[\s\S]{0,140}?\busage\s+is\s+(\d{1,6})\s*kwh\s+or\s+more\b/i;
  const m1 = text.match(re1);
  if (m1?.[1] && m1?.[2]) {
    const dollars = Number(m1[1]);
    const threshold = Number(m1[2]);
    if (Number.isFinite(dollars) && Number.isFinite(threshold)) {
      credits.push({
        label: `Bill credit $${dollars} if usage >= ${threshold} kWh`,
        creditDollars: dollars,
        thresholdKwh: threshold,
        monthsOfYear: null,
        type: "THRESHOLD_MIN",
      });
    }
  }

  // Pattern 2: "Usage Credit $125.00 per billing cycle for usage (>=1000) kWh"
  const re2 =
    /Usage\s*Credit[\s:]*\$?\s*([0-9]+(?:\.[0-9]{1,2})?)\b[\s\S]{0,160}?\(\s*>=\s*(\d{1,6})\s*\)\s*kwh/i;
  const m2 = text.match(re2);
  if (m2?.[1] && m2?.[2]) {
    const dollars = Number(m2[1]);
    const threshold = Number(m2[2]);
    if (Number.isFinite(dollars) && Number.isFinite(threshold)) {
      credits.push({
        label: `Usage Credit $${dollars} if usage >= ${threshold} kWh`,
        creditDollars: dollars,
        thresholdKwh: threshold,
        monthsOfYear: null,
        type: "THRESHOLD_MIN",
      });
    }
  }

  return credits;
}

// ----------------------------------------------------------------------
// Fallback: Type of Product + Contract Term
// ----------------------------------------------------------------------
function fallbackExtractRateTypeAndTerm(text: string): {
  rateType: "FIXED" | "VARIABLE" | "TIME_OF_USE" | null;
  termMonths: number | null;
} {
  let rateType: "FIXED" | "VARIABLE" | "TIME_OF_USE" | null = null;
  let termMonths: number | null = null;

  const typeMatch = text.match(/Type\s*of\s*Product\s*:\s*(.+)$/im);
  const typeLine = typeMatch?.[1]?.trim() ?? null;
  if (typeLine) {
    if (/fixed/i.test(typeLine)) {
      rateType = "FIXED";
    } else if (/variable/i.test(typeLine)) {
      rateType = "VARIABLE";
    } else if (
      /time\s*of\s*use|tou|free\s*nights|free\s*weekends/i.test(typeLine)
    ) {
      rateType = "TIME_OF_USE";
    }
  }

  const termMatch = text.match(
    /Contract\s*Term\s*:\s*(\d{1,3})\s*Months?/i,
  );
  if (termMatch?.[1]) {
    const n = Number(termMatch[1]);
    if (Number.isFinite(n)) {
      termMonths = n;
    }
  }

  return { rateType, termMonths };
}

// ----------------------------------------------------------------------
// Deterministic confidence scoring based on completeness
// (0..100 integer)
// ----------------------------------------------------------------------
function scoreParseConfidence(args: {
  baseChargePerMonthCents: number | null | undefined;
  usageTiersCount: number;
  fixedEnergyRateCents: number | null | undefined;
  billCreditsCount: number;
  rateType: string | null | undefined;
  termMonths: number | null | undefined;
}): number {
  let score = 0;

  if (args.baseChargePerMonthCents != null) score += 35;
  if (args.usageTiersCount > 0 || args.fixedEnergyRateCents != null) score += 45;
  if (args.billCreditsCount > 0) score += 10;
  if (args.rateType) score += 5;
  if (args.termMonths != null) score += 5;

  if (score > 100) score = 100;
  if (score < 0) score = 0;
  return Math.round(score);
}

