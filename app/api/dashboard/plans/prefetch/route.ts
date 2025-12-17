import { NextRequest, NextResponse } from "next/server";
import { cookies } from "next/headers";
import crypto from "node:crypto";

import { prisma } from "@/lib/db";
import { normalizeEmail } from "@/lib/utils/email";
import { wattbuy } from "@/lib/wattbuy";
import { normalizeOffers } from "@/lib/wattbuy/normalize";
import { fetchEflPdfFromUrl } from "@/lib/efl/fetchEflPdf";
import { runEflPipelineNoStore } from "@/lib/efl/runEflPipelineNoStore";
import { validatePlanRules } from "@/lib/efl/planEngine";
import { upsertRatePlanFromEfl } from "@/lib/efl/planPersistence";
import { inferTdspTerritoryFromEflText } from "@/lib/efl/eflValidator";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function parseBool(v: string | null, fallback: boolean): boolean {
  if (v == null) return fallback;
  const s = v.trim().toLowerCase();
  if (!s) return fallback;
  if (["1", "true", "yes", "y", "on"].includes(s)) return true;
  if (["0", "false", "no", "n", "off"].includes(s)) return false;
  return fallback;
}

function sha256Hex(s: string): string {
  return crypto.createHash("sha256").update(s).digest("hex");
}

export async function POST(req: NextRequest) {
  try {
    const cookieStore = cookies();
    const sessionEmail = cookieStore.get("intelliwatt_user")?.value ?? null;
    if (!sessionEmail) {
      return NextResponse.json({ ok: false, error: "not_authenticated" }, { status: 401 });
    }

    const userEmail = normalizeEmail(sessionEmail);
    const user = await prisma.user.findUnique({
      where: { email: userEmail },
      select: { id: true },
    });
    if (!user) {
      return NextResponse.json({ ok: false, error: "user_not_found" }, { status: 404 });
    }

    // Primary (or most recent) home.
    let house = await prisma.houseAddress.findFirst({
      where: { userId: user.id, archivedAt: null, isPrimary: true } as any,
      orderBy: { createdAt: "desc" },
      select: {
        id: true,
        addressLine1: true,
        addressCity: true,
        addressState: true,
        addressZip5: true,
      },
    });
    if (!house) {
      house = await prisma.houseAddress.findFirst({
        where: { userId: user.id, archivedAt: null } as any,
        orderBy: { createdAt: "desc" },
        select: {
          id: true,
          addressLine1: true,
          addressCity: true,
          addressState: true,
          addressZip5: true,
        },
      });
    }
    if (!house) {
      return NextResponse.json({ ok: false, error: "no_home" }, { status: 400 });
    }

    const url = new URL(req.url);
    const isRenter = parseBool(url.searchParams.get("isRenter"), false);
    const timeBudgetMsRaw = Number(url.searchParams.get("timeBudgetMs") ?? "8000");
    const timeBudgetMs = Number.isFinite(timeBudgetMsRaw) ? Math.max(1500, Math.min(25000, timeBudgetMsRaw)) : 8000;
    const maxOffersRaw = Number(url.searchParams.get("maxOffers") ?? "4");
    const maxOffers = Number.isFinite(maxOffersRaw) ? Math.max(1, Math.min(10, Math.floor(maxOffersRaw))) : 4;

    const startedAt = Date.now();

    // Fetch offers (live).
    const raw = await wattbuy.offers({
      address: house.addressLine1,
      city: house.addressCity,
      state: house.addressState,
      zip: house.addressZip5,
      isRenter,
    });
    const normalized = normalizeOffers(raw ?? {});

    // Which offers are already mapped?
    const offerIds = normalized.offers.map((o) => o.offer_id).filter(Boolean);
    const existingMaps = await (prisma as any).offerIdRatePlanMap.findMany({
      where: { offerId: { in: offerIds }, ratePlanId: { not: null } },
      select: { offerId: true, ratePlanId: true },
    });
    const mappedOfferIds = new Set<string>(
      (existingMaps as Array<{ offerId: string }>).map((m) => String(m.offerId)),
    );

    const candidates = normalized.offers.filter((o) => {
      if (!o.offer_id) return false;
      if (mappedOfferIds.has(o.offer_id)) return false;
      // We can only auto-template if we have an EFL URL (or we’ll queue it).
      return true;
    });

    let processed = 0;
    let createdOrLinked = 0;
    let queued = 0;
    const results: any[] = [];

    for (const o of candidates) {
      if (processed >= maxOffers) break;
      if (Date.now() - startedAt > timeBudgetMs) break;

      processed++;
      const offerId = String(o.offer_id);
      const supplier = o.supplier_name ?? null;
      const planName = o.plan_name ?? null;
      const termMonths = typeof o.term_months === "number" ? o.term_months : null;
      const tdspName = o.distributor_name ?? null;
      const eflUrl = o.docs?.efl ?? null;

      if (!eflUrl) {
        // Queue for manual review (missing EFL URL).
        try {
          const syntheticSha = sha256Hex(["dashboard_prefetch", "MISSING_EFL_URL", offerId, supplier ?? "", planName ?? ""].join("|"));
          await (prisma as any).eflParseReviewQueue.upsert({
            where: { eflPdfSha256: syntheticSha },
            create: {
              source: "dashboard_prefetch",
              eflPdfSha256: syntheticSha,
              offerId,
              supplier,
              planName,
              eflUrl: null,
              tdspName,
              termMonths,
              finalStatus: "SKIP",
              queueReason: "Missing EFL URL (cannot auto-parse).",
            },
            update: {
              updatedAt: new Date(),
              offerId,
              supplier,
              planName,
              eflUrl: null,
              tdspName,
              termMonths,
              finalStatus: "SKIP",
              queueReason: "Missing EFL URL (cannot auto-parse).",
              resolvedAt: null,
              resolvedBy: null,
              resolutionNotes: null,
            },
          });
          queued++;
        } catch {
          // Best-effort.
        }
        results.push({ offerId, action: "QUEUED", reason: "MISSING_EFL_URL" });
        continue;
      }

      // Fetch PDF bytes (handles landing pages).
      const pdf = await fetchEflPdfFromUrl(eflUrl, { timeoutMs: 20_000 });
      if (!pdf.ok) {
        try {
          const syntheticSha = sha256Hex(["dashboard_prefetch", "FETCH_FAIL", offerId, eflUrl].join("|"));
          await (prisma as any).eflParseReviewQueue.upsert({
            where: { eflPdfSha256: syntheticSha },
            create: {
              source: "dashboard_prefetch",
              eflPdfSha256: syntheticSha,
              offerId,
              supplier,
              planName,
              eflUrl,
              tdspName,
              termMonths,
              finalStatus: "FAIL",
              queueReason: `EFL fetch failed: ${pdf.error}`,
            },
            update: {
              updatedAt: new Date(),
              offerId,
              supplier,
              planName,
              eflUrl,
              tdspName,
              termMonths,
              finalStatus: "FAIL",
              queueReason: `EFL fetch failed: ${pdf.error}`,
              resolvedAt: null,
              resolvedBy: null,
              resolutionNotes: null,
            },
          });
          queued++;
        } catch {
          // Best-effort.
        }
        results.push({ offerId, action: "QUEUED", reason: "EFL_FETCH_FAILED" });
        continue;
      }

      // Run full pipeline (deterministic extract -> AI parse -> validate -> solver -> pass strength)
      const pipeline = await runEflPipelineNoStore({
        pdfBytes: pdf.pdfBytes,
        source: "wattbuy",
        offerMeta: { supplier, planName, termMonths, tdspName, offerId },
      });

      const det = pipeline.deterministic;
      const finalValidation = pipeline.finalValidation ?? null;
      const finalStatus: string | null = finalValidation?.status ?? null;
      const passStrength = (pipeline.passStrength ?? null) as any;

      const canAutoTemplate =
        finalStatus === "PASS" &&
        passStrength === "STRONG" &&
        det.eflPdfSha256 &&
        pipeline.planRules &&
        pipeline.rateStructure;

      if (!canAutoTemplate) {
        // Queue for manual admin review (either FAIL/SKIP, or PASS but WEAK/INVALID).
        try {
          const queueSha =
            det.eflPdfSha256 ??
            sha256Hex(["dashboard_prefetch", "PIPELINE_NO_TEMPLATE", offerId, pdf.pdfUrl].join("|"));
          await (prisma as any).eflParseReviewQueue.upsert({
            where: { eflPdfSha256: queueSha },
            create: {
              source: "dashboard_prefetch",
              eflPdfSha256: queueSha,
              repPuctCertificate: det.repPuctCertificate ?? null,
              eflVersionCode: det.eflVersionCode ?? null,
              offerId,
              supplier,
              planName,
              eflUrl: pdf.pdfUrl ?? eflUrl,
              tdspName,
              termMonths,
              rawText: det.rawText ?? null,
              planRules: pipeline.planRules ?? null,
              rateStructure: pipeline.rateStructure ?? null,
              validation: pipeline.validation ?? null,
              derivedForValidation: pipeline.derivedForValidation ?? null,
              finalStatus: String(finalStatus ?? "FAIL"),
              queueReason: String(finalValidation?.queueReason ?? "Not eligible for auto-templating (requires admin review)."),
              solverApplied: pipeline.derivedForValidation?.solverApplied ?? null,
            },
            update: {
              updatedAt: new Date(),
              repPuctCertificate: det.repPuctCertificate ?? null,
              eflVersionCode: det.eflVersionCode ?? null,
              offerId,
              supplier,
              planName,
              eflUrl: pdf.pdfUrl ?? eflUrl,
              tdspName,
              termMonths,
              rawText: det.rawText ?? null,
              planRules: pipeline.planRules ?? null,
              rateStructure: pipeline.rateStructure ?? null,
              validation: pipeline.validation ?? null,
              derivedForValidation: pipeline.derivedForValidation ?? null,
              finalStatus: String(finalStatus ?? "FAIL"),
              queueReason: String(finalValidation?.queueReason ?? "Not eligible for auto-templating (requires admin review)."),
              solverApplied: pipeline.derivedForValidation?.solverApplied ?? null,
              resolvedAt: null,
              resolvedBy: null,
              resolutionNotes: null,
            },
          });
          queued++;
        } catch {
          // Best-effort.
        }
        results.push({
          offerId,
          action: "QUEUED",
          reason: finalStatus === "PASS" ? `PASS_${passStrength ?? "UNKNOWN"}` : `STATUS_${finalStatus ?? "UNKNOWN"}`,
        });
        continue;
      }

      // Persist template and link offerId -> ratePlanId.
      const points: any[] = Array.isArray(finalValidation?.points) ? finalValidation.points : [];
      const pickExpected = (kwh: number): number | null => {
        const p = points.find((x: any) => Number(x?.usageKwh ?? x?.kwh ?? x?.usage) === kwh);
        const n = Number(p?.expectedAvgCentsPerKwh ?? p?.expectedAvgPriceCentsPerKwh);
        return Number.isFinite(n) ? n : null;
      };
      const pickModeled = (kwh: number): number | null => {
        const p = points.find((x: any) => Number(x?.usageKwh ?? x?.kwh ?? x?.usage) === kwh);
        const n = Number(p?.modeledAvgCentsPerKwh ?? p?.modeledAvgPriceCentsPerKwh ?? p?.modeledCentsPerKwh);
        return Number.isFinite(n) ? n : null;
      };

      const planRulesValidation = validatePlanRules(pipeline.planRules as any);
      if (planRulesValidation?.requiresManualReview === true) {
        // Treat as queue (we refuse to persist ambiguous templates).
        results.push({ offerId, action: "QUEUED", reason: "PLANRULES_REQUIRES_MANUAL_REVIEW" });
        continue;
      }

      const modeledAt = new Date();
      const rsWithEvidence =
        pipeline.rateStructure && typeof pipeline.rateStructure === "object"
          ? ({
              ...(pipeline.rateStructure as any),
              __eflAvgPriceValidation: finalValidation ?? null,
              __eflAvgPriceEvidence: {
                computedAt: modeledAt.toISOString(),
                source: "dashboard_prefetch",
                passStrength: passStrength ?? null,
                tdspAppliedMode: finalValidation?.assumptionsUsed?.tdspAppliedMode ?? null,
              },
            } as any)
          : (pipeline.rateStructure as any);

      const saved = await upsertRatePlanFromEfl({
        mode: "live",
        eflUrl: pdf.pdfUrl,
        eflSourceUrl: eflUrl,
        repPuctCertificate: det.repPuctCertificate ?? null,
        eflVersionCode: det.eflVersionCode ?? null,
        eflPdfSha256: String(det.eflPdfSha256),
        utilityId: inferTdspTerritoryFromEflText(det.rawText) ?? null,
        state: "TX",
        termMonths,
        rate500: pickExpected(500) ?? (typeof o.kwh500_cents === "number" ? o.kwh500_cents : null),
        rate1000: pickExpected(1000) ?? (typeof o.kwh1000_cents === "number" ? o.kwh1000_cents : null),
        rate2000: pickExpected(2000) ?? (typeof o.kwh2000_cents === "number" ? o.kwh2000_cents : null),
        modeledRate500: pickModeled(500),
        modeledRate1000: pickModeled(1000),
        modeledRate2000: pickModeled(2000),
        modeledEflAvgPriceValidation: finalValidation ?? null,
        modeledComputedAt: modeledAt,
        cancelFee: o.cancel_fee_text ?? null,
        providerName: supplier,
        planName,
        planRules: pipeline.planRules as any,
        rateStructure: rsWithEvidence as any,
        validation: planRulesValidation as any,
      });

      const templatePersisted = Boolean((saved as any)?.templatePersisted);
      const ratePlanId = (saved as any)?.ratePlan?.id ? String((saved as any).ratePlan.id) : null;

      if (templatePersisted && ratePlanId) {
        try {
          await (prisma as any).offerIdRatePlanMap.upsert({
            where: { offerId },
            create: {
              offerId,
              ratePlanId,
              lastLinkedAt: new Date(),
              linkedBy: "dashboard-prefetch",
            },
            update: {
              ratePlanId,
              lastLinkedAt: new Date(),
              linkedBy: "dashboard-prefetch",
            },
          });
        } catch {
          // Best-effort.
        }
        try {
          await (prisma as any).offerRateMap.updateMany({
            where: { offerId },
            data: { ratePlanId, lastSeenAt: new Date() },
          });
        } catch {
          // Best-effort.
        }
        createdOrLinked++;
        results.push({ offerId, action: "LINKED", ratePlanId });
      } else {
        // If template didn't persist due to missing fields, queue it.
        try {
          const queueSha = det.eflPdfSha256 ?? sha256Hex(["dashboard_prefetch", "TEMPLATE_NOT_PERSISTED", offerId, pdf.pdfUrl].join("|"));
          const missing = Array.isArray((saved as any)?.missingTemplateFields)
            ? ((saved as any).missingTemplateFields as string[])
            : [];
          await (prisma as any).eflParseReviewQueue.upsert({
            where: { eflPdfSha256: queueSha },
            create: {
              source: "dashboard_prefetch",
              eflPdfSha256: queueSha,
              repPuctCertificate: det.repPuctCertificate ?? null,
              eflVersionCode: det.eflVersionCode ?? null,
              offerId,
              supplier,
              planName,
              eflUrl: pdf.pdfUrl ?? eflUrl,
              tdspName,
              termMonths,
              rawText: det.rawText ?? null,
              planRules: pipeline.planRules ?? null,
              rateStructure: pipeline.rateStructure ?? null,
              validation: pipeline.validation ?? null,
              derivedForValidation: pipeline.derivedForValidation ?? null,
              finalStatus: String(finalStatus ?? "FAIL"),
              queueReason: missing.length ? `Template not persisted (missing fields): ${missing.join(", ")}` : "Template not persisted.",
              solverApplied: pipeline.derivedForValidation?.solverApplied ?? null,
            },
            update: {
              updatedAt: new Date(),
              offerId,
              supplier,
              planName,
              eflUrl: pdf.pdfUrl ?? eflUrl,
              tdspName,
              termMonths,
              finalStatus: String(finalStatus ?? "FAIL"),
              queueReason: missing.length ? `Template not persisted (missing fields): ${missing.join(", ")}` : "Template not persisted.",
              resolvedAt: null,
              resolvedBy: null,
              resolutionNotes: null,
            },
          });
          queued++;
        } catch {
          // Best-effort.
        }
        results.push({ offerId, action: "QUEUED", reason: "TEMPLATE_NOT_PERSISTED" });
      }
    }

    const remaining = Math.max(0, candidates.length - processed);
    return NextResponse.json({
      ok: true,
      processed,
      linked: createdOrLinked,
      queued,
      remaining,
      timeBudgetMs,
      durationMs: Date.now() - startedAt,
      results,
    });
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: e?.message ?? String(e) }, { status: 500 });
  }
}


