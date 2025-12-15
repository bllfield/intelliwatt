import { Buffer } from "node:buffer";

import { deterministicEflExtract } from "@/lib/efl/eflExtractor";
import { EflAiParseResult, parseEflTextWithAi } from "@/lib/efl/eflAiParser";
import {
  getTemplateKey,
  type EflTemplateKeyResult,
} from "@/lib/efl/templateIdentity";
import { solveEflValidationGaps } from "@/lib/efl/validation/solveEflValidationGaps";

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
  validation?: {
    eflAvgPriceValidation?: any;
  } | null;
  derivedForValidation?: any | null;
};

export interface GetOrCreateEflTemplateResult {
  template: EflTemplateRecord;
  wasCreated: boolean;
  identity: EflTemplateKeyResult;
  warnings: string[];
}

// Simple in-memory caches so that repeated parses of the exact same
// EFL within a single process do not re-run the AI unnecessarily.
// - TEMPLATE_CACHE: short-lived TTL cache keyed by identity.primaryKey
// - templateCache: longer-lived map keyed by all identity.lookupKeys
const CACHE_TTL_MS = 5 * 60 * 1000; // 5 minutes
const TEMPLATE_CACHE = new Map<string, { template: EflTemplateRecord; cachedAt: number }>();
const templateCache = new Map<string, EflTemplateRecord>();

let templateHit = 0;
let templateMiss = 0;
let templateCreated = 0;
let aiParseCount = 0;

function getFromTtlCache(key: string): EflTemplateRecord | null {
  const entry = TEMPLATE_CACHE.get(key);
  if (!entry) return null;
  if (Date.now() - entry.cachedAt > CACHE_TTL_MS) {
    TEMPLATE_CACHE.delete(key);
    return null;
  }
  return entry.template;
}

function putInTtlCache(key: string, template: EflTemplateRecord): void {
  TEMPLATE_CACHE.set(key, { template, cachedAt: Date.now() });
}

function logTemplateMetrics() {
  // Lightweight, log-based metrics for observability. This is intentionally
  // low-cardinality and can be aggregated externally if needed.
  // eslint-disable-next-line no-console
  console.info("[EFL_TEMPLATE_METRICS]", {
    templateHit,
    templateMiss,
    templateCreated,
    aiParseCount,
  });
}

export function findCachedEflTemplateByIdentity(input: {
  repPuctCertificate: string | null;
  eflVersionCode: string | null;
  eflPdfSha256: string | null;
  wattbuy?:
    | {
        providerName?: string | null;
        planName?: string | null;
        termMonths?: number | null;
        tdspName?: string | null;
        offerId?: string | null;
      }
    | null;
}): {
  template: EflTemplateRecord | null;
  identity: EflTemplateKeyResult;
  warnings: string[];
} {
  const identity = getTemplateKey({
    repPuctCertificate: input.repPuctCertificate,
    eflVersionCode: input.eflVersionCode,
    eflPdfSha256: input.eflPdfSha256,
    wattbuy: input.wattbuy ?? null,
  });

  for (const key of identity.lookupKeys) {
    const hit = templateCache.get(key);
    if (hit) {
      const warnings = [
        ...identity.warnings,
        ...(hit.parseWarnings ?? []),
      ];
      return { template: hit, identity, warnings };
    }
  }

  return { template: null, identity, warnings: identity.warnings.slice() };
}

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

  // Fast path: TTL cache keyed by primary identity key.
  const ttlHit = getFromTtlCache(identity.primaryKey);
  if (ttlHit) {
    templateHit++;
    const warnings = [
      ...extract.warnings,
      ...identity.warnings,
      ...(ttlHit.parseWarnings ?? []),
    ];
    logTemplateMetrics();
    return {
      template: ttlHit,
      wasCreated: false,
      identity,
      warnings,
    };
  }

  // Try cache by any of the lookup keys (strongest first).
  for (const key of identity.lookupKeys) {
    const hit = templateCache.get(key);
    if (hit) {
      templateHit++;
      const warnings = [
        ...extract.warnings,
        ...identity.warnings,
        // keep the cached template's own parseWarnings visible at top level
        ...(hit.parseWarnings ?? []),
      ];
      // Also refresh TTL under the primary key.
      putInTtlCache(identity.primaryKey, hit);
      logTemplateMetrics();
      return {
        template: hit,
        wasCreated: false,
        identity,
        warnings,
      };
    }
  }

  templateMiss++;

  // Miss → run AI parse from TEXT ONLY.
  aiParseCount++;
  const aiResult = await parseEflTextWithAi({
    rawText,
    eflPdfSha256: extract.eflPdfSha256,
    extraWarnings: extract.warnings,
  });

  // Run deterministic validation gap solver (tier sync + TDSP utility-table
  // fallback) so all callers — manual upload and WattBuy ingestion — see the
  // same derived validation output.
  let derivedForValidation: any = null;
  try {
    const baseValidation = (aiResult.validation as any)?.eflAvgPriceValidation ?? null;
    derivedForValidation = await solveEflValidationGaps({
      rawText,
      planRules: aiResult.planRules,
      rateStructure: aiResult.rateStructure,
      validation: baseValidation,
    });
  } catch {
    derivedForValidation = null;
  }

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
    validation: aiResult.validation ?? null,
    derivedForValidation,
  };

  const warnings: string[] = [
    ...extract.warnings,
    ...identity.warnings,
    ...(aiResult.parseWarnings ?? []),
  ];

  // Cache under all lookup keys so future calls within this process
  // (manual uploads of the same EFL) are fast and consistent.
  templateCreated++;
  putInTtlCache(identity.primaryKey, template);
  for (const key of identity.lookupKeys) {
    templateCache.set(key, template);
  }

  logTemplateMetrics();

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

  const ttlHit = getFromTtlCache(identity.primaryKey);
  if (ttlHit) {
    templateHit++;
    const warnings = [
      ...identity.warnings,
      ...(ttlHit.parseWarnings ?? []),
    ];
    logTemplateMetrics();
    return {
      template: ttlHit,
      wasCreated: false,
      identity,
      warnings,
    };
  }

  for (const key of identity.lookupKeys) {
    const hit = templateCache.get(key);
    if (hit) {
      templateHit++;
      const warnings = [
        ...identity.warnings,
        ...(hit.parseWarnings ?? []),
      ];
      putInTtlCache(identity.primaryKey, hit);
      logTemplateMetrics();
      return {
        template: hit,
        wasCreated: false,
        identity,
        warnings,
      };
    }
  }

  templateMiss++;

  const aiResult: EflAiParseResult = await parseEflTextWithAi({
    // Track each AI call for simple metrics.
    rawText,
    eflPdfSha256: eflPdfSha256 || identity.primaryKey,
    extraWarnings: [],
  });
  aiParseCount++;

  let derivedForValidation: any = null;
  try {
    const baseValidation = (aiResult.validation as any)?.eflAvgPriceValidation ?? null;
    derivedForValidation = await solveEflValidationGaps({
      rawText,
      planRules: aiResult.planRules,
      rateStructure: aiResult.rateStructure,
      validation: baseValidation,
    });
  } catch {
    derivedForValidation = null;
  }

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
    validation: aiResult.validation ?? null,
    derivedForValidation,
  };

  const warnings: string[] = [
    ...identity.warnings,
    ...(aiResult.parseWarnings ?? []),
  ];

  templateCreated++;
  putInTtlCache(identity.primaryKey, template);
  for (const key of identity.lookupKeys) {
    templateCache.set(key, template);
  }

  logTemplateMetrics();

  return {
    template,
    wasCreated: true,
    identity,
    warnings,
  };
}


