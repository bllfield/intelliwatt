import { Buffer } from "node:buffer";

import { factCardAiEnabled, getOpenAiClient } from "@/lib/ai/openaiFactCardParser";
import { logOpenAIUsage } from "@/lib/admin/openaiUsage";
import {
  validateEflAvgPriceTable,
  type EflAvgPriceValidation,
} from "@/lib/efl/eflValidator";
import { planRulesToRateStructure, validatePlanRules } from "@/lib/efl/planEngine";

export interface EflAiParseResult {
  planRules: any | null;
  rateStructure: any | null;
  parseConfidence: number;
  parseWarnings: string[];
  // Validation bag: may include planRules validation issues and/or EFL avg-price validation.
  // We keep this type loose to stay backward-compatible with older callers.
  validation?: any | null;
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

  let removedAverages = false;
  let removedTdu = false;
  let pinCount = 0; // Protect critical pricing component tables.

  const isRepPricingLine = (s: string): boolean =>
    /energy\s*charge/i.test(s) ||
    /usage\s*credit/i.test(s) ||
    /base\s*charge/i.test(s) ||
    /night\s*hours/i.test(s) ||
    /minimum\s*usage\s*fee/i.test(s);

  const isAverageRow = (s: string): boolean => {
    const t = s.trim().toLowerCase();
    return (
      t.startsWith("average monthly use") ||
      t.startsWith("average monthly use:") ||
      t.startsWith("average price per kwh") ||
      t.startsWith("average price per kilowatt-hour") ||
      t.startsWith("average price per kwh:") ||
      t.startsWith("average price per kilowatt-hour:")
    );
  };

  const isTduOnlyLine = (s: string): boolean => {
    const t = s.trim();
    if (!t) return false;
    if (isRepPricingLine(t)) return false;
    return (
      /^tdu\s*delivery\s*charges/i.test(t) ||
      /passed\s*through\s*to\s*customers/i.test(t) ||
      /without\s*markup/i.test(t) ||
      /for\s*updated\s*tdu/i.test(t) ||
      /tdu-charges/i.test(t) ||
      /service\s*tariff/i.test(t) ||
      /underground\s*facilities/i.test(t)
    );
  };

  for (const line of lines) {
    const trimmed = line.trim();
    const lower = trimmed.toLowerCase();

    // Pin region: once we see the "following components" header, keep the next
    // ~20 lines intact (except for exact average rows), even if they contain
    // TDU or other boilerplate, so we never drop the component pricing table.
    if (/following components/i.test(trimmed)) {
      pinCount = 20;
    } else if (pinCount > 0) {
      pinCount -= 1;
    }

    // Drop only the "Average Monthly Use / Average Price per kWh" rows
    // themselves, never the subsequent price components table.
    if (isAverageRow(trimmed)) {
      if (!removedAverages) {
        removedAverages = true;
        const hint =
          "Removed Average Monthly Use / Average Price per kWh table.";
        notes.push(hint);
        droppedHints.push(hint);
      }
      continue;
    }

    // Drop known noisy lines even outside explicit blocks.
    if (/average prices per kwh listed above do not include/i.test(trimmed)) {
      const hint = "Removed average price disclaimer line.";
      notes.push(hint);
      droppedHints.push(hint);
      continue;
    }
    if (pinCount === 0 && isTduOnlyLine(trimmed)) {
      if (!removedTdu) {
        removedTdu = true;
        const hint = "Removed TDU Delivery Charges passthrough block.";
        notes.push(hint);
        droppedHints.push(hint);
      }
      continue;
    }
    if (pinCount === 0 && /sales tax|municipalfees|municipal fees/i.test(lower)) {
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
    if (removedAverages) {
      keptSections.push("Pricing components without Average Monthly Use table.");
    }
    if (removedTdu) {
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

  // Deterministic extraction against the **raw** EFL text. These values are
  // computed before any AI call and later used to fill or override missing
  // pricing components from the model.
  const deterministicBaseCents = extractBaseChargeCents(rawText);
  const deterministicTiers = extractEnergyChargeTiers(rawText);
  const deterministicSingleEnergy = extractSingleEnergyCharge(rawText);
  const deterministicTou = extractWeekdayWeekendTou(rawText);
  const hasDeterministicEnergy =
    deterministicTiers.length > 0 ||
    deterministicSingleEnergy != null ||
    deterministicTou != null;
  const deterministicTdspIncluded = detectTdspIncluded(rawText);
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

  const aiEnabledFlag = factCardAiEnabled();
  const openaiClient = getOpenAiClient();

  // When AI is disabled via flag or missing key, we still want deterministic
  // extraction + validator to run, but we skip any OpenAI calls entirely.
  if (!aiEnabledFlag || !openaiClient) {
    const warnings: string[] = [
      ...baseWarnings,
      "AI_DISABLED_OR_MISSING_KEY: EFL AI text parser is disabled or missing OPENAI_API_KEY.",
    ];

    // Minimal deterministic-only PlanRules: base charge + usage tiers or a
    // single fixed energy rate plus tdspDeliveryIncludedInEnergyCharge flag.
    const planRules: any = {};

    if (deterministicBaseCents != null) {
      planRules.baseChargePerMonthCents = deterministicBaseCents;
    }

    if (deterministicTou) {
      planRules.rateType = "TIME_OF_USE";
      (planRules as any).planType =
        deterministicTou.weekendRateCentsPerKwh === 0 ? "free-weekends" : "tou";
      planRules.defaultRateCentsPerKwh = deterministicTou.weekdayRateCentsPerKwh;
      planRules.timeOfUsePeriods = deterministicTou.periods;

      if (planRules.baseChargePerMonthCents == null) {
        planRules.baseChargePerMonthCents = deterministicTou.baseChargePerMonthCents;
      }
    } else if (deterministicTiers.length > 0) {
      planRules.usageTiers = deterministicTiers;
      planRules.rateType = planRules.rateType ?? "FIXED";
      (planRules as any).planType = (planRules as any).planType ?? "flat";
    } else if (deterministicSingleEnergy != null) {
      planRules.rateType = planRules.rateType ?? "FIXED";
      (planRules as any).planType = (planRules as any).planType ?? "flat";
      planRules.defaultRateCentsPerKwh = deterministicSingleEnergy;
      (planRules as any).currentBillEnergyRateCents = deterministicSingleEnergy;
    }

    // Seasonal percent discount (month-scoped all-day TOU), e.g. Summer Break plans.
    // Apply this in deterministic-only mode too so validation can match EFL avg-price tables
    // even when AI is disabled/missing.
    if (
      (!Array.isArray(planRules.timeOfUsePeriods) ||
        planRules.timeOfUsePeriods.length === 0) &&
      (!Array.isArray(planRules.usageTiers) || planRules.usageTiers.length === 0)
    ) {
      const seasonal = extractSeasonalEnergyDiscount(rawText);
      const baseRate =
        typeof planRules.defaultRateCentsPerKwh === "number" &&
        Number.isFinite(planRules.defaultRateCentsPerKwh)
          ? Number(planRules.defaultRateCentsPerKwh)
          : null;

      if (seasonal && baseRate != null && baseRate > 0) {
        const discMonths = seasonal.months;
        const otherMonths = Array.from({ length: 12 }, (_, i) => i + 1).filter(
          (m) => !discMonths.includes(m),
        );
        const discountedRate = baseRate * (1 - seasonal.discountPct);
        if (Number.isFinite(discountedRate) && discountedRate >= 0) {
          planRules.rateType = "TIME_OF_USE";
          (planRules as any).planType = (planRules as any).planType ?? "tou";
          planRules.timeOfUsePeriods = [
            {
              label: `Seasonal energy discount (${Math.round(
                seasonal.discountPct * 100,
              )}% off)`,
              startHour: 0,
              endHour: 24,
              daysOfWeek: [0, 1, 2, 3, 4, 5, 6],
              months: otherMonths,
              rateCentsPerKwh: baseRate,
              isFree: false,
            },
            {
              label: `Seasonal energy discount (${Math.round(
                seasonal.discountPct * 100,
              )}% off)`,
              startHour: 0,
              endHour: 24,
              daysOfWeek: [0, 1, 2, 3, 4, 5, 6],
              months: discMonths,
              rateCentsPerKwh: discountedRate,
              isFree: false,
            },
          ];
          warnings.push(
            "Deterministic extract detected a seasonal % Energy Charge discount and mapped it to month-scoped TOU periods.",
          );
        }
      }
    }

    // Even in deterministic-only mode, prefer the Disclosure Chart metadata when present.
    // Many EFLs are column-aligned ("Type of Product   Variable Rate") with no colon.
    const { rateType: fallbackRateType, termMonths: fallbackTerm } =
      fallbackExtractRateTypeAndTerm(rawText);

    if (
      fallbackRateType &&
      // Never downgrade explicit TOU classification.
      planRules.rateType !== "TIME_OF_USE"
    ) {
      planRules.rateType = fallbackRateType;
      warnings.push("Fallback filled rateType from 'Type of Product' line.");
      if (!(planRules as any).planType && (fallbackRateType === "FIXED" || fallbackRateType === "VARIABLE")) {
        (planRules as any).planType = "flat";
      }
    }

    if (fallbackTerm != null && typeof (planRules as any).termMonths !== "number") {
      (planRules as any).termMonths = fallbackTerm;
      warnings.push("Fallback filled contract term (months) from 'Contract Term' line.");
    }

    if (deterministicTdspIncluded != null) {
      planRules.tdspDeliveryIncludedInEnergyCharge = deterministicTdspIncluded;
    }

    // Build a canonical RateStructure when we can, so validator + plan engine can run
    // even without AI output.
    let rateStructure: any = null;
    try {
      const prValidation = validatePlanRules(planRules as any);
      if (prValidation?.requiresManualReview !== true) {
        rateStructure = planRulesToRateStructure(planRules as any) as any;
      }
    } catch {
      rateStructure = null;
    }

    let eflAvgPriceValidation: EflAvgPriceValidation | null = null;
    try {
      eflAvgPriceValidation = await validateEflAvgPriceTable({
        rawText,
        planRules,
        rateStructure,
      });
    } catch (err) {
      const msg =
        err instanceof Error ? err.message : String(err ?? "unknown error");
      eflAvgPriceValidation = {
        status: "SKIP",
        toleranceCentsPerKwh: 0.25,
        points: [],
        assumptionsUsed: {},
        fail: false,
        notes: [`Avg price validator error: ${msg}`],
        avgTableFound: false,
      };
    }

    return {
      planRules: Object.keys(planRules).length > 0 ? planRules : null,
      rateStructure,
      parseConfidence: 0,
      parseWarnings: warnings,
      validation: eflAvgPriceValidation
        ? { eflAvgPriceValidation }
        : null,
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
    const client = openaiClient;
    const modelName = process.env.OPENAI_EFL_MODEL || "gpt-4.1";
    const response = await (client as any).responses.create({
      model: modelName,
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

    // Best-effort OpenAI usage logging (feeds /admin/openai/usage).
    // Best-effort OpenAI usage logging (feeds /admin/openai/usage).
    // IMPORTANT: await this so the serverless runtime doesn't drop the write.
    const usage = (response as any)?.usage ?? null;
    const inputTokens = usage?.input_tokens ?? usage?.prompt_tokens ?? 0;
    const outputTokens = usage?.output_tokens ?? usage?.completion_tokens ?? 0;
    const totalTokens = usage?.total_tokens ?? inputTokens + outputTokens;

    // Cost estimation:
    // - We have explicit pricing for gpt-4.1-mini in other modules.
    // - For other models, log tokens and set costUsd=0 (unknown pricing).
    const modelLower = String((response as any)?.model ?? modelName).toLowerCase();
    const isMini = modelLower.includes("mini");
    const inputPer1k = isMini ? 0.00025 : 0;
    const outputPer1k = isMini ? 0.00075 : 0;
    const costUsd =
      (inputTokens / 1000) * inputPer1k + (outputTokens / 1000) * outputPer1k;

    await logOpenAIUsage({
      module: "efl-fact-card",
      operation: "efl-ai-parser-v2",
      model: (response as any)?.model ?? modelName,
      inputTokens,
      outputTokens,
      totalTokens,
      costUsd,
      requestId: (response as any)?.id ?? null,
      metadata: {
        eflPdfSha256,
        usedNormalizedText: true,
        normalizedTextLen: normalizedText.length,
        modelPricingKnown: isMini,
        usagePresent: Boolean(usage),
      },
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
  let warnings: string[] = [
    ...baseWarnings,
    ...filterParseWarnings(modelWarnings),
  ];

  // Normalize planRules/rateStructure so we can safely mutate for fallbacks.
  let planRules: any = parsed.planRules ?? null;
  let rateStructure: any = parsed.rateStructure ?? null;

  if (!planRules || typeof planRules !== "object") {
    planRules = {};
  }
  if (!rateStructure || typeof rateStructure !== "object") {
    rateStructure = {};
  }

  // === Deterministic fallbacks for the "big 3" when the model leaves them empty. ===
  // Always run fallbacks against the original rawText so they can recover values
  // even if the slicer removed or normalized away certain hints.
  const fallbackSourceText = rawText;

  const naRe = /\bN\/A\b|\bNA\b/i;
  const hasExplicitNaOnLine = (labelRe: RegExp): boolean =>
    fallbackSourceText
      .split(/\r?\n/)
      .some((l) => labelRe.test(l) && naRe.test(l));

  // Base Charge ($/month) from deterministic extractor
  if (planRules.baseChargePerMonthCents == null) {
    if (deterministicBaseCents != null) {
      planRules.baseChargePerMonthCents = deterministicBaseCents;
      warnings.push(
        "Deterministic extract filled baseChargePerMonthCents from EFL text (Base Charge line).",
      );
    } else if (
      hasExplicitNaOnLine(/Base\s+Monthly\s+Charge/i) ||
      hasExplicitNaOnLine(/Base\s+Charge/i)
    ) {
      warnings.push("Base monthly charge listed as N/A on EFL.");
    }
  }

  // Usage tiers (energy charge bands)
  const existingTiers: any[] = Array.isArray(planRules.usageTiers)
    ? planRules.usageTiers
    : [];

  if (deterministicTiers.length > 0) {
    const shouldOverrideTiers =
      existingTiers.length === 0 || existingTiers.length < deterministicTiers.length;

    if (shouldOverrideTiers) {
      planRules.usageTiers = deterministicTiers;
      if (!(planRules as any).planType) {
        (planRules as any).planType = "flat";
      }
      warnings.push(
        existingTiers.length === 0
          ? "Deterministic extract filled usageTiers from EFL Energy Charge tier lines."
          : "Deterministic override: populated planRules.usageTiers from EFL tier lines (more complete than AI tiers).",
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
  } else if (
    hasExplicitNaOnLine(/Minimum\s+Usage\s+(Charge|Fee)/i) ||
    hasExplicitNaOnLine(/Residential\s+Usage\s+Credit/i)
  ) {
    // If the EFL explicitly calls these out as N/A, surface that fact instead
    // of implying they are simply missing.
    if (hasExplicitNaOnLine(/Minimum\s+Usage\s+(Charge|Fee)/i)) {
      warnings.push("Minimum usage charge listed as N/A on EFL.");
    }
    if (hasExplicitNaOnLine(/Residential\s+Usage\s+Credit/i)) {
      warnings.push("Residential usage credit listed as N/A on EFL.");
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

  // Prefer the EFL's Disclosure Chart classification when present. Do NOT let
  // earlier "energy charge" heuristics force FIXED when the EFL says VARIABLE.
  if (
    fallbackRateType &&
    (planRules.rateType == null ||
      // Allow VARIABLE to override a previously-inferred FIXED classification.
      (planRules.rateType === "FIXED" && fallbackRateType === "VARIABLE"))
  ) {
    planRules.rateType = fallbackRateType;
    warnings.push("Fallback filled rateType from 'Type of Product' line.");
  }

  // Ensure RateStructure.type tracks a clear FIXED classification when present.
  if (!rateStructure || typeof rateStructure !== "object") {
    rateStructure = {};
  }
  const rs: any = rateStructure;

  if (planRules.rateType === "FIXED") {
    if (!rs.type) {
      rs.type = "FIXED";
    }
  }

  // Plan type mapping for UI classification when missing.
  if (!planRules.planType && fallbackRateType) {
    let inferredPlanType: string | null = null;
    if (fallbackRateType === "FIXED") inferredPlanType = "flat";
    else if (fallbackRateType === "TIME_OF_USE") inferredPlanType = "tou";
    else if (fallbackRateType === "VARIABLE") inferredPlanType = "flat";

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

  const singleEnergy =
    deterministicSingleEnergy ??
    fallbackExtractSingleEnergyChargeCents(fallbackSourceText);

  // Seasonal percentage discount off Energy Charge (month-scoped).
  // Represent as deterministic all-day TOU periods split by months so the plan engine can price it
  // using only monthly total kWh buckets (no time-of-day split required).
  if (
    Array.isArray(planRules.timeOfUsePeriods) === false ||
    (Array.isArray(planRules.timeOfUsePeriods) && planRules.timeOfUsePeriods.length === 0)
  ) {
    const seasonal = extractSeasonalEnergyDiscount(fallbackSourceText);
    if (seasonal && singleEnergy != null && Number.isFinite(singleEnergy)) {
      const discMonths = seasonal.months;
      const otherMonths = Array.from({ length: 12 }, (_, i) => i + 1).filter((m) => !discMonths.includes(m));
      const fullDays = [0, 1, 2, 3, 4, 5, 6];
      const discountedRate = Number(singleEnergy) * (1 - seasonal.discountPct);
      if (Number.isFinite(discountedRate) && discountedRate >= 0) {
        planRules.rateType = "TIME_OF_USE";
        (planRules as any).planType = (planRules as any).planType ?? "tou";
        planRules.defaultRateCentsPerKwh = Number(singleEnergy);
        planRules.timeOfUsePeriods = [
          {
            label: `Seasonal energy discount (${Math.round(seasonal.discountPct * 100)}% off)`,
            startHour: 0,
            endHour: 24,
            daysOfWeek: fullDays,
            months: otherMonths,
            rateCentsPerKwh: Number(singleEnergy),
            isFree: false,
          },
          {
            label: `Seasonal energy discount (${Math.round(seasonal.discountPct * 100)}% off)`,
            startHour: 0,
            endHour: 24,
            daysOfWeek: fullDays,
            months: discMonths,
            rateCentsPerKwh: discountedRate,
            isFree: false,
          },
        ];
        warnings.push(
          "Deterministic extract detected a seasonal % Energy Charge discount and mapped it to month-scoped TOU periods.",
        );
      }
    }
  }

  // Last-resort inference: if we have strong evidence of a single/tiered energy
  // charge but the Disclosure Chart didn't provide a rate type, treat as FIXED.
  if (
    !planRules.rateType &&
    (singleEnergy != null ||
      (Array.isArray(planRules.usageTiers) && planRules.usageTiers.length > 0))
  ) {
    planRules.rateType = "FIXED";
    warnings.push("Fallback inferred rateType=FIXED from Energy Charge line(s).");
  }

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

  // Align RateStructure with FIXED + single-rate information when available.
  if (
    typeof rs.baseMonthlyFeeCents !== "number" &&
    typeof planRules.baseChargePerMonthCents === "number"
  ) {
    rs.baseMonthlyFeeCents = planRules.baseChargePerMonthCents;
  }
  if (
    singleEnergy != null &&
    typeof rs.energyRateCents !== "number" &&
    (!Array.isArray(planRules.usageTiers) ||
      planRules.usageTiers.length === 0)
  ) {
    rs.energyRateCents = singleEnergy;
  }

  // VARIABLE plans: align RateStructure to the canonical contract so validator/persistence
  // can model bills and persist templates safely.
  if (planRules.rateType === "VARIABLE") {
    if (!rs.type) rs.type = "VARIABLE";
    if (
      typeof rs.currentBillEnergyRateCents !== "number" &&
      typeof planRules.currentBillEnergyRateCents === "number"
    ) {
      rs.currentBillEnergyRateCents = planRules.currentBillEnergyRateCents;
    }
    if (
      typeof rs.indexType !== "string" &&
      typeof planRules.variableIndexType === "string"
    ) {
      rs.indexType = planRules.variableIndexType;
    }
  }

  // Normalize + mirror bill credits into RateStructure.
  //
  // Important: Some EFLs have "usage or less" credits (THRESHOLD_MAX). The canonical
  // RateStructure contract uses end-exclusive ranges:
  //   - usage <= N  => maxUsageKWh = N + 1
  //   - usage <  N  => maxUsageKWh = N
  //
  // We do NOT try to preserve any pre-existing rs.billCredits here. If PlanRules has
  // billCredits, we treat PlanRules as the source of truth and regenerate rs.billCredits
  // right before validation/return. This prevents the PlanEngine view from showing
  // "NO_CREDITS" when credits were parsed into PlanRules.
  const syncBillCreditsFromPlanRules = () => {
    if (!Array.isArray(planRules.billCredits) || planRules.billCredits.length === 0) {
      return;
    }

    const normalizedCredits: any[] = [];
    for (const bc of planRules.billCredits as any[]) {
      if (!bc) continue;
      const creditDollars =
        typeof bc.creditDollars === "number"
          ? bc.creditDollars
          : typeof bc.creditDollars === "string"
            ? Number(bc.creditDollars)
            : NaN;
      if (!Number.isFinite(creditDollars) || creditDollars === 0) continue;

      const cloned: any = { ...bc, creditDollars };
      const labelStr = typeof cloned.label === "string" ? cloned.label : "Bill credit";
      cloned.label = labelStr;

      const rawType = typeof cloned.type === "string" ? String(cloned.type).trim() : "";
      const upperType = rawType ? rawType.toUpperCase() : "";

      // For Auto Pay / Paperless behavior credits, thresholdKwh should be null.
      if (
        /auto\s*pay/i.test(labelStr) ||
        /paperless/i.test(labelStr) ||
        (upperType && upperType.includes("BEHAVIOR"))
      ) {
        cloned.thresholdKwh = null;
      }

      normalizedCredits.push(cloned);
    }
    planRules.billCredits = normalizedCredits;

    const bcRules: any[] = [];
    for (const bc of normalizedCredits) {
      const cents = Math.round(Number(bc.creditDollars) * 100);

      const threshold =
        typeof bc.thresholdKwh === "number"
          ? bc.thresholdKwh
          : typeof bc.thresholdKwh === "string"
            ? Number(bc.thresholdKwh)
            : NaN;
      const hasThreshold = Number.isFinite(threshold);

      const label = typeof bc.label === "string" ? bc.label : "Bill credit";
      const rawType = typeof bc.type === "string" ? String(bc.type).trim() : "";
      const upperType = rawType ? rawType.toUpperCase() : "";

      // Infer max-usage semantics from explicit type, or (fallback) from label text.
      const labelSuggestsLe =
        /or\s+less/i.test(label) || /<=/.test(label) || /\bmax(?:imum)?\b/i.test(label);
      const labelSuggestsLt = /less\s+than/i.test(label) || /\bbelow\b/i.test(label) || /</.test(label);

      const isThresholdMax =
        upperType === "THRESHOLD_MAX" ||
        (upperType === "" && (labelSuggestsLe || labelSuggestsLt));

      const isThresholdMin =
        upperType === "THRESHOLD_MIN" ||
        upperType === "USAGE_THRESHOLD" ||
        (upperType === "" && !isThresholdMax && (/\bor\s+more\b/i.test(label) || />=/.test(label)));

      let minUsageKWh: number | null = null;
      let maxUsageKWh: number | null = null;

      if (hasThreshold && isThresholdMax) {
        minUsageKWh = 0;
        // Default to "<=" modeling unless the label explicitly indicates strict "<".
        maxUsageKWh = labelSuggestsLt && !labelSuggestsLe ? threshold : threshold + 1;
      } else if (hasThreshold && isThresholdMin) {
        minUsageKWh = threshold;
        maxUsageKWh = null;
      } else if (hasThreshold) {
        // Back-compat: when we only have a threshold number, treat it as a >= threshold.
        minUsageKWh = threshold;
        maxUsageKWh = null;
      }

      const monthsOfYear =
        Array.isArray(bc.monthsOfYear) && bc.monthsOfYear.length > 0
          ? bc.monthsOfYear
          : undefined;

      bcRules.push({
        label,
        creditAmountCents: cents,
        minUsageKWh,
        maxUsageKWh,
        ...(monthsOfYear ? { monthsOfYear } : {}),
      });
    }

    if (bcRules.length > 0) {
      rs.billCredits = {
        hasBillCredit: true,
        rules: bcRules,
      };
    }
  };

  // TDSP delivery-included flag: prefer deterministic value when present.
  if (deterministicTdspIncluded !== null) {
    (planRules as any).tdspDeliveryIncludedInEnergyCharge =
      deterministicTdspIncluded;
    (rs as any).tdspDeliveryIncludedInEnergyCharge = deterministicTdspIncluded;
  } else if (
    (planRules as any).tdspDeliveryIncludedInEnergyCharge != null &&
    (rs as any).tdspDeliveryIncludedInEnergyCharge == null
  ) {
    // Mirror any AI/populated flag from PlanRules into RateStructure if we
    // don't have a deterministic value but the model provided one.
    (rs as any).tdspDeliveryIncludedInEnergyCharge = (
      planRules as any
    ).tdspDeliveryIncludedInEnergyCharge;
  }

  // Night Hours → time-of-use period (e.g., Free Nights credit window).
  const night = fallbackExtractNightHours(fallbackSourceText);
  if (night) {
    const existingTou = Array.isArray(planRules.timeOfUsePeriods)
      ? planRules.timeOfUsePeriods
      : [];
    if (!existingTou.length) {
      planRules.timeOfUsePeriods = [
        {
          label: "Night Hours Credit",
          startHour: night.startHour,
          endHour: night.endHour,
          daysOfWeek: [0, 1, 2, 3, 4, 5, 6],
          months: undefined,
          rateCentsPerKwh: null,
          isFree: true,
        },
      ];
      warnings.push(
        "Fallback added Night Hours time-of-use period from EFL text.",
      );
    }
  }

  // Weekday/Weekend TOU (common "Free Weekends" EFLs): if the model did not
  // populate timeOfUsePeriods but rawText clearly defines weekday/weekend
  // energy charges, fill it deterministically.
  const tou = extractWeekdayWeekendTou(fallbackSourceText);
  if (tou) {
    const existingTou = Array.isArray(planRules.timeOfUsePeriods)
      ? planRules.timeOfUsePeriods
      : [];
    if (!existingTou.length) {
      planRules.timeOfUsePeriods = tou.periods;
      planRules.defaultRateCentsPerKwh =
        typeof planRules.defaultRateCentsPerKwh === "number"
          ? planRules.defaultRateCentsPerKwh
          : tou.weekdayRateCentsPerKwh;
      // If we successfully extracted TOU periods from raw text, the plan is
      // TIME_OF_USE even if the model mistakenly labeled it FIXED.
      if (planRules.rateType && planRules.rateType !== "TIME_OF_USE") {
        warnings.push(
          `Deterministic override: rateType was '${planRules.rateType}' but rawText clearly defines weekday/weekend TOU; setting rateType=TIME_OF_USE.`,
        );
      }
      planRules.rateType = "TIME_OF_USE";

      const inferredTouPlanType =
        tou.weekendRateCentsPerKwh === 0 ? "free-weekends" : "tou";
      const existingPlanType = (planRules as any).planType;
      if (
        existingPlanType == null ||
        existingPlanType === "flat" ||
        existingPlanType === "other"
      ) {
        (planRules as any).planType = inferredTouPlanType;
      }

      if (planRules.baseChargePerMonthCents == null && tou.baseChargePerMonthCents != null) {
        planRules.baseChargePerMonthCents = tou.baseChargePerMonthCents;
      }

      warnings.push(
        "Fallback added weekday/weekend time-of-use periods from EFL text.",
      );
    }
  }

  // Minimum Usage Fee → negative bill credit rule.
  const minFee = fallbackExtractMinimumUsageFee(fallbackSourceText);
  if (minFee) {
    if (!Array.isArray(planRules.billCredits)) {
      planRules.billCredits = [];
    }
    const alreadyHasMinUsage = (planRules.billCredits as any[]).some(
      (bc) =>
        bc &&
        typeof bc.label === "string" &&
        /Minimum\s*Usage\s*Fee/i.test(bc.label),
    );
    if (!alreadyHasMinUsage) {
      const feeDollars = minFee.feeCents / 100;
      const label = `Minimum Usage Fee $${feeDollars.toFixed(
        2,
      )} if usage < ${minFee.maxKwh} kWh`;
      (planRules.billCredits as any[]).push({
        label,
        creditDollars: -feeDollars,
        thresholdKwh: minFee.maxKwh,
        monthsOfYear: null,
        type: "OTHER",
      });
      warnings.push(
        "Fallback added minimum usage fee as a negative bill credit from EFL text.",
      );
    }
  }

  // ETF formula: capture text like "$15.00 multiplied by the number of months remaining"
  // when the EFL explicitly answers "Do I have a termination fee". This is surfaced as
  // a warning/note only, without introducing new structured fields.
  if (/Do I have a termination fee/i.test(fallbackSourceText)) {
    const etfMatch =
      fallbackSourceText.match(
        /\$([0-9]+(?:\.[0-9]{1,2})?).{0,160}?(multiplied\s+by|each\s+whole\s+month).{0,120}?months?\s+remaining/i,
      ) ?? null;
    if (etfMatch?.[1]) {
      const amt = etfMatch[1];
      warnings.push(
        `Early termination fee: $${amt} × months remaining (per EFL).`,
      );
    }
  }

  // --------------------------------------------------------------------
  // Final deterministic completion for common FIXED plans (Rhythm-style)
  // --------------------------------------------------------------------
  const isFixedFromText =
    /Type\s*of\s*Product\s+Fixed\b/i.test(fallbackSourceText) ||
    /\bType\s*of\s*Product\b.*\bFixed\b/i.test(fallbackSourceText);

  if (isFixedFromText) {
    if (!planRules.rateType) {
      planRules.rateType = "FIXED";
    }
    if (!(planRules as any).planType) {
      (planRules as any).planType = "flat";
    }
    if (!rs.type) {
      rs.type = "FIXED";
    }

    const fixedEnergyFromPlan =
      typeof planRules.currentBillEnergyRateCents === "number" &&
      planRules.currentBillEnergyRateCents > 0
        ? planRules.currentBillEnergyRateCents
        : null;

    if (
      fixedEnergyFromPlan != null &&
      (planRules.defaultRateCentsPerKwh == null ||
        typeof planRules.defaultRateCentsPerKwh !== "number")
    ) {
      planRules.defaultRateCentsPerKwh = fixedEnergyFromPlan;
    }
    if (
      fixedEnergyFromPlan != null &&
      (typeof rs.energyRateCents !== "number" || rs.energyRateCents <= 0)
    ) {
      if (
        !Array.isArray(planRules.usageTiers) ||
        planRules.usageTiers.length === 0
      ) {
        rs.energyRateCents = fixedEnergyFromPlan;
      }
    }
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

  // Ensure RateStructure sees any billCredits we found (including THRESHOLD_MAX).
  syncBillCreditsFromPlanRules();

  const rateType =
    typeof planRules.rateType === "string" ? planRules.rateType : null;

  const termMonths =
    typeof (planRules as any).contractTermMonths === "number"
      ? (planRules as any).contractTermMonths
      : typeof (planRules as any).termMonths === "number"
        ? (planRules as any).termMonths
        : null;

  let computedConfidence = scoreParseConfidence({
    baseChargePerMonthCents,
    usageTiersCount,
    fixedEnergyRateCents,
    billCreditsCount,
    rateType,
    termMonths,
  });

  // Confidence floor: if we have a clear FIXED classification plus an energy
  // rate, ensure the score is at least 60 so UI reflects a reasonably
  // confident parse for simple fixed-rate plans.
  if (
    planRules.rateType === "FIXED" &&
    (typeof planRules.defaultRateCentsPerKwh === "number" ||
      (fixedEnergyRateCents != null && fixedEnergyRateCents > 0))
  ) {
    if (computedConfidence < 60) computedConfidence = 60;
  }

  // Run EFL avg-price validator (best-effort; never crash parser).
  let eflAvgPriceValidation: EflAvgPriceValidation | null = null;
  try {
    eflAvgPriceValidation = await validateEflAvgPriceTable({
      rawText,
      planRules,
      rateStructure: rs,
    });
  } catch (err) {
    const msg =
      err instanceof Error ? err.message : String(err ?? "unknown error");
    eflAvgPriceValidation = {
      status: "SKIP",
      toleranceCentsPerKwh: 0.25,
      points: [],
      assumptionsUsed: {},
      fail: false,
      notes: [`Avg price validator error: ${msg}`],
      avgTableFound: false,
    };
  }

  // If validator PASS, treat this as 100% confidence and prune "no pricing" style
  // warnings that contradict a successful avg-price match.
  if (eflAvgPriceValidation?.status === "PASS") {
    computedConfidence = 100;
    warnings = warnings.filter((w) => {
      if (!w.startsWith("No ")) return true;
      const lower = w.toLowerCase();
      if (lower.includes("energy charge")) return false;
      if (lower.includes("base monthly charge")) return false;
      if (lower.includes("bill credit")) return false;
      if (lower.includes("minimum") && lower.includes("kwh")) return false;
      if (lower.includes("maximum") && lower.includes("kwh")) return false;
      if (lower.includes("usage tiers")) return false;
      if (lower.includes("tiered rates")) return false;
      return true;
    });
  }

  // If deterministic extract already found clear REP energy charges (tiers or
  // a single rate), drop any model warnings that incorrectly claim energy
  // charges are missing.
  if (hasDeterministicEnergy) {
    warnings = warnings.filter(
      (w) =>
        !/no\s+rep[^.]*energy\s+charge/i.test(w) &&
        !/could\s+not\s+find\s+energy\s+charge/i.test(w),
    );
  }

  const dedupedWarnings = Array.from(new Set(warnings));

  // Final normalization: if PlanRules are structurally valid, prefer generating the canonical
  // engine-side RateStructure from PlanRules. This prevents accidental schema drift (e.g. array shapes)
  // from the AI response and keeps template persistence safe.
  try {
    const prValidation = validatePlanRules(planRules as any);
    if (prValidation?.requiresManualReview !== true) {
      rateStructure = planRulesToRateStructure(planRules as any) as any;
    }
  } catch {
    // best-effort only
  }

  const normalizedConfidence = Math.max(
    0,
    Math.min(1, computedConfidence / 100),
  );

  return {
    planRules: planRules ?? null,
    rateStructure: rateStructure ?? null,
    parseConfidence: normalizedConfidence,
    // Domain-level warnings from model are filtered; infra/config errors were
    // returned earlier; deterministic fallback notes are appended verbatim.
    parseWarnings: dedupedWarnings,
    validation: eflAvgPriceValidation
      ? { eflAvgPriceValidation }
      : null,
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
  // Avoid parsing narrative discount lines like:
  // "50 percent discount off the Energy Charge..."
  const looksLikeDiscountLine = (s: string): boolean =>
    /\b(discount|percent|%)\b/i.test(s) && /Energy\s*Charge/i.test(s);

  // Cents-form single rate: "Energy Charge 16.3500 ¢ per kWh"
  {
    const re =
      /Energy\s*Charge[\s:]*([0-9]+(?:\.[0-9]+)?)\s*¢\s*(?:\/|per)\s*kwh/i;
    const m = text.match(re);
    if (m?.[1]) {
      const v = centsStringToNumber(`${m[1]}¢`);
      if (v != null) return v;
    }
  }

  // Dollar-form single rate: "Energy Charge ... $0.1706 per kWh" or "per kWh $0.1706"
  {
    const re =
      /Energy\s*Charge[\s\S]{0,120}?\$\s*([0-9]+(?:\.[0-9]+)?)\s*(?:\/|per)\s*kwh/i;
    const m = text.match(re);
    if (m?.[1]) {
      const dollars = Number(m[1]);
      if (Number.isFinite(dollars)) return dollars * 100;
    }
  }
  {
    const re =
      /Energy\s*Charge[\s\S]{0,120}?(?:\/|per)\s*kwh[^0-9$]{0,30}\$?\s*([0-9]+(?:\.[0-9]+)?)/i;
    const m = text.match(re);
    if (m?.[1]) {
      const n = Number(m[1]);
      if (!Number.isFinite(n)) return null;
      // Heuristic: <=2 is likely $/kWh, otherwise cents/kWh.
      return n <= 2 ? n * 100 : n;
    }
  }

  // Table-style fallback: in many EFLs, "Energy Charge (per kWh)" is a header row
  // and the numeric value appears on a subsequent line (often alongside Base Charge).
  const lines = (text || "")
    .split(/\r?\n/g)
    .map((l) => l.trim())
    .filter((l) => l.length > 0);

  const centsTokenRe = /(\d+(?:\.\d+)?)\s*¢\s*(?:\/\s*kwh|per\s*kwh)/i;
  const dollarTokenRe =
    /\$\s*([0-9]+(?:\.[0-9]+)?)\s*(?:\/\s*kwh|per\s*kwh)/i;
  const dollarAfterHeaderRe =
    /per\s*kwh[^0-9$]{0,30}\$?\s*([0-9]+(?:\.[0-9]+)?)/i;
  const parseAllCentsTokens = (line: string): number[] => {
    const cleaned = line.replace(/,/g, "");
    const hits = Array.from(
      cleaned.matchAll(/(\d+(?:\.\d+)?)\s*¢\s*(?:\/\s*kwh|per\s*kwh)/gi),
    );
    return hits
      .map((h) => (h?.[1] ? Number(h[1]) : NaN))
      .filter((n) => Number.isFinite(n));
  };
  const parseAllDollarTokensToCents = (line: string): number[] => {
    const cleaned = line.replace(/,/g, "");
    const out: number[] = [];
    const hits = Array.from(
      cleaned.matchAll(
        /\$\s*([0-9]+(?:\.[0-9]+)?)\s*(?:\/\s*kwh|per\s*kwh)/gi,
      ),
    );
    for (const h of hits) {
      const dollars = h?.[1] ? Number(h[1]) : NaN;
      if (Number.isFinite(dollars)) out.push(dollars * 100);
    }
    const m2 = cleaned.match(dollarAfterHeaderRe);
    if (m2?.[1]) {
      const n = Number(m2[1]);
      if (Number.isFinite(n)) out.push(n <= 2 ? n * 100 : n);
    }
    return out;
  };

  const energyHeaderIdx = lines.findIndex((l) => /Energy\s*Charge/i.test(l));
  if (energyHeaderIdx >= 0) {
    const candidates: number[] = [];
    for (let j = 1; j <= 10; j++) {
      const candidate = lines[energyHeaderIdx + j];
      if (!candidate) continue;
      if (looksLikeDiscountLine(candidate)) continue;
      // Skip obvious TDSP delivery rows.
      if (/Delivery/i.test(candidate) || /TDSP/i.test(candidate) || /TDU/i.test(candidate)) continue;
      if (centsTokenRe.test(candidate)) {
        candidates.push(...parseAllCentsTokens(candidate));
        continue;
      }
      if (dollarTokenRe.test(candidate) || dollarAfterHeaderRe.test(candidate)) {
        candidates.push(...parseAllDollarTokensToCents(candidate));
        continue;
      }
    }
    if (candidates.length > 0) {
      // Heuristic: REP energy charge is usually >= TDSP ¢/kWh and appears as the larger token.
      const best = Math.max(...candidates);
      if (Number.isFinite(best)) return best;
    }
  }

  return null;
}

// ----------------------------------------------------------------------
// Fallback: Night Hours window (e.g. "Night Hours = 9:00 PM – 7:00 AM")
// ----------------------------------------------------------------------
function fallbackExtractNightHours(text: string): {
  startHour: number;
  endHour: number;
} | null {
  const m =
    text.match(
      /Night\s*Hours\s*=\s*([0-9]{1,2})\s*:\s*([0-9]{2})\s*(AM|PM)\s*[–-]\s*([0-9]{1,2})\s*:\s*([0-9]{2})\s*(AM|PM)/i,
    ) ?? null;
  if (!m) return null;

  const to24 = (hh: string, mm: string, ap: string): number | null => {
    let h = Number(hh);
    const minute = Number(mm);
    if (!Number.isFinite(h) || !Number.isFinite(minute)) return null;
    const isPm = ap.toUpperCase() === "PM";
    if (h === 12) {
      h = isPm ? 12 : 0;
    } else {
      h = isPm ? h + 12 : h;
    }
    return h;
  };

  const start = to24(m[1], m[2], m[3]);
  const end = to24(m[4], m[5], m[6]);
  if (start == null || end == null) return null;
  return { startHour: start, endHour: end };
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
  // Some layouts put the ">" mid-line (e.g., "Price .... > 1200 kWh 20.4000¢"),
  // so we match ">" anywhere in the line instead of only at the start.
  const gtRe = />\s*(\d{1,6})\s*kwh\b[\s:]*([0-9]+(?:\.[0-9]+)?)\s*¢/i;

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
      // For "> N kWh" we treat the tier as starting at N + 1 so that there is
      // no double-counted kWh at the boundary with the previous tier.
      const boundary = Number(m[1]);
      const minKwh = Number.isFinite(boundary) ? boundary + 1 : boundary;
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
// Deterministic extractors (rawText-first) for core pricing components
// ----------------------------------------------------------------------
function extractBaseChargeCents(text: string): number | null {
  // Treat explicit N/A as "not present", not zero.
  if (/Base\s*(?:Monthly\s+)?Charge[^.\n]*\bN\/A\b|\bNA\b/i.test(text)) {
    return null;
  }

  // Variant ordering seen in some EFL tables:
  //   "Base Charge: per month $9.95"
  {
    const m = text.match(
      /\bBase\s*(?:Monthly\s+)?Charge\b\s*:\s*(?:per\s+(?:billing\s*cycle|month)|monthly)[^0-9$]{0,20}\$?\s*([0-9]+(?:\.[0-9]{1,2})?)\b/i,
    );
    if (m?.[1]) {
      const dollars = Number(m[1]);
      if (Number.isFinite(dollars)) return dollarsToCents(String(dollars));
    }
  }

  // Table-style base charge (no "per billing cycle" phrase), e.g. "Base Charge $0.00".
  {
    const m = text.match(
      /\bBase\s*(?:Monthly\s+)?Charge\b[\s:]*\$?\s*([0-9]+(?:\.[0-9]{1,2})?)\b/i,
    );
    if (m?.[1]) {
      const dollars = Number(m[1]);
      if (Number.isFinite(dollars)) {
        return dollarsToCents(String(dollars));
      }
    }
  }

  // Explicit $0 per billing cycle/month.
  if (
    /Base\s*(?:Monthly\s+)?Charge\s*:\s*\$0\b[\s\S]{0,40}?per\s*(?:billing\s*cycle|month)/i.test(
      text,
    )
  ) {
    return 0;
  }

  // Variant: "Base Charge of $4.95 per ESI-ID will apply each billing cycle."
  // Also supports: "Base Charge of $X will apply each billing cycle.",
  // and "Base Charge of $X per ESI-ID ... per billing cycle / per month".
  {
    const ofRe =
      /Base\s+(?:Monthly\s+)?Charge\s+of\s*(?!.*\bN\/A\b)\$?\s*([0-9]+(?:\.[0-9]{1,2})?)\s*(?:per\s+ESI-?ID)?[\s\S]{0,60}?(?:will\s+apply)?\s*(?:each\s+billing\s+cycle|per\s+billing\s+cycle|per\s+month|\/\s*month|monthly)/i;
    const m = text.match(ofRe);
    if (m?.[1]) {
      const dollars = Number(m[1]);
      if (Number.isFinite(dollars)) {
        return dollarsToCents(String(dollars));
      }
    }
  }

  // Existing "Per Month ($)" pattern.
  const fromPerMonth = fallbackExtractBaseChargePerMonthCents(text);
  if (fromPerMonth != null) return fromPerMonth;

  // Generic "Base Charge: $X per billing cycle/month".
  const generic =
    /Base\s*(?:Monthly\s+)?Charge(?:\s*of)?\s*\$?\s*([0-9]+(?:\.[0-9]{1,2})?)\b[\s\S]{0,80}?(?:per\s+(?:billing\s*cycle|month))/i;
  const m = text.match(generic);
  if (m?.[1]) {
    return dollarsToCents(m[1]);
  }

  return null;
}

function extractEnergyChargeTiers(text: string): UsageTier[] {
  // Start with the existing line-based tier extractor.
  const baseTiers = fallbackExtractEnergyChargeTiers(text);
  const extra: UsageTier[] = [];

  // Also handle bracketed Rhythm-style tiers:
  // "Energy Charge: (0 to 1000 kWh) 10.9852¢ per kWh"
  // "Energy Charge: (> 1000 kWh) 12.9852¢ per kWh"
  const re =
    /Energy\s*Charge\s*:\s*\(\s*(>?)\s*([0-9,]+)(?:\s*to\s*([0-9,]+))?\s*kwh\s*\)\s*([0-9]+(?:\.[0-9]+)?)\s*¢\s*(?:per|\/)\s*kwh/gi;

  let m: RegExpExecArray | null;
  while ((m = re.exec(text)) !== null) {
    const isGt = !!m[1];
    const a = Number(m[2].replace(/,/g, ""));
    const b = m[3] ? Number(m[3].replace(/,/g, "")) : null;
    const rate = centsStringToNumber(`${m[4]}¢`);
    if (!Number.isFinite(a) || (b != null && !Number.isFinite(b)) || rate == null) {
      continue;
    }
    // For "(> 1000 kWh)" we treat the tier as starting at 1001 to avoid
    // double-counting at the boundary.
    const minKwh = isGt ? a + 1 : a;
    const maxKwh = isGt ? null : b;
    extra.push({ minKwh, maxKwh, rateCentsPerKwh: rate });
  }

  const all = [...baseTiers, ...extra];
  const uniq = new Map<string, UsageTier>();
  for (const t of all) {
    const key = `${t.minKwh}|${t.maxKwh ?? "null"}|${t.rateCentsPerKwh}`;
    if (!uniq.has(key)) uniq.set(key, t);
  }
  return Array.from(uniq.values()).sort((a, b) => a.minKwh - b.minKwh);
}

function extractSingleEnergyCharge(text: string): number | null {
  return fallbackExtractSingleEnergyChargeCents(text);
}

function extractLineAfterLabel(text: string, labelRegex: RegExp): string | null {
  const lines = String(text ?? "").split(/\r?\n/);
  for (let i = 0; i < lines.length; i++) {
    if (labelRegex.test(lines[i] ?? "")) {
      const cur = lines[i] ?? "";
      const next = lines[i + 1] ?? "";
      return (cur + " " + next).trim();
    }
  }
  return null;
}

function monthNameToNumber(s: string): number | null {
  const t = String(s ?? "").trim().toLowerCase();
  const map: Record<string, number> = {
    january: 1,
    february: 2,
    march: 3,
    april: 4,
    may: 5,
    june: 6,
    july: 7,
    august: 8,
    september: 9,
    october: 10,
    november: 11,
    december: 12,
  };
  return map[t] ?? null;
}

function extractSeasonalEnergyDiscount(text: string): { discountPct: number; months: number[] } | null {
  const raw = String(text ?? "");
  if (!raw.trim()) return null;

  // Example:
  // "You will receive a 50 percent discount off the Energy Charge ... from June 1 ... through September 30 ..."
  const pctMatch = raw.match(/([0-9]{1,3})\s*(?:percent|%)\s*discount\s*off\s*the\s*Energy\s*Charge/i);
  if (!pctMatch?.[1]) return null;
  const pct = Number(pctMatch[1]);
  if (!Number.isFinite(pct) || pct <= 0 || pct >= 100) return null;

  const fromMatch = raw.match(/\bfrom\s+(January|February|March|April|May|June|July|August|September|October|November|December)\s+([0-9]{1,2})/i);
  const throughMatch = raw.match(/\bthrough\s+(January|February|March|April|May|June|July|August|September|October|November|December)\s+([0-9]{1,2})/i);
  if (!fromMatch?.[1] || !throughMatch?.[1]) return null;

  const startMonth = monthNameToNumber(fromMatch[1]);
  const endMonth = monthNameToNumber(throughMatch[1]);
  if (!startMonth || !endMonth) return null;

  // Month-level approximation: include all months touched by the disclosed date range.
  // This keeps the model deterministic and works for most seasonal promotions.
  const months: number[] = [];
  if (startMonth <= endMonth) {
    for (let m = startMonth; m <= endMonth; m++) months.push(m);
  } else {
    for (let m = startMonth; m <= 12; m++) months.push(m);
    for (let m = 1; m <= endMonth; m++) months.push(m);
  }

  return { discountPct: pct / 100, months };
}

function extractWeekdayWeekendTou(text: string): null | {
  weekdayRateCentsPerKwh: number;
  weekendRateCentsPerKwh: number;
  baseChargePerMonthCents: number | null;
  periods: Array<{
    label: string;
    startHour: number;
    endHour: number;
    daysOfWeek: number[];
    months?: number[] | undefined;
    rateCentsPerKwh: number | null;
    isFree: boolean;
  }>;
} {
  // Match a common pricing table pattern, e.g.:
  //   Weekdays 14.4¢/kWh  Weekends 0.0¢/kWh  Base Charge $0.00
  //
  // IMPORTANT: EFLs often mention "Weekdays" in narrative text (e.g., usage
  // assumptions) before the pricing table. So we scan for the *best* window
  // that actually contains weekday/weekend headers + ¢/kWh tokens.
  const lines = String(text ?? "").split(/\r?\n/);
  const tokenRe =
    /([0-9]+(?:\.[0-9]+)?)\s*¢\s*(?:\/\s*kwh|per\s*kwh)/gi;

  let bestWindow: string | null = null;
  for (let i = 0; i < lines.length; i++) {
    const cur = lines[i] ?? "";
    const next = lines[i + 1] ?? "";
    const next2 = lines[i + 2] ?? "";

    // Consider a 2-line and 3-line window because many EFL tables place the
    // Weekdays/Weekends headers on one line and the numeric ¢/kWh values on the
    // following line(s).
    const windows = [
      `${cur} ${next}`.replace(/\s+/g, " ").trim(),
      `${cur} ${next} ${next2}`.replace(/\s+/g, " ").trim(),
    ];

    for (const window of windows) {
      if (!/\bWeekdays?\b/i.test(window)) continue;
      if (!/\bWeekends?\b/i.test(window)) continue;
      const tokens = Array.from(window.matchAll(tokenRe));
      if (tokens.length >= 2) {
        bestWindow = window;
        break;
      }
    }
    if (bestWindow) break;
  }

  const line =
    bestWindow ?? extractLineAfterLabel(text, /\bWeekdays?\b/i) ?? text;
  const cleaned = String(line).replace(/\s+/g, " ");

  let weekdayMatch = cleaned.match(
    /\bWeekdays?\b[\s:]*([0-9]+(?:\.[0-9]+)?)\s*¢\s*(?:\/\s*kwh|per\s*kwh)/i,
  );
  let weekendMatch = cleaned.match(
    /\bWeekends?\b[\s:]*([0-9]+(?:\.[0-9]+)?)\s*¢\s*(?:\/\s*kwh|per\s*kwh)/i,
  );

  // Table variant: some EFLs show "Weekdays / Weekends" as column headers on
  // one line, and the numeric rates on the next line without repeating the
  // labels. In that case, grab the first two ¢/kWh tokens after the header.
  if (!weekdayMatch?.[1] || !weekendMatch?.[1]) {
    const hasHeaders = /\bWeekdays?\b/i.test(cleaned) && /\bWeekends?\b/i.test(cleaned);
    if (hasHeaders) {
      const tokens = Array.from(cleaned.matchAll(tokenRe)).map((m) => m[1]).filter(Boolean);
      if (tokens.length >= 2) {
        weekdayMatch = ["", tokens[0]] as any;
        weekendMatch = ["", tokens[1]] as any;
      } else {
        return null;
      }
    } else {
      return null;
    }
  }

  if (!weekdayMatch?.[1] || !weekendMatch?.[1]) {
    return null;
  }

  const weekdayRate = Number(weekdayMatch[1]);
  const weekendRate = Number(weekendMatch[1]);
  if (!Number.isFinite(weekdayRate) || !Number.isFinite(weekendRate)) {
    return null;
  }

  // Optional base charge in the same table row.
  let baseChargePerMonthCents: number | null = null;
  const baseMatch = cleaned.match(
    /\bBase\s*(?:Monthly\s+)?Charge\b[\s:]*\$?\s*([0-9]+(?:\.[0-9]{1,2})?)/i,
  );
  if (baseMatch?.[1]) {
    const dollars = Number(baseMatch[1]);
    if (Number.isFinite(dollars)) {
      baseChargePerMonthCents = Math.round(dollars * 100);
    }
  }

  const isFreeWeekend = weekendRate === 0;

  const periods = [
    {
      label: "Weekday Energy Charge",
      startHour: 0,
      // Use 24 to represent full-day coverage. This is a plain number field
      // in our CDM; downstream consumers treat this as end-exclusive.
      endHour: 24,
      daysOfWeek: [1, 2, 3, 4, 5], // Mon-Fri
      months: undefined,
      rateCentsPerKwh: weekdayRate,
      isFree: false,
    },
    {
      label: isFreeWeekend ? "Free Weekends" : "Weekend Energy Charge",
      startHour: 0,
      endHour: 24,
      daysOfWeek: [0, 6], // Sun, Sat
      months: undefined,
      rateCentsPerKwh: weekendRate,
      isFree: isFreeWeekend,
    },
  ];

  return {
    weekdayRateCentsPerKwh: weekdayRate,
    weekendRateCentsPerKwh: weekendRate,
    baseChargePerMonthCents,
    periods,
  };
}

// ----------------------------------------------------------------------
// TDSP / TDU "delivery included in energy charge" detector
// ----------------------------------------------------------------------
function detectTdspIncluded(text: string): boolean | null {
  const patterns = [
    /includes\s+all\s+supply\s+and\s+(tdsp|tdu)\s+delivery\s+charges/i,
    /includes\s+all\s+supply\s+and\s+(tdsp|tdu)\s+charges/i,
    /includes\s+all\s+supply\s+and\s+delivery\s+charges/i,
    /includes\s+all\s+(delivery|tdsp|tdu)\s+charges/i,
    /includes[^.\n]{0,80}tdsp[^.\n]{0,80}delivery/i,
  ];
  for (const re of patterns) {
    if (re.test(text)) return true;
  }
  return null;
}

// ----------------------------------------------------------------------
// Fallback: Bill credit threshold
// Matches: "A bill credit of $50 ... usage is 800 kWh or more."
// Stores label + creditDollars + thresholdKwh
// ----------------------------------------------------------------------
type BillCredit = {
  label: string;
  creditDollars: number;
  thresholdKwh: number | null;
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

  // Pattern 3: "Auto Pay & Paperless Credit: $5.00 per month"
  const re3 =
    /Auto\s*Pay\s*&\s*Paperless\s*Credit\s*:\s*\$?\s*([0-9]+(?:\.[0-9]{1,2})?)\b/i;
  const m3 = text.match(re3);
  if (m3?.[1]) {
    const dollars = Number(m3[1]);
    if (Number.isFinite(dollars)) {
      credits.push({
        label: "Auto Pay & Paperless Credit",
        creditDollars: dollars,
        thresholdKwh: 0,
        monthsOfYear: undefined,
        type: "BEHAVIOR",
      });
    }
  }

  // Pattern 4: "Usage Credit for 1,000 kWh or more: $100.00 per month"
  const re4 =
    /Usage\s*Credit\s*for\s*([0-9,]+)\s*kwh\s*or\s*more\s*:\s*\$?\s*([0-9]+(?:\.[0-9]{1,2})?)\b/i;
  const m4 = text.match(re4);
  if (m4?.[1] && m4?.[2]) {
    const threshold = Number(m4[1].replace(/,/g, ""));
    const dollars = Number(m4[2]);
    if (Number.isFinite(threshold) && Number.isFinite(dollars)) {
      credits.push({
        label: `Usage Credit (>= ${threshold} kWh)`,
        creditDollars: dollars,
        thresholdKwh: threshold,
        monthsOfYear: null,
        type: "USAGE_THRESHOLD",
      });
    }
  }

  return credits;
}

// ----------------------------------------------------------------------
// Fallback: Minimum Usage Fee
// ----------------------------------------------------------------------
function fallbackExtractMinimumUsageFee(text: string): {
  feeCents: number;
  maxKwh: number;
} | null {
  const re =
    /Minimum\s*Usage\s*Fee\s*of\s*\$?\s*([0-9]+(?:\.[0-9]{1,2})?)\s*will\s*apply[\s\S]{0,80}?(?:less\s*than|below)\s*(\d{1,6})\s*kwh/i;
  const m = text.match(re);
  if (!m?.[1] || !m?.[2]) return null;
  const dollars = Number(m[1]);
  const kwh = Number(m[2]);
  if (!Number.isFinite(dollars) || !Number.isFinite(kwh)) return null;
  return { feeCents: Math.round(dollars * 100), maxKwh: kwh };
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

  // Some pdftotext outputs render the Disclosure Chart as fixed-width columns,
  // e.g. "Type of Product                                         Variable Rate"
  // (no colon). Support both ":" and multi-space column separators.
  const typeMatch = text.match(
    /^\s*Type\s*of\s*Product(?::|\s+)\s*(.+)$/im,
  );
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

  // Contract term can be "12 Months" or "1 Month" and may also be column-aligned
  // with no colon.
  const termMatch = text.match(
    /^\s*Contract\s*Term(?::|\s+)\s*(\d{1,3})\s*Month(?:s)?\b/im,
  );
  if (termMatch?.[1]) {
    const n = Number(termMatch[1]);
    if (Number.isFinite(n)) termMonths = n;
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

