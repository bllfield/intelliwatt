import { Buffer } from "node:buffer";

import { deterministicEflExtract } from "@/lib/efl/eflExtractor";
import {
  EflAiParseResult,
  parseEflTextWithAi,
} from "@/lib/efl/eflAiParser";
import {
  getTemplateKey,
  type EflTemplateKeyResult,
} from "@/lib/efl/templateIdentity";

export type GetOrCreateEflTemplateInput =
  | {
      source: "manual_upload";
      pdfBytes: Buffer;
      filename?: string | null;
    }
  | {
      source: "wattbuy";
      rawText: string;
      eflPdfSha256?: string | null;
      repPuctCertificate?: string | null;
      eflVersionCode?: string | null;
      wattbuy?:
        | {
            providerName?: string | null;
            planName?: string | null;
            termMonths?: number | null;
            tdspName?: string | null;
            offerId?: string | null;
          }
        | null;
    };

type EflTemplateRecord = {
  eflPdfSha256: string;
  repPuctCertificate: string | null;
  eflVersionCode: string | null;
  rawText: string;
  extractorMethod?: string;
  planRules: any | null;
  rateStructure: any | null;
  parseConfidence: number;
  parseWarnings: string[];
};

export interface GetOrCreateEflTemplateResult {
  template: EflTemplateRecord;
  wasCreated: boolean;
  identity: EflTemplateKeyResult;
  warnings: string[];
}

// Simple in-memory cache so that repeated parses of the exact same
// EFL within a single process do not re-run the AI unnecessarily.
const templateCache = new Map<string, EflTemplateRecord>();

export async function getOrCreateEflTemplate(
  input: GetOrCreateEflTemplateInput,
): Promise<GetOrCreateEflTemplateResult> {
  if (input.source === "manual_upload") {
    return handleManualUpload(input);
  }
  return handleWattbuy(input);
}

async function handleManualUpload(
  input: Extract<GetOrCreateEflTemplateInput, { source: "manual_upload" }>,
): Promise<GetOrCreateEflTemplateResult> {
  const extract = await deterministicEflExtract(input.pdfBytes);

  const rawText = extract.rawText ?? "";
  if (!rawText.trim()) {
    throw new Error("EFL rawText empty; cannot create template.");
  }

  const identity = getTemplateKey({
    repPuctCertificate: extract.repPuctCertificate,
    eflVersionCode: extract.eflVersionCode,
    eflPdfSha256: extract.eflPdfSha256,
    wattbuy: null,
  });

  // Try cache by any of the lookup keys (strongest first).
  for (const key of identity.lookupKeys) {
    const hit = templateCache.get(key);
    if (hit) {
      const warnings = [
        ...extract.warnings,
        ...identity.warnings,
        // keep the cached template's own parseWarnings visible at top level
        ...(hit.parseWarnings ?? []),
      ];
      return {
        template: hit,
        wasCreated: false,
        identity,
        warnings,
      };
    }
  }

  // Miss → run AI parse from TEXT ONLY.
  const aiResult = await parseEflTextWithAi({
    rawText,
    eflPdfSha256: extract.eflPdfSha256,
    extraWarnings: extract.warnings,
  });

  const template: EflTemplateRecord = {
    eflPdfSha256: extract.eflPdfSha256,
    repPuctCertificate: extract.repPuctCertificate,
    eflVersionCode: extract.eflVersionCode,
    rawText,
    extractorMethod: extract.extractorMethod ?? "pdftotext",
    planRules: aiResult.planRules,
    rateStructure: aiResult.rateStructure,
    parseConfidence: aiResult.parseConfidence,
    parseWarnings: aiResult.parseWarnings ?? [],
  };

  const warnings: string[] = [
    ...extract.warnings,
    ...identity.warnings,
    ...(aiResult.parseWarnings ?? []),
  ];

  // Cache under all lookup keys so future calls within this process
  // (manual uploads of the same EFL) are fast and consistent.
  for (const key of identity.lookupKeys) {
    templateCache.set(key, template);
  }

  return {
    template,
    wasCreated: true,
    identity,
    warnings,
  };
}

async function handleWattbuy(
  input: Extract<GetOrCreateEflTemplateInput, { source: "wattbuy" }>,
): Promise<GetOrCreateEflTemplateResult> {
  const rawText = input.rawText ?? "";
  if (!rawText.trim()) {
    throw new Error("EFL rawText empty; cannot create template.");
  }

  const eflPdfSha256 = input.eflPdfSha256?.trim() || "";

  const identity = getTemplateKey({
    repPuctCertificate: input.repPuctCertificate ?? null,
    eflVersionCode: input.eflVersionCode ?? null,
    eflPdfSha256: eflPdfSha256 || null,
    wattbuy: input.wattbuy ?? null,
  });

  for (const key of identity.lookupKeys) {
    const hit = templateCache.get(key);
    if (hit) {
      const warnings = [
        ...identity.warnings,
        ...(hit.parseWarnings ?? []),
      ];
      return {
        template: hit,
        wasCreated: false,
        identity,
        warnings,
      };
    }
  }

  const aiResult: EflAiParseResult = await parseEflTextWithAi({
    rawText,
    eflPdfSha256: eflPdfSha256 || identity.primaryKey,
    extraWarnings: [],
  });

  const template: EflTemplateRecord = {
    eflPdfSha256: eflPdfSha256 || identity.primaryKey,
    repPuctCertificate: input.repPuctCertificate ?? null,
    eflVersionCode: input.eflVersionCode ?? null,
    rawText,
    extractorMethod: "pdftotext",
    planRules: aiResult.planRules,
    rateStructure: aiResult.rateStructure,
    parseConfidence: aiResult.parseConfidence,
    parseWarnings: aiResult.parseWarnings ?? [],
  };

  const warnings: string[] = [
    ...identity.warnings,
    ...(aiResult.parseWarnings ?? []),
  ];

  for (const key of identity.lookupKeys) {
    templateCache.set(key, template);
  }

  return {
    template,
    wasCreated: true,
    identity,
    warnings,
  };
}


