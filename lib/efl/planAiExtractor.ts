/**
 * EFL AI Extraction Layer (Contract Stub)
 *
 * Defines the contract for the AI-powered PlanRules extraction described in
 * docs/EFL_FACT_CARD_ENGINE.md (Step 3). This implementation is intentionally
 * a stub: it does NOT call any AI model yet.
 *
 * Upstream callers must treat this helper as experimental until the real AI
 * integration ships.
 */

import type { PlanRules } from "@/lib/efl/planEngine";

/**
 * Deterministic EFL extract input collected from earlier pipeline stages.
 */
export interface EflTextExtractionInput {
  rawText: string;
  repPuctCertificate: string | null;
  eflVersionCode: string | null;
  eflPdfSha256: string;
}

/**
 * Options for the future AI extractor. These hints are placeholders and may
 * evolve once the real model contract is finalized.
 */
export interface PlanRulesExtractionOptions {
  planTypeHint?: string | null;
  conservative?: boolean;
}

/**
 * Metadata returned with every extraction attempt.
 */
export interface PlanRulesExtractionMeta {
  parseConfidence: number;
  parseWarnings: string[];
  source: "efl_pdf" | string;
}

/**
 * Structured response for an EFL -> PlanRules extraction.
 */
export interface PlanRulesExtractionResult {
  ok: boolean;
  input: EflTextExtractionInput;
  planRules: PlanRules | null;
  meta: PlanRulesExtractionMeta;
  error?: string;
}

/**
 * Contract for AI-based PlanRules extraction. Stub only.
 *
 * Future implementation will:
 *  - Call the configured AI model with a strict prompt.
 *  - Validate the returned PlanRules JSON.
 *  - Populate confidence + warnings.
 */
export async function extractPlanRulesFromEflText(
  input: EflTextExtractionInput,
  opts: PlanRulesExtractionOptions = {},
): Promise<PlanRulesExtractionResult> {
  void opts;

  const meta: PlanRulesExtractionMeta = {
    parseConfidence: 0,
    parseWarnings: [
      "extractPlanRulesFromEflText is not implemented yet; this is a contract stub only.",
    ],
    source: "efl_pdf",
  };

  const errorMessage =
    "extractPlanRulesFromEflText is not implemented yet. " +
    "This is the Step 3a contract stub from docs/EFL_FACT_CARD_ENGINE.md. " +
    "Do not wire this to production until the AI implementation is completed.";

  return {
    ok: false,
    input,
    planRules: null,
    meta,
    error: errorMessage,
  };
}

