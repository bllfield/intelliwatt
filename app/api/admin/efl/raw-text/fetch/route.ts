import { NextRequest, NextResponse } from "next/server";
import { Buffer } from "node:buffer";

import { prisma } from "@/lib/db";
import { requireAdmin } from "@/lib/auth/admin";
import { fetchEflPdfFromUrl } from "@/lib/efl/fetchEflPdf";
import { runEflPipelineNoStore } from "@/lib/plan-engine-next/efl/runEflPipelineNoStore";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function jsonError(status: number, error: string, detail?: any) {
  return NextResponse.json({ ok: false, error, detail: detail ?? null }, { status });
}

export async function POST(req: NextRequest) {
  const gate = requireAdmin(req);
  if (!gate.ok) return NextResponse.json(gate.body, { status: gate.status });

  let body: any = null;
  try {
    body = await req.json();
  } catch {
    return jsonError(400, "invalid_json_body");
  }

  const offerId = String(body?.offerId ?? "").trim();
  const ratePlanId = String(body?.ratePlanId ?? "").trim();
  const overridePdfUrl = String(body?.overridePdfUrl ?? body?.overrideEflPdfUrl ?? "").trim();
  if (!offerId && !ratePlanId) return jsonError(400, "offerId_or_ratePlanId_required");

  try {
    const link = offerId
      ? await prisma.offerIdRatePlanMap.findUnique({
          where: { offerId },
          include: { ratePlan: true },
        })
      : null;

    const ratePlan =
      link?.ratePlan ??
      (ratePlanId
        ? await prisma.ratePlan.findUnique({
            where: { id: ratePlanId } as any,
          })
        : null);

    if (!ratePlan) return jsonError(404, "ratePlan_not_found");

    const masterPlan = offerId
      ? await prisma.masterPlan.findFirst({
          where: { offerId },
          select: { eflUrl: true, docs: true },
        })
      : null;

    const docsEfl = (masterPlan as any)?.docs?.efl ? String((masterPlan as any).docs.efl).trim() : "";
    const candidates = [
      overridePdfUrl,
      String((ratePlan as any)?.eflSourceUrl ?? "").trim(),
      String((ratePlan as any)?.eflUrl ?? "").trim(),
      String(masterPlan?.eflUrl ?? "").trim(),
      docsEfl,
    ].filter(Boolean);

    if (candidates.length === 0) return jsonError(409, "missing_efl_url");
    const eflUrl = candidates[0];

    const pdfRes = await fetchEflPdfFromUrl(eflUrl);
    if (!pdfRes || (pdfRes as any).ok !== true) {
      return jsonError(502, "efl_pdf_fetch_failed", {
        eflUrlTried: eflUrl,
        candidates,
        error: (pdfRes as any)?.error ?? null,
        notes: (pdfRes as any)?.notes ?? null,
      });
    }
    const pdfBuf = (pdfRes as any).pdfBytes as Buffer;

    // Run deterministic extract (via pipeline) to get rawText + sha.
    const pipeline = await runEflPipelineNoStore({
      pdfBytes: pdfBuf,
      source: "manual",
      offerMeta: {
        supplier: (ratePlan as any)?.supplier ?? null,
        planName: (ratePlan as any)?.planName ?? null,
        termMonths: typeof (ratePlan as any)?.termMonths === "number" ? (ratePlan as any).termMonths : null,
        tdspName: (ratePlan as any)?.utilityId ?? null,
        offerId: offerId || null,
      },
    });

    const sha = String(pipeline?.deterministic?.eflPdfSha256 ?? "").trim();
    const rawText = String(pipeline?.deterministic?.rawText ?? "");
    if (!sha) return jsonError(500, "missing_sha_from_pipeline");
    if (!rawText.trim()) return jsonError(500, "empty_raw_text_from_pipeline");

    // Store into EflParseReviewQueue (resolved) so /admin/plans/[offerId] can display it.
    // Use resolvedAt immediately so it doesn't create noisy OPEN queue items.
    const now = new Date();
    await (prisma as any).eflParseReviewQueue.upsert({
      where: { eflPdfSha256: sha },
      create: {
        source: "details_fetch",
        kind: "EFL_PARSE",
        dedupeKey: "",
        ratePlanId: ratePlan.id,
        eflPdfSha256: sha,
        repPuctCertificate: (ratePlan as any)?.repPuctCertificate ?? null,
        eflVersionCode: (ratePlan as any)?.eflVersionCode ?? null,
        offerId: offerId || null,
        supplier: (ratePlan as any)?.supplier ?? null,
        planName: (ratePlan as any)?.planName ?? null,
        eflUrl: eflUrl || null,
        tdspName: (ratePlan as any)?.utilityId ?? null,
        termMonths: typeof (ratePlan as any)?.termMonths === "number" ? (ratePlan as any).termMonths : null,
        rawText,
        planRules: pipeline.planRules ?? null,
        rateStructure: pipeline.rateStructure ?? null,
        validation: pipeline.validation ?? null,
        derivedForValidation: pipeline.derivedForValidation ?? null,
        finalStatus: "SKIP",
        queueReason: "AUTO_STORED_RAW_TEXT_FROM_DETAILS",
        solverApplied: null,
        resolvedAt: now,
        resolvedBy: "AUTO_RAWTEXT",
        resolutionNotes: "Auto-stored raw EFL text for plan details view.",
      },
      update: {
        ratePlanId: ratePlan.id,
        offerId: offerId || null,
        supplier: (ratePlan as any)?.supplier ?? null,
        planName: (ratePlan as any)?.planName ?? null,
        eflUrl: eflUrl || null,
        tdspName: (ratePlan as any)?.utilityId ?? null,
        termMonths: typeof (ratePlan as any)?.termMonths === "number" ? (ratePlan as any).termMonths : null,
        rawText,
        resolvedAt: now,
        resolvedBy: "AUTO_RAWTEXT",
        resolutionNotes: "Auto-stored raw EFL text for plan details view.",
      },
    });

    return NextResponse.json({
      ok: true,
      offerId: offerId || null,
      ratePlanId: String(ratePlan.id),
      eflUrl,
      candidates,
      pdfUrl: (pdfRes as any)?.pdfUrl ?? null,
      eflPdfSha256: sha,
      rawTextLength: rawText.length,
      stored: true,
    });
  } catch (e: any) {
    return jsonError(500, "unexpected_error", { message: e?.message ?? String(e) });
  }
}

