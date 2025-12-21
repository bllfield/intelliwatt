import { NextRequest, NextResponse } from "next/server";

import { prisma } from "@/lib/db";
import { normalizeTdspCode } from "@/lib/utility/tdspCode";

export const dynamic = "force-dynamic";

const ADMIN_TOKEN = process.env.ADMIN_TOKEN;

const KNOWN_TDSP_CODES = ["ONCOR", "CENTERPOINT", "AEP_NORTH", "AEP_CENTRAL", "TNMP"] as const;

function jsonError(status: number, error: string, details?: unknown) {
  return NextResponse.json(
    { ok: false, error, ...(details ? { details } : {}) },
    { status },
  );
}

export async function POST(req: NextRequest) {
  try {
    if (!ADMIN_TOKEN) return jsonError(500, "ADMIN_TOKEN is not configured");
    const headerToken = req.headers.get("x-admin-token");
    if (!headerToken || headerToken !== ADMIN_TOKEN) {
      return jsonError(401, "Unauthorized (invalid admin token)");
    }

    const sp = req.nextUrl.searchParams;
    const limitRaw = Number(sp.get("limit") ?? "500");
    const limit = Math.max(1, Math.min(2000, Number.isFinite(limitRaw) ? limitRaw : 500));
    const dryRun = (sp.get("dryRun") ?? "") === "1";
    const reopenResolved = (sp.get("reopenResolved") ?? "") === "1";

    // Find RatePlans where utilityId is UNKNOWN or otherwise UNMAPPED (we missed/failed to infer TDSP).
    const plans = await prisma.ratePlan.findMany({
      where: {
        isUtilityTariff: false,
        utilityId: { notIn: [...KNOWN_TDSP_CODES] },
        eflPdfSha256: { not: null },
        OR: [{ eflUrl: { not: null } }, { eflSourceUrl: { not: null } }],
      } as any,
      select: {
        id: true,
        utilityId: true,
        supplier: true,
        planName: true,
        termMonths: true,
        eflUrl: true,
        eflSourceUrl: true,
        repPuctCertificate: true,
        eflVersionCode: true,
        eflPdfSha256: true,
        eflRequiresManualReview: true,
        rateStructure: true,
      } as any,
      orderBy: { updatedAt: "desc" },
      take: limit,
    });

    let scanned = 0;
    let created = 0;
    let reopened = 0;
    let updated = 0;
    let skippedAlreadyOpen = 0;
    let skippedHasQuarantine = 0;
    let skippedNoSha = 0;
    const notes: string[] = [];

    for (const p of plans as any[]) {
      scanned++;

      const sha = String(p?.eflPdfSha256 ?? "").trim();
      if (!sha) {
        skippedNoSha++;
        continue;
      }

      // IMPORTANT: The DB may enforce uniqueness on repPuctCertificate+eflVersionCode (legacy dedupe).
      // So we must de-dupe on both sha AND cert+version to avoid create() failures.
      const cert = String(p?.repPuctCertificate ?? "").trim() || null;
      const ver = String(p?.eflVersionCode ?? "").trim() || null;
      const existing =
        (await (prisma as any).eflParseReviewQueue.findUnique({
          where: { eflPdfSha256: sha },
        })) ??
        (cert && ver
          ? await (prisma as any).eflParseReviewQueue.findFirst({
              where: { repPuctCertificate: cert, eflVersionCode: ver },
            })
          : null);

      const eflUrl = (p?.eflUrl ?? p?.eflSourceUrl ?? null) as string | null;
      const utilNorm = String(p?.utilityId ?? "").trim().toUpperCase();
      const canon = normalizeTdspCode(utilNorm);

      // If this is just an alias/abbreviation (e.g., AEPNOR), fix it in-place rather than enqueueing.
      if (canon && canon !== utilNorm) {
        if (!dryRun) {
          try {
            await prisma.ratePlan.update({
              where: { id: String(p.id) },
              data: { utilityId: canon },
            });
          } catch {
            // ignore
          }
        }
        updated++;
        continue;
      }
      const reasonCode = utilNorm === "UNKNOWN" ? "UNKNOWN_UTILITY_ID" : "UNMAPPED_UTILITY_ID";
      const payloadCommon: any = {
        ratePlanId: String(p.id),
        repPuctCertificate: cert,
        eflVersionCode: ver,
        supplier: p.supplier ?? null,
        planName: p.planName ?? null,
        eflUrl: eflUrl,
        tdspName: p.utilityId ?? null,
        termMonths: typeof p.termMonths === "number" ? p.termMonths : null,
        finalStatus: "NEEDS_REVIEW",
        queueReason: `${reasonCode}: RatePlan.utilityId=${utilNorm || "—"} (needs TDSP inference fix)`,
      };

      if (!existing) {
        if (!dryRun) {
          await (prisma as any).eflParseReviewQueue.create({
            data: {
              source: "unknown_utility_sweep",
              kind: "EFL_PARSE",
              // Leave dedupeKey blank; trigger will fill for EFL_PARSE.
              dedupeKey: "",
              eflPdfSha256: sha,
              offerId: null,
              rawText: null,
              planRules: null,
              rateStructure: p.rateStructure ?? null,
              validation: null,
              derivedForValidation: null,
              solverApplied: null,
              resolvedAt: null,
              resolvedBy: null,
              resolutionNotes: `Auto-queued because RatePlan.utilityId is ${utilNorm || "—"} (${reasonCode}).`,
              ...payloadCommon,
            },
          });
        }
        created++;
        continue;
      }

      // If an item already exists, do not override quarantines (sticky), but do keep metadata fresh.
      const existingKind = String(existing?.kind ?? "");
      if (existingKind === "PLAN_CALC_QUARANTINE") {
        skippedHasQuarantine++;
        if (!dryRun) {
          await (prisma as any).eflParseReviewQueue.update({
            where: { id: String(existing.id) },
            data: {
              ...payloadCommon,
              ratePlanId: String(p.id),
              // Do not change kind/dedupeKey for quarantines.
              queueReason:
                String(existing?.queueReason ?? "").includes("UNKNOWN_UTILITY_ID") ||
                String(existing?.queueReason ?? "").includes("UNMAPPED_UTILITY_ID")
                  ? existing.queueReason
                  : `${String(existing?.queueReason ?? "").trim() || "PLAN_CALC_QUARANTINE"} | ${reasonCode}`,
            },
          });
        }
        updated++;
        continue;
      }

      // Existing parse item:
      if (existing?.resolvedAt && reopenResolved) {
        if (!dryRun) {
          await (prisma as any).eflParseReviewQueue.update({
            where: { id: String(existing.id) },
            data: {
              ...payloadCommon,
              resolvedAt: null,
              resolvedBy: null,
              resolutionNotes: `Re-opened by unknown-utility sweep (${reasonCode}).`,
            },
          });
        }
        reopened++;
        continue;
      }

      if (!existing?.resolvedAt) {
        skippedAlreadyOpen++;
        continue;
      }

      // Default: just refresh metadata on resolved parse item (do not reopen).
      if (!dryRun) {
        await (prisma as any).eflParseReviewQueue.update({
          where: { id: String(existing.id) },
          data: { ...payloadCommon },
        });
      }
      updated++;
    }

    if ((plans as any[]).length === limit) {
      notes.push("limit_reached");
    }

    return NextResponse.json({
      ok: true,
      dryRun,
      limit,
      scanned,
      created,
      reopened,
      updated,
      skippedAlreadyOpen,
      skippedHasQuarantine,
      skippedNoSha,
      notes,
    });
  } catch (e: any) {
    return jsonError(500, "Failed to enqueue UNKNOWN utility templates", {
      message: e?.message ?? String(e),
    });
  }
}

