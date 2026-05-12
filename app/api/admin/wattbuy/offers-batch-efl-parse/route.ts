import { NextRequest, NextResponse } from "next/server";
import { Buffer } from "node:buffer";
import crypto from "node:crypto";

import { wbGetOffers } from "@/lib/wattbuy/client";
import { collectOfferEflCandidateUrls, normalizeOffers, type OfferNormalized } from "@/lib/wattbuy/normalize";
import { computePdfSha256 } from "@/lib/efl/eflExtractor";
import { fetchEflSourceFromUrl } from "@/lib/efl/fetchEflPdf";
import { runEflPipeline } from "@/lib/plan-engine-next/efl/runEflPipeline";
import { prisma } from "@/lib/db";
import { ensureCoreMonthlyBuckets } from "@/lib/usage/aggregateMonthlyBuckets";
import { bucketDefsFromBucketKeys } from "@/lib/plan-engine/usageBuckets";
import { getTdspDeliveryRates } from "@/lib/plan-engine/getTdspDeliveryRates";
import { calculatePlanCostForUsage } from "@/lib/plan-engine/calculatePlanCostForUsage";
import { usagePrisma } from "@/lib/db/usageClient";
import { resolveCanonicalUsage365CoverageWindow } from "@/modules/usageSimulator/metadataWindow";

export const dynamic = "force-dynamic";

const ADMIN_TOKEN = process.env.ADMIN_TOKEN;

type BatchMode = "STORE_TEMPLATES_ON_PASS" | "DRY_RUN";

type BatchRequest = {
  address?: {
    line1?: string | null;
    city?: string | null;
    state?: string | null;
    zip?: string | null;
  } | null;
  /**
   * Optional: compute monthly usage buckets (including TOU windows) for a specific home
   * and attach usage/cost previews to batch results. This writes to usage tables.
   */
  usageEmail?: string | null;
  computeUsageBuckets?: boolean | null;
  usageMonths?: number | null; // default 12
  offerLimit?: number | null;
  /**
   * Start scanning the WattBuy offers list at this index.
   * Used to chunk large batches across multiple runs to avoid Vercel timeouts.
   */
  startIndex?: number | null;
  /**
   * Max number of offers with EFL URLs to actually run through the EFL pipeline in this run.
   * (Offers without EFL URLs are cheap to skip, so we don't count those here.)
   */
  processLimit?: number | null;
  /**
   * Soft time budget for a single invocation (ms). The handler will stop early and return
   * `truncated=true` when it approaches this budget, so callers can continue with `nextStartIndex`.
   *
   * This is the preferred guardrail vs a fixed processLimit because EFL parse time varies widely.
   */
  timeBudgetMs?: number | null;
  /**
   * Convenience flag; when true this forces mode="DRY_RUN".
   * UI prefers this over a mode dropdown.
   */
  dryRun?: boolean | null;
  mode?: BatchMode | null;
  /**
   * When true, bypass all template fast-path checks (by URL and by EFL PDF sha256)
   * so we can re-run the pipeline and overwrite stored templates with newer parsing logic.
   *
   * Note: DRY_RUN remains side-effect-free (we still won't persist templates).
   */
  forceReparseTemplates?: boolean | null;
};

type BatchResultRow = {
  offerId: string | null;
  supplier: string | null;
  planName: string | null;
  termMonths: number | null;
  tdspName: string | null;
  tdspSlug?: string | null;
  eflUrl: string | null;
  eflPdfSha256: string | null;
  repPuctCertificate: string | null;
  eflVersionCode: string | null;
  validationStatus: string | null;
  originalValidationStatus?: string | null;
  finalValidationStatus?: string | null;
  tdspAppliedMode: string | null;
  parseConfidence: number | null;
  passStrength?: "STRONG" | "WEAK" | "INVALID" | null;
  passStrengthReasons?: string[] | null;
  passStrengthOffPointDiffs?: Array<{
    usageKwh: number;
    expectedInterp: number;
    modeled: number | null;
    diff: number | null;
    ok: boolean;
  }> | null;
  /**
   * True when we detected a previously persisted RatePlan.rateStructure for this
   * EFL fingerprint (i.e., a “template hit”), and skipped re-parsing.
   *
   * NOTE: In DRY_RUN, templateAction must remain "SKIPPED" per contract; use
   * templateHit to still surface that a template existed.
   */
  templateHit?: boolean;
  templateAction: "TEMPLATE" | "HIT" | "CREATED" | "SKIPPED" | "NOT_ELIGIBLE";
  queueReason?: string | null;
  finalQueueReason?: string | null;
  solverApplied?: string[] | null;
  notes?: string | null;
  planCalcStatus?: "COMPUTABLE" | "NOT_COMPUTABLE" | "UNKNOWN" | null;
  planCalcReasonCode?: string | null;
  requiredBucketKeys?: string[] | null;
  usagePreview?: {
    months: number;
    annualKwh: number | null;
    avgMonthlyKwhByKey: Record<string, number>;
    latestMonthKwhByKey: Record<string, number>;
    missingKeys: string[];
  } | null;
  usageEstimate?: any | null;
  diffs?: Array<{
    kwh: number;
    expected: number | null;
    modeled: number | null;
    diff: number | null;
    ok: boolean;
  }>;
};

type BatchResponse =
  | {
      ok: true;
      mode: BatchMode;
      offerCount: number;
      offerSliceStartIndex: number;
      offerSliceEndIndex: number;
      scannedCount: number;
      processedCount: number;
      truncated: boolean;
      nextStartIndex: number | null;
      results: BatchResultRow[];
      usageContext?: {
        email: string;
        homeId: string | null;
        esiid: string | null;
        months: number;
        bucketKeys: string[];
        computed?: {
          monthsProcessed: number;
          rowsUpserted: number;
          intervalRowsRead: number;
          kwhSummed: number;
          notes: string[];
        } | null;
        errors?: string[];
      } | null;
    }
  | {
      ok: false;
      error: string;
      details?: unknown;
    };

function jsonError(status: number, error: string, details?: unknown) {
  const body: BatchResponse = {
    ok: false,
    error,
    ...(details ? { details } : {}),
  };
  return NextResponse.json(body, { status });
}

function normalizeQueueReason(reason: string | null | undefined): string | null {
  if (!reason) return null;
  // Fix common mojibake sequences such as "â€”" / "â€“" into proper dashes.
  return reason
    .replace(/â€”/g, "—")
    .replace(/â€“/g, "–")
    .replace(/â€™/g, "’");
}

function sha256Hex(s: string): string {
  return crypto.createHash("sha256").update(s).digest("hex");
}

function normalizeEmailLoose(s: string | null | undefined): string {
  return String(s ?? "").trim().toLowerCase();
}

function decimalToNumber(v: any): number | null {
  if (typeof v === "number" && Number.isFinite(v)) return v;
  if (v && typeof v === "object" && typeof v.toString === "function") {
    const n = Number(v.toString());
    return Number.isFinite(n) ? n : null;
  }
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

function lastNYearMonthsChicago(n: number): string[] {
  try {
    const tz = "America/Chicago";
    const fmt = new Intl.DateTimeFormat("en-US", { timeZone: tz, year: "numeric", month: "2-digit" });
    const parts = fmt.formatToParts(new Date());
    const get = (type: string) => parts.find((p) => p.type === type)?.value ?? "";
    const year0 = Number(get("year"));
    const month0 = Number(get("month"));
    if (!Number.isFinite(year0) || !Number.isFinite(month0) || month0 < 1 || month0 > 12) return [];

    const out: string[] = [];
    for (let i = 0; i < n; i++) {
      const idx = month0 - i;
      const y = idx >= 1 ? year0 : year0 - Math.ceil((1 - idx) / 12);
      const m0 = ((idx - 1) % 12 + 12) % 12 + 1;
      out.push(`${String(y)}-${String(m0).padStart(2, "0")}`);
    }
    return out;
  } catch {
    return [];
  }
}

function isUsableTemplate(p: any): boolean {
  if (!p) return false;
  if (!p.rateStructure) return false;
  if ((p.eflRequiresManualReview ?? false) === true) return false;
  if (!(String(p?.supplier ?? "").trim())) return false;
  if (!(String(p?.planName ?? "").trim())) return false;
  if (typeof p?.termMonths !== "number") return false;
  if (!(String(p?.eflVersionCode ?? "").trim())) return false;
  return true;
}

export async function POST(req: NextRequest) {
  try {
    if (!ADMIN_TOKEN) {
      return jsonError(500, "ADMIN_TOKEN is not configured");
    }

    const headerToken = req.headers.get("x-admin-token");
    if (!headerToken || headerToken !== ADMIN_TOKEN) {
      return jsonError(401, "Unauthorized (invalid admin token)");
    }

    let body: BatchRequest;
    try {
      body = (await req.json()) as BatchRequest;
    } catch {
      return jsonError(400, "Invalid JSON body");
    }

    const addr = body.address ?? null;
    const line1 = (addr?.line1 ?? "").trim();
    const city = (addr?.city ?? "").trim();
    const state = (addr?.state ?? "").trim();
    const zip = (addr?.zip ?? "").trim();

    const hasZip = Boolean(zip);
    const hasFullAddress = Boolean(line1 && city && state && zip);
    if (!hasZip) {
      return jsonError(400, "address.zip is required (zip-only lookup is supported).");
    }

    const offerLimitRaw = body.offerLimit ?? null;
    // UI wants 500; we still keep a hard cap and chunk actual processing via processLimit.
    const offerLimit = Math.max(
      1,
      Math.min(500, offerLimitRaw && Number.isFinite(offerLimitRaw) ? Number(offerLimitRaw) : 500),
    );

    const dryRunFlag = body.dryRun === true;
    const mode: BatchMode = dryRunFlag
      ? "DRY_RUN"
      : body.mode === "DRY_RUN"
        ? "DRY_RUN"
        : "STORE_TEMPLATES_ON_PASS";

    const forceReparseTemplates = body.forceReparseTemplates === true;

    const startIndexRaw = body.startIndex ?? null;
    const startIndex = Math.max(
      0,
      startIndexRaw && Number.isFinite(startIndexRaw) ? Math.floor(Number(startIndexRaw)) : 0,
    );

    const processLimitRaw = body.processLimit ?? null;
    const processLimit = Math.max(
      1,
      Math.min(
        500,
        processLimitRaw && Number.isFinite(processLimitRaw)
          ? Math.floor(Number(processLimitRaw))
          : 500,
      ),
    );

    const timeBudgetRaw = body.timeBudgetMs ?? null;
    const timeBudgetMs = Math.max(
      5_000,
      Math.min(
        270_000,
        timeBudgetRaw && Number.isFinite(timeBudgetRaw) ? Math.floor(Number(timeBudgetRaw)) : 240_000,
      ),
    );
    const startedAtMs = Date.now();
    const deadlineMs = startedAtMs + timeBudgetMs;
    const shouldStopForTimeBudget = () => Date.now() >= deadlineMs - 2_500;

    const computeUsageBuckets = body.computeUsageBuckets === true;
    const usageEmail = normalizeEmailLoose(body.usageEmail ?? null) || null;
    const usageMonths = Math.max(
      1,
      Math.min(24, Number(body.usageMonths ?? 12) || 12),
    );

    // 1) Fetch offers from WattBuy via the existing client + normalizer.
    const offersRes = await wbGetOffers(
      hasFullAddress
        ? { address: line1, city, state, zip }
        : {
            // Zip-only lookup (state optional; WattBuy can infer territory from zip in many cases)
            ...(state ? { state } : {}),
            zip,
          },
    );

    if (!offersRes.ok || !offersRes.data) {
      return jsonError(502, "Failed to fetch offers from WattBuy", {
        status: offersRes.status,
        text: offersRes.text,
      });
    }

    const { offers } = normalizeOffers(offersRes.data);
    const offerSliceStartIndex = Math.min(startIndex, offers.length);
    const offerSliceEndIndex = Math.min(offers.length, offerSliceStartIndex + offerLimit);
    const sliced = offers.slice(offerSliceStartIndex, offerSliceEndIndex);

    // Pre-fetch existing templates by likely upstream URLs so we can skip work before downloading PDFs.
    // For some suppliers (e.g. OhmConnect), docs.efl may be missing and the EFL link is only discoverable
    // from the offer enrollment/landing page (offer.enroll_link).
    const eflUrls = (sliced as OfferNormalized[])
      .flatMap((o) => [o?.docs?.efl ?? null, (o as any)?.enroll_link ?? null])
      .filter((u): u is string => Boolean(u));

    const urlToRatePlan = new Map<string, any>();
    if (eflUrls.length > 0) {
      const existingByUrl = (await prisma.ratePlan.findMany({
        where: {
          OR: [
            { eflSourceUrl: { in: eflUrls } },
            { eflUrl: { in: eflUrls } },
          ],
        },
        select: {
          id: true,
          supplier: true,
          planName: true,
          termMonths: true,
          eflSourceUrl: true,
          eflUrl: true,
          eflPdfSha256: true,
          repPuctCertificate: true,
          eflVersionCode: true,
          eflRequiresManualReview: true,
          rateStructure: true,
          planCalcStatus: true,
          planCalcReasonCode: true,
          requiredBucketKeys: true,
        },
      })) as any[];

      for (const p of existingByUrl) {
        if (p?.eflSourceUrl) urlToRatePlan.set(String(p.eflSourceUrl), p);
        if (p?.eflUrl) urlToRatePlan.set(String(p.eflUrl), p);
      }
    }

    const results: BatchResultRow[] = [];
    let scannedCount = 0;
    let processedCount = 0; // count of offers with EFL URLs attempted in this run
    let truncated = false;
    let nextStartIndex: number | null = null;

    // Optional: compute usage buckets for a specific home and attach previews.
    // This is intentionally opt-in because it writes to usage tables.
    let usageContext: BatchResponse extends { ok: true } ? any : any = null;
    let homeIdForUsage: string | null = null;
    let esiidForUsage: string | null = null;
    const usageErrors: string[] = [];
    const tdspRatesCache = new Map<string, Promise<any | null>>();

    offerLoop: for (const offer of sliced as OfferNormalized[]) {
      scannedCount++;
      const offerId = offer.offer_id ?? null;
      const supplier: string | null = offer.supplier_name ?? null;
      const planName: string | null = offer.plan_name ?? offer.offer_id ?? null;
      const termMonths: number | null = offer.term_months ?? null;
      const tdspName: string | null =
        (offer.raw as any)?.offer_data?.utility ??
        offer.distributor_name ??
        offer.tdsp ??
        null;
      const tdspSlug: string | null = (offer as any)?.tdsp ? String((offer as any).tdsp) : null;
      const eflCandidateUrls = collectOfferEflCandidateUrls(offer);
      const docsEflUrl: string | null = offer.docs?.efl ?? null;
      const enrollLink: string | null = (offer as any)?.enroll_link ?? null;
      const eflSeedUrl: string | null = eflCandidateUrls[0] ?? null;
      const offerRate500 = (offer as any)?.kwh500_cents ?? null;
      const offerRate1000 = (offer as any)?.kwh1000_cents ?? null;
      const offerRate2000 = (offer as any)?.kwh2000_cents ?? null;
      const offerCancelFee = (offer as any)?.cancel_fee_text ?? null;
      const offerState = state;
      // WattBuy catalog does not currently return a stable EIA utilityId per offer;
      // store an "UNKNOWN" placeholder unless we later thread a real utilityId.
      const offerUtilityId = "UNKNOWN";

      // Safety: stop early if we are approaching our time budget, so we never hit a Vercel timeout.
      if (shouldStopForTimeBudget()) {
        truncated = true;
        nextStartIndex = offerSliceStartIndex + (scannedCount - 1);
        break;
      }

      // Secondary safety: cap how many EFL-bearing offers we run per invocation.
      if (processedCount >= processLimit) {
        truncated = true;
        nextStartIndex = offerSliceStartIndex + (scannedCount - 1);
        break;
      }

      if (!eflSeedUrl) {
        // Since we already filter out non-electricity offers upstream, a missing EFL
        // URL is an operational issue we must surface. We queue it for review using
        // a stable synthetic fingerprint (we don't have a PDF SHA).
        const syntheticSha = sha256Hex(
          [
            "wattbuy-no-efl",
            offerId ?? "",
            supplier ?? "",
            planName ?? "",
            tdspName ?? "",
            String(termMonths ?? ""),
            line1,
            city,
            state,
            zip,
          ].join("|"),
        );

        try {
          await (prisma as any).eflParseReviewQueue.upsert({
            where: { eflPdfSha256: syntheticSha },
            create: {
              source: "wattbuy_batch",
              eflPdfSha256: syntheticSha,
              repPuctCertificate: null,
              eflVersionCode: null,
              offerId: offerId ?? null,
              supplier: supplier ?? null,
              planName: planName ?? null,
              eflUrl: null,
              tdspName: tdspName ?? null,
              termMonths: termMonths ?? null,
              rawText: null,
              planRules: null,
              rateStructure: null,
              validation: null,
              derivedForValidation: null,
              finalStatus: "SKIP",
              queueReason:
                "WattBuy electricity offer is missing usable EFL links in docs and enroll metadata.",
              solverApplied: [],
            },
            update: {
              offerId: offerId ?? null,
              supplier: supplier ?? null,
              planName: planName ?? null,
              tdspName: tdspName ?? null,
              termMonths: termMonths ?? null,
              finalStatus: "SKIP",
              queueReason:
                "WattBuy electricity offer is missing usable EFL links in docs and enroll metadata.",
            },
          });
        } catch {
          // Best-effort only; do not fail the batch because queue write failed.
        }

        results.push({
          offerId,
          supplier,
          planName,
          termMonths,
          tdspName,
          tdspSlug,
          eflUrl: null,
          eflPdfSha256: null,
          repPuctCertificate: null,
          eflVersionCode: null,
          validationStatus: null,
          tdspAppliedMode: null,
          parseConfidence: null,
          templateAction: "NOT_ELIGIBLE",
          queueReason:
            "Queued: WattBuy electricity offer is missing usable EFL links in docs and enroll metadata.",
          notes: "No EFL URL present on offer (queued for admin review).",
        });
        continue;
      }

      // 0) Fast path by URL: if we already have a persisted template for this URL,
      // skip fetching PDFs and re-running the EFL pipeline.
      if (!forceReparseTemplates) {
        const existingUrlPlan =
          eflCandidateUrls
            .map((url) => urlToRatePlan.get(url) ?? null)
            .find((plan) => Boolean(plan)) ?? null;
        if (isUsableTemplate(existingUrlPlan)) {
          // If we're in STORE mode, this "template hit" is evidence the queue item no longer
          // needs attention. Auto-resolve any matching OPEN queue rows.
          //
          // IMPORTANT: DRY_RUN contract must remain side-effect-free, so never resolve there.
          if (mode === "STORE_TEMPLATES_ON_PASS") {
            try {
              await (prisma as any).eflParseReviewQueue.updateMany({
                where: {
                  resolvedAt: null,
                  OR: [
                    ...(existingUrlPlan.eflUrl
                      ? [{ eflUrl: String(existingUrlPlan.eflUrl) }]
                      : []),
                    ...eflCandidateUrls.map((url) => ({ eflUrl: url })),
                    ...(existingUrlPlan.eflSourceUrl
                      ? [{ eflUrl: String(existingUrlPlan.eflSourceUrl) }]
                      : []),
                    ...(existingUrlPlan.repPuctCertificate && existingUrlPlan.eflVersionCode
                      ? [
                          {
                            repPuctCertificate: String(existingUrlPlan.repPuctCertificate),
                            eflVersionCode: String(existingUrlPlan.eflVersionCode),
                          },
                        ]
                      : []),
                    ...(existingUrlPlan.eflPdfSha256
                      ? [{ eflPdfSha256: String(existingUrlPlan.eflPdfSha256) }]
                      : []),
                  ],
                },
                data: {
                  resolvedAt: new Date(),
                  resolvedBy: "AUTO_TEMPLATE_HIT",
                  resolutionNotes: "Auto-resolved: template already exists for this EFL.",
                },
              });
            } catch {
              // Best-effort only: never block batch results on queue cleanup.
            }
          }
          results.push({
            offerId,
            supplier,
            planName,
            termMonths,
            tdspName,
            tdspSlug,
            eflUrl: existingUrlPlan.eflUrl ?? eflSeedUrl,
            eflPdfSha256: existingUrlPlan.eflPdfSha256 ?? null,
            repPuctCertificate: existingUrlPlan.repPuctCertificate ?? null,
            eflVersionCode: existingUrlPlan.eflVersionCode ?? null,
            validationStatus: "PASS",
            originalValidationStatus: "PASS",
            finalValidationStatus: "PASS",
            tdspAppliedMode: null,
            parseConfidence: null,
            passStrength: null,
            passStrengthReasons: null,
            passStrengthOffPointDiffs: null,
            planCalcStatus: (existingUrlPlan as any)?.planCalcStatus ?? null,
            planCalcReasonCode: (existingUrlPlan as any)?.planCalcReasonCode ?? null,
            requiredBucketKeys: Array.isArray((existingUrlPlan as any)?.requiredBucketKeys)
              ? (((existingUrlPlan as any).requiredBucketKeys as string[]) ?? [])
              : null,
            templateHit: true,
            templateAction: mode === "STORE_TEMPLATES_ON_PASS" ? "TEMPLATE" : "SKIPPED",
            queueReason: null,
            finalQueueReason: null,
            solverApplied: null,
            notes:
              docsEflUrl
                ? "Template hit (by URL): RatePlan already has rateStructure for this EFL."
                : "Template hit (via enroll_link): RatePlan already has rateStructure for this offer.",
          });
          continue;
        }
      }

      processedCount++;

      try {
        const fetchFailures: string[] = [];
        const nonEflCandidates: string[] = [];
        let pipelineResult: any = null;
        let resolvedDocUrl: string | null = null;
        let fetchedCandidateUrl: string | null = null;
        let pdfSha256: string | null = null;

        for (const candidateUrl of eflCandidateUrls) {
          const fetchedRes = await fetchEflSourceFromUrl(candidateUrl, { timeoutMs: 20_000 });
          if (!fetchedRes.ok) {
            fetchFailures.push(`${candidateUrl} -> ${fetchedRes.error ?? "fetch failed"}`);
            continue;
          }

          const fetched = fetchedRes;
          fetchedCandidateUrl = candidateUrl;
          const pdfBytes = fetched.kind === "pdf" ? fetched.pdfBytes : null;
          pdfSha256 = pdfBytes ? computePdfSha256(pdfBytes) : null;
          resolvedDocUrl =
            fetched.kind === "pdf"
              ? (fetched.pdfUrl ?? fetchedCandidateUrl ?? eflSeedUrl)
              : (fetched.sourceUrl ?? fetchedCandidateUrl ?? eflSeedUrl);
          const prefetchedRawText = fetched.kind === "raw_text" ? fetched.rawText : null;

          // 2a) Fast path: if we already have a saved RatePlan.rateStructure for
          // this exact EFL fingerprint (and it doesn't require manual review),
          // skip running the expensive EFL pipeline entirely.
          if (!forceReparseTemplates && pdfSha256) {
            const existing = (await prisma.ratePlan.findFirst({
              where: { eflPdfSha256: pdfSha256 } as any,
            })) as any;

            if (isUsableTemplate(existing)) {
              // Same logic as URL fast-path: in STORE mode, a template hit means any OPEN queue
              // rows for this EFL should be cleared.
              if (mode === "STORE_TEMPLATES_ON_PASS") {
                try {
                  await (prisma as any).eflParseReviewQueue.updateMany({
                    where: {
                      resolvedAt: null,
                      OR: [
                        { eflPdfSha256: pdfSha256 },
                        { eflUrl: resolvedDocUrl },
                        ...eflCandidateUrls.map((url) => ({ eflUrl: url })),
                        ...(existing.eflUrl ? [{ eflUrl: String(existing.eflUrl) }] : []),
                        ...(existing.eflSourceUrl
                          ? [{ eflUrl: String(existing.eflSourceUrl) }]
                          : []),
                        ...(existing.repPuctCertificate && existing.eflVersionCode
                          ? [
                              {
                                repPuctCertificate: String(existing.repPuctCertificate),
                                eflVersionCode: String(existing.eflVersionCode),
                              },
                            ]
                          : []),
                      ],
                    },
                    data: {
                      resolvedAt: new Date(),
                      resolvedBy: "AUTO_TEMPLATE_HIT",
                      resolutionNotes: "Auto-resolved: template already exists for this EFL.",
                    },
                  });
                } catch {
                  // Best-effort only.
                }
              }
              results.push({
                offerId,
                supplier,
                planName,
                termMonths,
                tdspName,
                eflUrl: resolvedDocUrl,
                eflPdfSha256: pdfSha256,
                repPuctCertificate: existing.repPuctCertificate ?? null,
                eflVersionCode: existing.eflVersionCode ?? null,
                // IMPORTANT: validationStatus must remain a real validation outcome
                // so downstream consumers that gate on PASS behave correctly.
                // "Template-ness" is represented by templateAction below.
                validationStatus: "PASS",
                originalValidationStatus: "PASS",
                finalValidationStatus: "PASS",
                tdspAppliedMode: null,
                parseConfidence: null,
                passStrength: null,
                passStrengthReasons: null,
                passStrengthOffPointDiffs: null,
                templateHit: true,
                // DRY_RUN contract: templateAction is always SKIPPED (no template
                // handling semantics). In STORE_TEMPLATES_ON_PASS, surface TEMPLATE.
                templateAction: mode === "STORE_TEMPLATES_ON_PASS" ? "TEMPLATE" : "SKIPPED",
                queueReason: null,
                finalQueueReason: null,
                solverApplied: null,
                notes:
                  docsEflUrl
                    ? "Template hit: RatePlan already has rateStructure for this EFL fingerprint."
                    : "Template hit: resolved EFL via enroll_link and found existing RatePlan.rateStructure.",
              });

              // REAL FIX: Even when we "hit" an existing template (no new persistence),
              // we must still link the WattBuy offer_id -> RatePlan.id so consumer UIs
              // show "IntelliWatt calculation available" rather than "Queued".
              //
              // Safety: this mapping is keyed by the exact offerId.
              if (mode === "STORE_TEMPLATES_ON_PASS" && offerId && (existing as any)?.id) {
                const ratePlanId = String((existing as any).id);
                try {
                  await (prisma as any).offerIdRatePlanMap.upsert({
                    where: { offerId: String(offerId) },
                    create: {
                      offerId: String(offerId),
                      ratePlanId,
                      lastLinkedAt: new Date(),
                      linkedBy: "wattbuy-batch-template-hit",
                    },
                    update: {
                      ratePlanId,
                      lastLinkedAt: new Date(),
                      linkedBy: "wattbuy-batch-template-hit",
                    },
                  });
                } catch {
                  // Best-effort; do not fail the batch run due to mapping bookkeeping.
                }

                // Secondary enrichment: update OfferRateMap if it exists (never create).
                try {
                  await (prisma as any).offerRateMap.updateMany({
                    where: { offerId: String(offerId) },
                    data: { ratePlanId, lastSeenAt: new Date() },
                  });
                } catch {
                  // Best-effort only.
                }
              }
              continue offerLoop;
            }
          }

          // 2b) Canonical pipeline: single source of truth.
          const candidatePipelineResult = await runEflPipeline({
            source: "batch",
            actor: "system",
            dryRun: mode === "DRY_RUN",
            queueNonEflDocuments: false,
            offerId,
            eflUrl: resolvedDocUrl,
            eflSourceUrl: fetchedCandidateUrl ?? eflSeedUrl,
            ...(pdfBytes ? { pdfBytes } : {}),
            ...(prefetchedRawText ? { rawText: prefetchedRawText } : {}),
            offerMeta: {
              supplier,
              planName,
              termMonths,
              tdspName,
            },
          });

          const candidateReason = String(candidatePipelineResult.queueReason ?? "");
          if (candidateReason.startsWith("NON_EFL_DOCUMENT")) {
            nonEflCandidates.push(`${candidateUrl} -> ${candidateReason}`);
            pipelineResult = candidatePipelineResult;
            continue;
          }

          pipelineResult = candidatePipelineResult;
          break;
        }

        if (!pipelineResult || String(pipelineResult.queueReason ?? "").startsWith("NON_EFL_DOCUMENT")) {
          // Ensure offers don't "disappear" from ops: if we can't even fetch the EFL,
          // queue a stable synthetic item keyed by URL + offer metadata.
          try {
            const syntheticSha = sha256Hex(
              [
                "wattbuy-fetch-efl-failed",
                ...eflCandidateUrls,
                offerId ?? "",
                supplier ?? "",
                planName ?? "",
                tdspName ?? "",
                String(termMonths ?? ""),
              ].join("|"),
            );

            const existingOpen = await (prisma as any).eflParseReviewQueue.findFirst({
              where: {
                resolvedAt: null,
                OR: eflCandidateUrls.map((url) => ({ eflUrl: url })),
              },
              select: { id: true },
            });

            const payload = {
              source: "wattbuy_batch",
              eflPdfSha256: syntheticSha,
              repPuctCertificate: null,
              eflVersionCode: null,
              offerId: offerId ?? null,
              supplier: supplier ?? null,
              planName: planName ?? null,
              eflUrl: eflSeedUrl,
              tdspName,
              termMonths,
              rawText: null,
              planRules: null,
              rateStructure: null,
              validation: null,
              derivedForValidation: null,
              finalStatus: "SKIP",
              queueReason: `EFL candidates exhausted: ${String([...nonEflCandidates, ...fetchFailures].join(" | ") || "unknown error")}`.slice(
                0,
                1000,
              ),
              solverApplied: [],
            } as const;

            if (existingOpen?.id) {
              await (prisma as any).eflParseReviewQueue.update({
                where: { id: existingOpen.id },
                data: payload,
              });
            } else {
              await (prisma as any).eflParseReviewQueue.create({ data: payload });
            }
          } catch {
            // Best-effort only; do not fail the batch because queue write failed.
          }

          results.push({
            offerId,
            supplier,
            planName,
            termMonths,
            tdspName,
            eflUrl: eflSeedUrl,
            eflPdfSha256: null,
            repPuctCertificate: null,
            eflVersionCode: null,
            validationStatus: null,
            tdspAppliedMode: null,
            parseConfidence: null,
            templateAction: "SKIPPED",
            queueReason: "Queued: EFL candidates exhausted (see notes).",
            notes: [...nonEflCandidates, ...fetchFailures].join(" | ").slice(0, 1000),
          });
          continue;
        }

        const effectiveValidation = pipelineResult.finalValidation ?? null;
        const finalStatus: string | null = effectiveValidation?.status ?? null;
        const tdspAppliedMode: string | null =
          effectiveValidation?.assumptionsUsed?.tdspAppliedMode ?? null;

        const diffs =
          Array.isArray(effectiveValidation?.points) && effectiveValidation.points.length
            ? effectiveValidation.points.map((p: any) => ({
                kwh: p.usageKwh,
                expected: p.expectedAvgCentsPerKwh ?? null,
                modeled: p.modeledAvgCentsPerKwh ?? null,
                diff: p.diffCentsPerKwh ?? null,
                ok: Boolean(p.ok),
              }))
            : undefined;

        let templateAction: BatchResultRow["templateAction"] = "SKIPPED";
        if (mode !== "DRY_RUN") {
          if (pipelineResult.ratePlanId) templateAction = "CREATED";
          else if (pipelineResult.queued) templateAction = "NOT_ELIGIBLE";
          else templateAction = "SKIPPED";
        }

        const notes = pipelineResult.ok !== true
          ? (pipelineResult.errors?.[0]?.message ?? "Pipeline failed")
          : pipelineResult.queued
            ? `Queued: ${pipelineResult.queueReason ?? "needs review"}`
            : pipelineResult.ratePlanId
              ? `Template persisted (ratePlanId=${pipelineResult.ratePlanId}).`
              : "Processed (no persistence).";

        results.push({
          offerId,
          supplier,
          planName,
          termMonths,
          tdspName,
          tdspSlug,
          eflUrl: resolvedDocUrl,
          eflPdfSha256: pipelineResult.eflPdfSha256 ?? pdfSha256,
          repPuctCertificate: pipelineResult.repPuctCertificate ?? null,
          eflVersionCode: pipelineResult.eflVersionCode ?? null,
          validationStatus: finalStatus,
          originalValidationStatus: (pipelineResult.validation as any)?.status ?? null,
          finalValidationStatus: finalStatus,
          tdspAppliedMode,
          parseConfidence: pipelineResult.parseConfidence ?? null,
          passStrength: pipelineResult.passStrength ?? null,
          passStrengthReasons: pipelineResult.passStrengthReasons ?? null,
          passStrengthOffPointDiffs: pipelineResult.passStrengthOffPointDiffs ?? null,
          planCalcStatus: (pipelineResult as any)?.planCalcStatus ?? null,
          planCalcReasonCode: (pipelineResult as any)?.planCalcReasonCode ?? null,
          requiredBucketKeys: Array.isArray((pipelineResult as any)?.requiredBucketKeys)
            ? ((pipelineResult as any).requiredBucketKeys as string[])
            : null,
          templateHit: false,
          templateAction,
          queueReason: pipelineResult.queueReason ?? null,
          finalQueueReason:
            pipelineResult.queueReason ??
            (effectiveValidation?.queueReason ? String(effectiveValidation.queueReason) : null),
          solverApplied: Array.isArray(pipelineResult.derivedForValidation?.solverApplied)
            ? (pipelineResult.derivedForValidation.solverApplied as string[])
            : null,
          notes,
          diffs,
        });
        continue;
      } catch (err: any) {
        // Catch-all: if the pipeline throws unexpectedly, queue it so it doesn't disappear from ops.
        try {
          const syntheticSha = sha256Hex(
            [
              "wattbuy-pipeline-exception",
              eflSeedUrl ?? "",
              offerId ?? "",
              supplier ?? "",
              planName ?? "",
              tdspName ?? "",
              String(termMonths ?? ""),
            ].join("|"),
          );

          const existingOpen = await (prisma as any).eflParseReviewQueue.findFirst({
            where: { resolvedAt: null, eflUrl: eflSeedUrl },
            select: { id: true },
          });

          const payload = {
            source: "wattbuy_batch",
            eflPdfSha256: syntheticSha,
            repPuctCertificate: null,
            eflVersionCode: null,
            offerId: offerId ?? null,
            supplier: supplier ?? null,
            planName: planName ?? null,
            eflUrl: eflSeedUrl,
            tdspName,
            termMonths,
            rawText: null,
            planRules: null,
            rateStructure: null,
            validation: null,
            derivedForValidation: null,
            finalStatus: "SKIP",
            queueReason: `Pipeline exception: ${String(err?.message || err || "unknown")}`.slice(
              0,
              1000,
            ),
            solverApplied: [],
          } as const;

          if (existingOpen?.id) {
            await (prisma as any).eflParseReviewQueue.update({
              where: { id: existingOpen.id },
              data: payload,
            });
          } else {
            await (prisma as any).eflParseReviewQueue.create({ data: payload });
          }
        } catch {
          // Best-effort only; do not fail the batch because queue write failed.
        }

        results.push({
          offerId,
          supplier,
          planName,
          termMonths,
          tdspName,
          eflUrl: eflSeedUrl,
          eflPdfSha256: null,
          repPuctCertificate: null,
          eflVersionCode: null,
          validationStatus: null,
          tdspAppliedMode: null,
          parseConfidence: null,
          templateAction: "SKIPPED",
          queueReason: "Queued: pipeline exception (see notes).",
          notes: err?.message || String(err),
        });
      }
    }

    // Optional: compute monthly usage buckets for the requested home and attach usage previews + cost estimates.
    if (mode !== "DRY_RUN" && computeUsageBuckets && usageEmail) {
      usageContext = {
        email: usageEmail,
        homeId: null,
        esiid: null,
        months: usageMonths,
        bucketKeys: [],
        computed: null,
        errors: [] as string[],
      };

      try {
        const user = await prisma.user.findUnique({
          where: { email: usageEmail },
          select: { id: true, email: true },
        });
        if (!user) {
          usageContext.errors.push("user_not_found");
        } else {
          const house =
            (await prisma.houseAddress.findFirst({
              where: { userId: user.id, archivedAt: null, isPrimary: true } as any,
              orderBy: { createdAt: "desc" },
              select: { id: true, esiid: true },
            })) ||
            (await prisma.houseAddress.findFirst({
              where: { userId: user.id, archivedAt: null } as any,
              orderBy: { createdAt: "desc" },
              select: { id: true, esiid: true },
            }));

          homeIdForUsage = house?.id ? String(house.id) : null;
          esiidForUsage = house?.esiid ? String(house.esiid) : null;
          usageContext.homeId = homeIdForUsage;
          usageContext.esiid = esiidForUsage;

          if (!homeIdForUsage) {
            usageContext.errors.push("missing_homeId");
          } else if (!esiidForUsage) {
            usageContext.errors.push("missing_esiid");
          } else {
            const wanted = Array.from(
              new Set(
                results
                  .flatMap((r) =>
                    Array.isArray((r as any)?.requiredBucketKeys)
                      ? (((r as any).requiredBucketKeys as string[]) ?? [])
                      : [],
                  )
                  .map((k) => String(k ?? "").trim())
                  .filter(Boolean),
              ),
            );

            // Always include total monthly kWh as the anchor for annual usage.
            const unionKeys = Array.from(new Set(["kwh.m.all.total", ...wanted]));
            usageContext.bucketKeys = unionKeys;

            // Cap to avoid accidental explosions from malformed templates.
            const cappedKeys = unionKeys.slice(0, 50);
            if (unionKeys.length > cappedKeys.length) {
              usageContext.errors.push(`bucketKey_cap_applied:${unionKeys.length}->${cappedKeys.length}`);
            }

            const bucketDefs = bucketDefsFromBucketKeys(cappedKeys);
            const canonicalCoverage = resolveCanonicalUsage365CoverageWindow();
            const rangeEnd = new Date(`${canonicalCoverage.endDate}T23:59:59.999Z`);
            const rangeStart = new Date(`${canonicalCoverage.startDate}T00:00:00.000Z`);

            const computed = await ensureCoreMonthlyBuckets({
              homeId: homeIdForUsage,
              esiid: esiidForUsage,
              rangeStart,
              rangeEnd,
              source: "SMT",
              intervalSource: "SMT",
              bucketDefs,
            });
            usageContext.computed = computed;

            const yearMonths = lastNYearMonthsChicago(usageMonths);
            const bucketRows = await (usagePrisma as any).homeMonthlyUsageBucket.findMany({
              where: {
                homeId: homeIdForUsage,
                yearMonth: { in: yearMonths },
                bucketKey: { in: cappedKeys },
              },
              select: { yearMonth: true, bucketKey: true, kwhTotal: true },
            });

            const byMonth: Record<string, Record<string, number>> = {};
            for (const r of bucketRows ?? []) {
              const ym = String((r as any)?.yearMonth ?? "");
              const key = String((r as any)?.bucketKey ?? "");
              const kwh = decimalToNumber((r as any)?.kwhTotal);
              if (!ym || !key || kwh == null) continue;
              if (!byMonth[ym]) byMonth[ym] = {};
              byMonth[ym][key] = kwh;
            }

            // Preload rateStructures for offers so we can compute cost previews.
            const offerIds = results.map((r) => String((r as any)?.offerId ?? "").trim()).filter(Boolean);
            const maps = await (prisma as any).offerIdRatePlanMap.findMany({
              where: { offerId: { in: offerIds }, ratePlanId: { not: null } },
              select: { offerId: true, ratePlanId: true },
            });
            const ratePlanIdByOfferId = new Map<string, string>();
            for (const m of maps as any[]) {
              const oid = String(m?.offerId ?? "").trim();
              const pid = String(m?.ratePlanId ?? "").trim();
              if (oid && pid) ratePlanIdByOfferId.set(oid, pid);
            }
            const ratePlanIds = Array.from(new Set(Array.from(ratePlanIdByOfferId.values())));
            const plans = await (prisma as any).ratePlan.findMany({
              where: { id: { in: ratePlanIds } },
              select: { id: true, rateStructure: true },
            });
            const rateStructureByPlanId = new Map<string, any>();
            for (const p of plans as any[]) {
              const pid = String(p?.id ?? "").trim();
              if (!pid) continue;
              rateStructureByPlanId.set(pid, p?.rateStructure ?? null);
            }

            const latestYm = yearMonths[0] ?? null;

            for (const r of results) {
              const requiredKeys = Array.isArray((r as any)?.requiredBucketKeys)
                ? (((r as any).requiredBucketKeys as string[]) ?? [])
                : [];
              const keysForRow = requiredKeys.length ? requiredKeys : ["kwh.m.all.total"];

              const avgMonthlyKwhByKey: Record<string, number> = {};
              const latestMonthKwhByKey: Record<string, number> = {};
              const missingKeys: string[] = [];

              for (const key of keysForRow) {
                const vals: number[] = [];
                for (const ym of yearMonths) {
                  const v = byMonth?.[ym]?.[key];
                  if (typeof v === "number" && Number.isFinite(v)) vals.push(v);
                }
                if (vals.length === 0) {
                  missingKeys.push(key);
                } else {
                  const avg = vals.reduce((a, b) => a + b, 0) / vals.length;
                  avgMonthlyKwhByKey[key] = Number(avg.toFixed(3));
                }

                if (latestYm && typeof byMonth?.[latestYm]?.[key] === "number") {
                  latestMonthKwhByKey[key] = Number(byMonth[latestYm][key].toFixed(3));
                }
              }

              const annualKwh = (() => {
                const vals: number[] = [];
                for (const ym of yearMonths) {
                  const v = byMonth?.[ym]?.["kwh.m.all.total"];
                  if (typeof v === "number" && Number.isFinite(v)) vals.push(v);
                }
                if (vals.length === 0) return null;
                return Number(vals.reduce((a, b) => a + b, 0).toFixed(3));
              })();

              (r as any).usagePreview = {
                months: yearMonths.length,
                annualKwh,
                avgMonthlyKwhByKey,
                latestMonthKwhByKey,
                missingKeys,
              };

              // Best-effort cost preview (does NOT change gating; admin-only diagnostics)
              try {
                const tdspSlug = String((r as any)?.tdspSlug ?? "").trim().toLowerCase();
                const offerId = String((r as any)?.offerId ?? "").trim();
                const planId = offerId ? ratePlanIdByOfferId.get(offerId) ?? null : null;
                const rateStructure = planId ? rateStructureByPlanId.get(planId) ?? null : null;
                if (!tdspSlug || !annualKwh || !rateStructure) {
                  (r as any).usageEstimate = null;
                  continue;
                }

                const tdspRatesP =
                  tdspRatesCache.get(tdspSlug) ??
                  (async () => await getTdspDeliveryRates({ tdspSlug, asOf: new Date() }))();
                tdspRatesCache.set(tdspSlug, tdspRatesP);
                const tdspRates = await tdspRatesP;
                if (!tdspRates) {
                  (r as any).usageEstimate = { status: "NOT_IMPLEMENTED", reason: "Missing TDSP rates" };
                  continue;
                }

                const est = calculatePlanCostForUsage({
                  annualKwh,
                  monthsCount: yearMonths.length || usageMonths,
                  tdsp: {
                    perKwhDeliveryChargeCents: Number(tdspRates.perKwhDeliveryChargeCents ?? 0) || 0,
                    monthlyCustomerChargeDollars: Number(tdspRates.monthlyCustomerChargeDollars ?? 0) || 0,
                    effectiveDate: tdspRates.effectiveDate ?? undefined,
                  },
                  rateStructure,
                  usageBucketsByMonth: byMonth,
                });
                (r as any).usageEstimate = est as any;
              } catch (e: any) {
                (r as any).usageEstimate = { status: "ERROR", reason: e?.message ?? String(e) };
              }
            }
          }
        }
      } catch (e: any) {
        usageErrors.push(e?.message ?? String(e));
        usageContext = usageContext ?? { email: usageEmail, homeId: null, esiid: null, months: usageMonths, bucketKeys: [], computed: null, errors: [] };
        usageContext.errors = [...(usageContext.errors ?? []), ...usageErrors];
      }
    }

    const bodyOut: BatchResponse = {
      ok: true,
      mode,
      offerCount: offers.length,
      offerSliceStartIndex,
      offerSliceEndIndex,
      scannedCount,
      processedCount,
      truncated,
      nextStartIndex,
      results,
      usageContext: usageContext ?? null,
    };

    return NextResponse.json(bodyOut);
  } catch (error) {
    // eslint-disable-next-line no-console
    console.error("[ADMIN_WATTBUY_BATCH_EFL_PARSE] Unexpected error:", error);
    return jsonError(
      500,
      "Internal error while running WattBuy batch EFL parser",
      error instanceof Error ? error.message : String(error),
    );
  }
}

