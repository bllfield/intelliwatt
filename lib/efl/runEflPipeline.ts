import { Buffer } from "node:buffer";

import { fetchEflPdfFromUrl } from "@/lib/efl/fetchEflPdf";
import { deterministicEflExtract } from "@/lib/efl/eflExtractor";
import { extractProviderAndPlanNameFromEflText } from "@/lib/efl/eflExtractor";
import { runEflPipelineNoStore } from "@/lib/efl/runEflPipelineNoStore";
import { runEflPipelineFromRawTextNoStore } from "@/lib/efl/runEflPipelineFromRawTextNoStore";
import { persistAndLinkFromPipeline } from "@/lib/efl/persistAndLinkFromPipeline";
import { prisma } from "@/lib/db";

export type EflPipelineSource =
  | "manual_url"
  | "manual_upload"
  | "manual_text"
  | "queue_open"
  | "queue_quarantine"
  | "batch"
  | "on_demand";

export type EflPipelineStage =
  | "ACQUIRE"
  | "CONVERT"
  | "PARSE"
  | "VALIDATE"
  | "PERSIST"
  | "DERIVE_CALC"
  | "LINK_OFFER"
  | "QUEUE_UPDATE";

export type RunEflPipelineInput = {
  source: EflPipelineSource;
  actor?: "admin" | "system";
  dryRun?: boolean;
  offerId?: string | null;
  eflUrl?: string | null;
  pdfBytes?: Buffer | Uint8Array | null;
  rawText?: string | null;
  identity?: {
    eflPdfSha256?: string | null;
    repPuctCertificate?: string | null;
    eflVersionCode?: string | null;
  } | null;
  // best-effort context (helps persistence)
  offerMeta?: {
    supplier?: string | null;
    planName?: string | null;
    termMonths?: number | null;
    tdspName?: string | null;
  } | null;
};

export type RunEflPipelineResult = {
  ok: boolean;
  stage: EflPipelineStage;

  offerId: string | null;
  eflUrlCanonical: string | null;
  ratePlanId: string | null;

  // parser outputs (useful for admin UI)
  rawTextLen?: number;
  rawTextPreview?: string;
  rawTextTruncated?: boolean;
  extractorMethod?: string;
  parseConfidence?: number | null;
  parseWarnings?: string[];
  deterministicWarnings?: string[];
  eflPdfSha256?: string | null;
  repPuctCertificate?: string | null;
  eflVersionCode?: string | null;
  rateStructure?: any | null;
  planRules?: any | null;
  validation?: any | null;
  derivedForValidation?: any | null;
  finalValidation?: any | null;
  passStrength?: "STRONG" | "WEAK" | "INVALID" | null;

  // plan calc (persisted when template persisted; also returned for visibility)
  planCalcStatus: "COMPUTABLE" | "NOT_COMPUTABLE" | "UNKNOWN";
  planCalcReasonCode: string;
  requiredBucketKeys: string[];

  queued: boolean;
  queueReason?: string;
  errors?: Array<{ code: string; message: string }>;
};

function normalizeUrl(u: string | null | undefined): string | null {
  const s = String(u ?? "").trim();
  if (!s) return null;
  try {
    return new URL(s).toString();
  } catch {
    return null;
  }
}

function toBuffer(x: Buffer | Uint8Array): Buffer {
  return Buffer.isBuffer(x) ? x : Buffer.from(x);
}

async function upsertQueueItem(args: {
  kind: "EFL_PARSE" | "PLAN_CALC_QUARANTINE";
  // unique key material
  dedupeKey?: string | null;
  eflPdfSha256: string;
  // metadata
  offerId: string | null;
  supplier?: string | null;
  planName?: string | null;
  eflUrl?: string | null;
  tdspName?: string | null;
  termMonths?: number | null;
  ratePlanId?: string | null;
  rawText?: string | null;
  planRules?: any | null;
  rateStructure?: any | null;
  validation?: any | null;
  derivedForValidation?: any | null;
  finalStatus?: string | null;
  queueReason: string;
}) {
  try {
    const now = new Date();
    const kind = args.kind;

    if (kind === "PLAN_CALC_QUARANTINE") {
      const offerId = String(args.offerId ?? "").trim();
      const dk = String(args.dedupeKey ?? offerId ?? "").trim();
      if (!dk) return;

      await (prisma as any).eflParseReviewQueue
        .upsert({
          where: { kind_dedupeKey: { kind: "PLAN_CALC_QUARANTINE", dedupeKey: dk } },
          create: {
            source: "canonical_pipeline",
            kind: "PLAN_CALC_QUARANTINE",
            dedupeKey: dk,
            eflPdfSha256: args.eflPdfSha256, // must be unique; caller should pass synthetic for quarantines
            offerId: args.offerId,
            supplier: args.supplier ?? null,
            planName: args.planName ?? null,
            eflUrl: args.eflUrl ?? null,
            tdspName: args.tdspName ?? null,
            termMonths: typeof args.termMonths === "number" ? args.termMonths : null,
            ratePlanId: args.ratePlanId ?? null,
            rawText: args.rawText ?? null,
            planRules: args.planRules ?? null,
            rateStructure: args.rateStructure ?? null,
            validation: args.validation ?? null,
            derivedForValidation: args.derivedForValidation ?? null,
            finalStatus: args.finalStatus ?? "OPEN",
            queueReason: args.queueReason,
            solverApplied: [],
            resolvedAt: null,
            resolvedBy: null,
            resolutionNotes: null,
            updatedAt: now,
          },
          update: {
            updatedAt: now,
            offerId: args.offerId,
            supplier: args.supplier ?? null,
            planName: args.planName ?? null,
            eflUrl: args.eflUrl ?? null,
            tdspName: args.tdspName ?? null,
            termMonths: typeof args.termMonths === "number" ? args.termMonths : null,
            ratePlanId: args.ratePlanId ?? null,
            rawText: args.rawText ?? null,
            planRules: args.planRules ?? null,
            rateStructure: args.rateStructure ?? null,
            validation: args.validation ?? null,
            derivedForValidation: args.derivedForValidation ?? null,
            finalStatus: args.finalStatus ?? "OPEN",
            queueReason: args.queueReason,
            resolvedAt: null,
            resolvedBy: null,
            resolutionNotes: null,
          },
        })
        .catch(() => {});
      return;
    }

    // EFL_PARSE: dedupe is effectively by eflPdfSha256; many codepaths rely on trigger to set dedupeKey.
    await (prisma as any).eflParseReviewQueue
      .upsert({
        where: { eflPdfSha256: args.eflPdfSha256 },
        create: {
          source: "canonical_pipeline",
          kind: "EFL_PARSE",
          dedupeKey: "",
          eflPdfSha256: args.eflPdfSha256,
          offerId: args.offerId,
          supplier: args.supplier ?? null,
          planName: args.planName ?? null,
          eflUrl: args.eflUrl ?? null,
          tdspName: args.tdspName ?? null,
          termMonths: typeof args.termMonths === "number" ? args.termMonths : null,
          ratePlanId: args.ratePlanId ?? null,
          rawText: args.rawText ?? null,
          planRules: args.planRules ?? null,
          rateStructure: args.rateStructure ?? null,
          validation: args.validation ?? null,
          derivedForValidation: args.derivedForValidation ?? null,
          finalStatus: args.finalStatus ?? "NEEDS_REVIEW",
          queueReason: args.queueReason,
          solverApplied: [],
          resolvedAt: null,
          resolvedBy: null,
          resolutionNotes: null,
          updatedAt: now,
        },
        update: {
          updatedAt: now,
          offerId: args.offerId,
          supplier: args.supplier ?? null,
          planName: args.planName ?? null,
          eflUrl: args.eflUrl ?? null,
          tdspName: args.tdspName ?? null,
          termMonths: typeof args.termMonths === "number" ? args.termMonths : null,
          ratePlanId: args.ratePlanId ?? null,
          rawText: args.rawText ?? null,
          planRules: args.planRules ?? null,
          rateStructure: args.rateStructure ?? null,
          validation: args.validation ?? null,
          derivedForValidation: args.derivedForValidation ?? null,
          finalStatus: args.finalStatus ?? "NEEDS_REVIEW",
          queueReason: args.queueReason,
          resolvedAt: null,
          resolvedBy: null,
          resolutionNotes: null,
        },
      })
      .catch(() => {});
  } catch {
    // best-effort only
  }
}

/**
 * Canonical end-to-end EFL pipeline used by manual + queue processors.
 *
 * IMPORTANT: dashboard plans endpoints are intentionally NOT migrated in this step.
 */
export async function runEflPipeline(input: RunEflPipelineInput): Promise<RunEflPipelineResult> {
  const dryRun = input.dryRun === true;
  const offerId = String(input.offerId ?? "").trim() || null;
  const eflUrlCanonical = normalizeUrl(input.eflUrl ?? null);

  const err = (stage: EflPipelineStage, code: string, message: string, queued = true): RunEflPipelineResult => ({
    ok: false,
    stage,
    offerId,
    eflUrlCanonical,
    ratePlanId: null,
    planCalcStatus: "UNKNOWN",
    planCalcReasonCode: code,
    requiredBucketKeys: [],
    queued,
    queueReason: message,
    errors: [{ code, message }],
  });

  // Stage ACQUIRE
  let rawText = String(input.rawText ?? "").trim() || null;
  let pdfBytes: Buffer | null = null;
  let fetchedUrl: string | null = null;

  try {
    if (!rawText) {
      if (input.pdfBytes) {
        pdfBytes = toBuffer(input.pdfBytes);
      } else {
        const u = eflUrlCanonical;
        if (!u) return err("ACQUIRE", "PIPELINE_NO_INPUT", "Missing rawText/pdfBytes/eflUrl.");
        const fetched = await fetchEflPdfFromUrl(u, { timeoutMs: 20_000 } as any);
        if (!(fetched as any)?.ok) {
          const msg = `PIPELINE_FETCH_FAIL: ${(fetched as any)?.error ?? "fetch failed"}`;
          return err("ACQUIRE", "PIPELINE_FETCH_FAIL", msg);
        }
        fetchedUrl = String((fetched as any)?.pdfUrl ?? u);
        pdfBytes = (fetched as any).pdfBytes as Buffer;
      }
    }
  } catch (e: any) {
    return err("ACQUIRE", "PIPELINE_ACQUIRE_EXCEPTION", e?.message ?? String(e));
  }

  // PARSE/VALIDATE
  let pipeline: any = null;
  try {
    if (rawText) {
      // Raw-text mode (queue fallback / manual paste): compute a deterministic fingerprint WITHOUT re-running AI twice.
      const sha =
        String(input.identity?.eflPdfSha256 ?? "").trim() ||
        (await deterministicEflExtract(Buffer.from(rawText, "utf8"), async () => rawText || "")).eflPdfSha256;
      pipeline = await runEflPipelineFromRawTextNoStore({
        rawText,
        eflPdfSha256: sha,
        repPuctCertificate: input.identity?.repPuctCertificate ?? null,
        eflVersionCode: input.identity?.eflVersionCode ?? null,
        source: "queue_rawtext",
        offerMeta: input.offerMeta ?? null,
      } as any);
    } else if (pdfBytes) {
      pipeline = await runEflPipelineNoStore({
        pdfBytes,
        source: "manual",
        offerMeta: input.offerMeta ?? null,
      });
      rawText = String(pipeline?.deterministic?.rawText ?? "").trim() || null;
    } else {
      return err("PARSE", "PIPELINE_NO_CONTENT", "No rawText or pdfBytes available.");
    }
  } catch (e: any) {
    return err("PARSE", "PIPELINE_PARSE_FAIL", e?.message ?? String(e));
  }

  const det = pipeline?.deterministic ?? {};
  const eflPdfSha256 = det?.eflPdfSha256 ?? null;
  const repPuctCertificate = det?.repPuctCertificate ?? input.identity?.repPuctCertificate ?? null;
  const eflVersionCode = det?.eflVersionCode ?? input.identity?.eflVersionCode ?? null;
  const extractorMethod = det?.extractorMethod ?? null;
  const deterministicWarnings = Array.isArray(det?.warnings) ? det.warnings : [];
  const parseConfidence =
    typeof pipeline?.parseConfidence === "number" ? pipeline.parseConfidence : null;
  const parseWarnings = Array.isArray(pipeline?.parseWarnings) ? pipeline.parseWarnings : [];
  const finalValidation = pipeline?.finalValidation ?? null;
  const finalStatus = finalValidation?.status ?? null;
  const passStrength = pipeline?.passStrength ?? null;

  const planRules = pipeline?.planRules ?? null;
  const rateStructure = pipeline?.rateStructure ?? null;

  if (!rawText || !eflPdfSha256) {
    const msg = "PIPELINE_VALIDATE_FAIL: missing rawText or eflPdfSha256.";
    return err("VALIDATE", "PIPELINE_VALIDATE_FAIL", msg);
  }

  // Default outcome: if we can't (or shouldn't) persist, we queue.
  const persistEligible =
    finalStatus === "PASS" && passStrength === "STRONG" && planRules && rateStructure;

  const derivedNames = (() => {
    try {
      return extractProviderAndPlanNameFromEflText(rawText ?? "");
    } catch {
      return { providerName: null, planName: null };
    }
  })();

  const offerMetaResolved = {
    supplier: input.offerMeta?.supplier ?? derivedNames.providerName ?? null,
    planName: input.offerMeta?.planName ?? derivedNames.planName ?? null,
    termMonths:
      typeof input.offerMeta?.termMonths === "number"
        ? input.offerMeta?.termMonths
        : typeof (planRules as any)?.termMonths === "number"
          ? (planRules as any).termMonths
          : null,
    tdspName: input.offerMeta?.tdspName ?? null,
  };

  if (!persistEligible) {
    const reason =
      String(finalValidation?.queueReason ?? "").trim() ||
      (finalStatus !== "PASS"
        ? `PIPELINE_NOT_ELIGIBLE: status=${finalStatus ?? "UNKNOWN"}`
        : `PIPELINE_NOT_ELIGIBLE: passStrength=${passStrength ?? "UNKNOWN"}`);

    if (!dryRun) {
      await upsertQueueItem({
        kind: "EFL_PARSE",
        eflPdfSha256: String(eflPdfSha256),
        offerId,
        supplier: offerMetaResolved.supplier ?? null,
        planName: offerMetaResolved.planName ?? null,
        eflUrl: fetchedUrl ?? eflUrlCanonical,
        tdspName: offerMetaResolved.tdspName ?? null,
        termMonths: offerMetaResolved.termMonths ?? null,
        rawText,
        planRules,
        rateStructure,
        validation: pipeline?.validation ?? null,
        derivedForValidation: pipeline?.derivedForValidation ?? null,
        finalStatus: String(finalStatus ?? "FAIL"),
        queueReason: reason,
      });
    }

    return {
      ok: true,
      stage: "QUEUE_UPDATE",
      offerId,
      eflUrlCanonical: fetchedUrl ?? eflUrlCanonical,
      ratePlanId: null,
      rawTextLen: rawText.length,
      rawTextPreview: det?.rawTextPreview ?? rawText.slice(0, 20000),
      rawTextTruncated: Boolean(det?.rawTextTruncated ?? rawText.length > 20000),
      extractorMethod: extractorMethod ?? undefined,
      parseConfidence,
      parseWarnings,
      deterministicWarnings,
      eflPdfSha256,
      repPuctCertificate,
      eflVersionCode,
      planRules,
      rateStructure,
      validation: pipeline?.validation ?? null,
      derivedForValidation: pipeline?.derivedForValidation ?? null,
      finalValidation,
      passStrength,
      planCalcStatus: "UNKNOWN",
      planCalcReasonCode: "PIPELINE_NOT_ELIGIBLE",
      requiredBucketKeys: [],
      queued: true,
      queueReason: reason,
    };
  }

  // PERSIST/DERIVE/LINK: delegate to shared persistence/linking (idempotent)
  try {
    if (dryRun) {
      return {
        ok: true,
        stage: "PERSIST",
        offerId,
        eflUrlCanonical: fetchedUrl ?? eflUrlCanonical,
        ratePlanId: null,
        rawTextLen: rawText.length,
        eflPdfSha256,
        repPuctCertificate,
        eflVersionCode,
        planRules,
        rateStructure,
        validation: pipeline?.validation ?? null,
        derivedForValidation: pipeline?.derivedForValidation ?? null,
        finalValidation,
        passStrength,
        planCalcStatus: "UNKNOWN",
        planCalcReasonCode: "DRY_RUN",
        requiredBucketKeys: [],
        queued: false,
      };
    }

    const persisted = await persistAndLinkFromPipeline({
      mode: "live",
      source:
        input.source === "queue_open"
          ? "queue_process_open"
          : input.source === "queue_quarantine"
            ? "queue_process_quarantine"
            : input.source === "manual_upload"
              ? "manual_upload"
              : input.source === "manual_text"
                ? "manual_text"
                : "manual_url",
      eflUrl: fetchedUrl ?? eflUrlCanonical,
      eflSourceUrl: eflUrlCanonical,
      offerId,
      offerMeta: offerMetaResolved,
      deterministic: {
        eflPdfSha256,
        repPuctCertificate,
        eflVersionCode,
        rawText,
      },
      pipeline: {
        planRules,
        rateStructure,
        validation: pipeline?.validation ?? null,
        derivedForValidation: pipeline?.derivedForValidation ?? null,
        finalValidation,
        passStrength,
      },
    });

    if (!persisted.templatePersisted || !persisted.persistedRatePlanId) {
      const reason = (persisted.notes ?? []).join(" | ") || "PIPELINE_PERSIST_FAILED";
      await upsertQueueItem({
        kind: "EFL_PARSE",
        eflPdfSha256: String(eflPdfSha256),
        offerId,
        supplier: offerMetaResolved.supplier ?? null,
        planName: offerMetaResolved.planName ?? null,
        eflUrl: fetchedUrl ?? eflUrlCanonical,
        tdspName: offerMetaResolved.tdspName ?? null,
        termMonths: offerMetaResolved.termMonths ?? null,
        rawText,
        planRules,
        rateStructure,
        validation: pipeline?.validation ?? null,
        derivedForValidation: pipeline?.derivedForValidation ?? null,
        finalStatus: "FAIL",
        queueReason: `PIPELINE_STAGE_FAILED_PERSIST: ${reason}`,
      });
      return err("PERSIST", "PIPELINE_STAGE_FAILED_PERSIST", reason, true);
    }

    // If we *did* persist, but couldn't link a provided offerId, fail closed and queue.
    if (offerId && persisted.offerIdLinked !== true) {
      const msg = "PIPELINE_STAGE_FAILED_LINK_OFFER";
      await upsertQueueItem({
        kind: "EFL_PARSE",
        eflPdfSha256: String(eflPdfSha256),
        offerId,
        supplier: offerMetaResolved.supplier ?? null,
        planName: offerMetaResolved.planName ?? null,
        eflUrl: fetchedUrl ?? eflUrlCanonical,
        tdspName: offerMetaResolved.tdspName ?? null,
        termMonths: offerMetaResolved.termMonths ?? null,
        rawText,
        planRules,
        rateStructure,
        validation: pipeline?.validation ?? null,
        derivedForValidation: pipeline?.derivedForValidation ?? null,
        finalStatus: "FAIL",
        queueReason: msg,
      });
      return err("LINK_OFFER", "PIPELINE_STAGE_FAILED_LINK_OFFER", msg, true);
    }

    // If persisted but NOT computable, enqueue a quarantine row (sticky ops signal).
    if ((persisted.planCalc?.planCalcStatus ?? null) && persisted.planCalc?.planCalcStatus !== "COMPUTABLE") {
      const reasonCode = String(persisted.planCalc?.planCalcReasonCode ?? "UNKNOWN");
      const dk = offerId || `plan_calc:${persisted.persistedRatePlanId}`;
      const synthetic = `plan_calc_quarantine:${dk}`;
      await upsertQueueItem({
        kind: "PLAN_CALC_QUARANTINE",
        dedupeKey: dk,
        eflPdfSha256: synthetic,
        offerId,
        supplier: offerMetaResolved.supplier ?? null,
        planName: offerMetaResolved.planName ?? null,
        eflUrl: fetchedUrl ?? eflUrlCanonical,
        tdspName: offerMetaResolved.tdspName ?? null,
        termMonths: offerMetaResolved.termMonths ?? null,
        ratePlanId: persisted.persistedRatePlanId,
        rawText,
        planRules,
        rateStructure,
        validation: pipeline?.validation ?? null,
        derivedForValidation: pipeline?.derivedForValidation ?? null,
        finalStatus: "OPEN",
        queueReason: `PLAN_CALC_${String(persisted.planCalc?.planCalcStatus)}:${reasonCode}`,
      });
    }

    return {
      ok: true,
      stage: "LINK_OFFER",
      offerId,
      eflUrlCanonical: fetchedUrl ?? eflUrlCanonical,
      ratePlanId: persisted.persistedRatePlanId,
      rawTextLen: rawText.length,
      rawTextPreview: det?.rawTextPreview ?? rawText.slice(0, 20000),
      rawTextTruncated: Boolean(det?.rawTextTruncated ?? rawText.length > 20000),
      extractorMethod: extractorMethod ?? undefined,
      parseConfidence,
      parseWarnings,
      deterministicWarnings,
      eflPdfSha256,
      repPuctCertificate,
      eflVersionCode,
      planRules,
      rateStructure,
      validation: pipeline?.validation ?? null,
      derivedForValidation: pipeline?.derivedForValidation ?? null,
      finalValidation,
      passStrength,
      planCalcStatus:
        (persisted.planCalc?.planCalcStatus as any) === "COMPUTABLE"
          ? "COMPUTABLE"
          : (persisted.planCalc?.planCalcStatus as any) === "NOT_COMPUTABLE"
            ? "NOT_COMPUTABLE"
            : "UNKNOWN",
      planCalcReasonCode: String(persisted.planCalc?.planCalcReasonCode ?? "UNKNOWN"),
      requiredBucketKeys: Array.isArray(persisted.planCalc?.requiredBucketKeys)
        ? persisted.planCalc!.requiredBucketKeys
        : [],
      queued: false,
    };
  } catch (e: any) {
    const reason = e?.message ?? String(e);
    await upsertQueueItem({
      kind: "EFL_PARSE",
      eflPdfSha256: String(eflPdfSha256),
      offerId,
      supplier: offerMetaResolved.supplier ?? null,
      planName: offerMetaResolved.planName ?? null,
      eflUrl: fetchedUrl ?? eflUrlCanonical,
      tdspName: offerMetaResolved.tdspName ?? null,
      termMonths: offerMetaResolved.termMonths ?? null,
      rawText,
      planRules,
      rateStructure,
      validation: pipeline?.validation ?? null,
      derivedForValidation: pipeline?.derivedForValidation ?? null,
      finalStatus: "FAIL",
      queueReason: `PIPELINE_EXCEPTION_PERSIST: ${reason}`,
    });
    return err("PERSIST", "PIPELINE_EXCEPTION_PERSIST", reason, true);
  }
}

