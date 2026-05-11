import { NextRequest, NextResponse } from "next/server";

import { prisma } from "@/lib/db";
import { wattbuyOffersPrisma } from "@/lib/db/wattbuyOffersClient";
import { normalizeOffers } from "@/lib/wattbuy/normalize";

export const dynamic = "force-dynamic";

function jsonError(status: number, error: string, details?: unknown) {
  return NextResponse.json(
    {
      ok: false,
      error,
      ...(details ? { details } : {}),
    },
    { status },
  );
}

async function hydrateMissingQueueEflUrls(items: any[]): Promise<any[]> {
  const openParseItems = (Array.isArray(items) ? items : []).filter((it: any) => {
    if (String(it?.kind ?? "") !== "EFL_PARSE") return false;
    if (String(it?.eflUrl ?? "").trim()) return false;
    return String(it?.offerId ?? "").trim().length > 0;
  });
  if (openParseItems.length === 0) return items;

  const wantedOfferIds = new Set<string>(
    openParseItems
      .map((it: any) => String(it?.offerId ?? "").trim())
      .filter(Boolean),
  );
  if (wantedOfferIds.size === 0) return items;

  const foundByOfferId = new Map<string, any>();
  try {
    const snapRows = await (wattbuyOffersPrisma as any).wattBuyApiSnapshot.findMany({
      where: { endpoint: "OFFERS" },
      orderBy: { createdAt: "desc" },
      take: 1000,
      select: { payloadJson: true },
    });

    for (const row of snapRows ?? []) {
      if (wantedOfferIds.size === foundByOfferId.size) break;
      const { offers } = normalizeOffers((row as any)?.payloadJson ?? {});
      for (const offer of offers as any[]) {
        const offerId = String((offer as any)?.offer_id ?? "").trim();
        if (!offerId || !wantedOfferIds.has(offerId) || foundByOfferId.has(offerId)) continue;
        const eflUrl = String((offer as any)?.docs?.efl ?? "").trim();
        if (!eflUrl) continue;
        foundByOfferId.set(offerId, offer);
      }
    }
  } catch {
    return items;
  }

  if (foundByOfferId.size === 0) return items;

  const nextItems = [...items];
  await Promise.all(
    nextItems.map(async (it: any, idx: number) => {
      const offerId = String(it?.offerId ?? "").trim();
      if (!offerId || String(it?.eflUrl ?? "").trim()) return;
      const hit = foundByOfferId.get(offerId);
      if (!hit) return;

      const eflUrl = String(hit?.docs?.efl ?? "").trim();
      if (!eflUrl) return;

      const supplier = hit?.supplier_name ?? it?.supplier ?? null;
      const planName = hit?.plan_name ?? it?.planName ?? null;
      const tdspName = hit?.distributor_name ?? it?.tdspName ?? null;
      const termMonths =
        typeof hit?.term_months === "number" && Number.isFinite(hit.term_months)
          ? hit.term_months
          : it?.termMonths ?? null;
      const queueReason =
        "DASHBOARD_QUEUED: offer has EFL URL but no template mapping yet.";

      try {
        const updated = await (prisma as any).eflParseReviewQueue.update({
          where: { id: String(it.id) },
          data: {
            eflUrl,
            supplier,
            planName,
            tdspName,
            termMonths,
            queueReason,
            updatedAt: new Date(),
          },
        });
        nextItems[idx] = updated;
      } catch {
        nextItems[idx] = {
          ...it,
          eflUrl,
          supplier,
          planName,
          tdspName,
          termMonths,
          queueReason,
        };
      }
    }),
  );

  return nextItems;
}

export async function GET(req: NextRequest) {
  try {
    const adminToken = process.env.ADMIN_TOKEN;
    if (!adminToken) {
      return jsonError(500, "ADMIN_TOKEN is not configured");
    }

    const headerToken = req.headers.get("x-admin-token");
    if (!headerToken || headerToken !== adminToken) {
      return jsonError(401, "Unauthorized (invalid admin token)");
    }

    const { searchParams } = req.nextUrl;
    const statusParam = (searchParams.get("status") || "OPEN").toUpperCase();
    const q = (searchParams.get("q") || "").trim();
    const source = (searchParams.get("source") || "").trim();
    const sourcePrefix = (searchParams.get("sourcePrefix") || searchParams.get("source_prefix") || "").trim();
    const kindParamRaw = (searchParams.get("kind") || "").trim().toUpperCase();
    const kindParam =
      kindParamRaw === "EFL_PARSE" || kindParamRaw === "PLAN_CALC_QUARANTINE"
        ? kindParamRaw
        : null;
    const limitRaw = Number(searchParams.get("limit") || "50");
    const limit = Math.max(1, Math.min(200, Number.isFinite(limitRaw) ? limitRaw : 50));
    const autoResolve =
      (searchParams.get("autoResolve") || searchParams.get("auto_resolve") || "") === "1";

    const where: any = {};
    if (statusParam === "RESOLVED") {
      where.resolvedAt = { not: null };
    } else {
      // Treat anything else as OPEN.
      where.resolvedAt = null;
    }

    if (q) {
      where.OR = [
        { supplier: { contains: q, mode: "insensitive" } },
        { planName: { contains: q, mode: "insensitive" } },
        { tdspName: { contains: q, mode: "insensitive" } },
        { offerId: { contains: q, mode: "insensitive" } },
        { eflPdfSha256: { contains: q, mode: "insensitive" } },
        { eflVersionCode: { contains: q, mode: "insensitive" } },
      ];
    }

    if (kindParam) {
      where.kind = kindParam;
    }

    if (source) {
      where.source = source;
    }
    if (sourcePrefix) {
      // Allow callers (e.g. current-plan admin UI) to fetch multiple related sources without
      // needing a bespoke endpoint per module.
      where.source = { startsWith: sourcePrefix };
    }
    if (kindParam === "EFL_PARSE" && !source && !sourcePrefix) {
      // Keep bill-parse review rows out of the default "EFL_PARSE" bucket in Fact Cards.
      // Those rows are current-plan bill parser issues, not EFL-card parsing issues.
      where.NOT = [{ source: "current_plan_bill" }];
    }

    let items = await (prisma as any).eflParseReviewQueue.findMany({
      where,
      orderBy: { createdAt: "desc" },
      take: limit,
    });

    if (where.resolvedAt === null) {
      items = await hydrateMissingQueueEflUrls(items);
    }

    let autoResolvedCount = 0;
    let autoDedupedCount = 0;
    if (autoResolve && where.resolvedAt === null) {
      // Auto-resolve OPEN current-plan EFL queue items once they are PASS.
      // Unlike offer templates, current-plan templates are not persisted into RatePlan,
      // so the older "match RatePlan by sha/url/cert+ver" auto-resolve doesn't apply.
      //
      // For current-plan EFL items, PASS means the avg table matches and plan-calc is computable,
      // so manual review is no longer required.
      const openItems = (Array.isArray(items) ? items : []).filter(
        (it: any) => String(it?.kind ?? "") !== "PLAN_CALC_QUARANTINE",
      );
      const currentPlanPassIds = openItems
        .filter((it: any) => {
          const src = String(it?.source ?? "");
          if (!src.startsWith("current_plan_")) return false;
          const fs = String(it?.finalStatus ?? "").toUpperCase();
          if (fs !== "PASS") return false;
          const qr = String(it?.queueReason ?? "");
          if (/identity_missing_/i.test(qr)) return false;
          if (/reviewType:\s*admin_identity_followup/i.test(qr)) return false;
          return true;
        })
        .map((it: any) => String(it?.id))
        .filter(Boolean);

      if (currentPlanPassIds.length) {
        const now = new Date();
        const r = await (prisma as any).eflParseReviewQueue.updateMany({
          where: { id: { in: currentPlanPassIds }, resolvedAt: null },
          data: {
            resolvedAt: now,
            resolvedBy: "AUTO_PASS_CURRENT_PLAN",
            resolutionNotes: "Auto-resolved: current plan EFL validation is PASS.",
          },
        });
        const resolvedNow = Number(r?.count) || 0;
        autoResolvedCount += resolvedNow;
        if (resolvedNow > 0) {
          const resolvedSet = new Set(currentPlanPassIds);
          items = openItems.filter((it: any) => !resolvedSet.has(String(it?.id)));
        }
      }
    }

    if (autoResolve && where.resolvedAt === null) {
      // Auto-resolve OPEN queue items that already have a persisted template.
      //
      // This keeps the queue self-healing after batch runs / manual loader creates
      // templates, even if a prior run didn't update the queue row for whatever reason.
      //
      // IMPORTANT: Only resolves when a RatePlan exists with a stored rateStructure
      // and it does NOT require manual review.
      // Only auto-resolve parse-type queue rows. PLAN_CALC_QUARANTINE is intentionally sticky.
      const openItems = (Array.isArray(items) ? items : []).filter(
        (it: any) => String(it?.kind ?? "") !== "PLAN_CALC_QUARANTINE",
      );
      const shas = new Set<string>();
      const urls = new Set<string>();
      const certVerPairs: Array<{ repPuctCertificate: string; eflVersionCode: string }> = [];

      for (const it of openItems) {
        const sha = String(it?.eflPdfSha256 || "").trim();
        if (sha) shas.add(sha);
        const url = String(it?.eflUrl || "").trim();
        if (url) urls.add(url);

        const cert = String(it?.repPuctCertificate || "").trim();
        const ver = String(it?.eflVersionCode || "").trim();
        if (cert && ver) certVerPairs.push({ repPuctCertificate: cert, eflVersionCode: ver });
      }

      const or: any[] = [];
      if (shas.size) or.push({ eflPdfSha256: { in: Array.from(shas) } });
      if (urls.size) {
        const u = Array.from(urls);
        or.push({ eflUrl: { in: u } });
        or.push({ eflSourceUrl: { in: u } });
      }
      for (const p of certVerPairs) {
        or.push({ repPuctCertificate: p.repPuctCertificate, eflVersionCode: p.eflVersionCode });
      }

      if (or.length) {
        const plans = await prisma.ratePlan.findMany({
          where: {
            rateStructure: { not: null },
            eflRequiresManualReview: false,
            OR: or,
          } as any,
          select: {
            id: true,
            eflPdfSha256: true,
            eflUrl: true,
            eflSourceUrl: true,
            repPuctCertificate: true,
            eflVersionCode: true,
          } as any,
        });

        const planShas = new Set<string>();
        const planUrls = new Set<string>();
        const planCertVer = new Set<string>();
        for (const p of plans as any[]) {
          if (p?.eflPdfSha256) planShas.add(String(p.eflPdfSha256));
          if (p?.eflUrl) planUrls.add(String(p.eflUrl));
          if (p?.eflSourceUrl) planUrls.add(String(p.eflSourceUrl));
          if (p?.repPuctCertificate && p?.eflVersionCode) {
            planCertVer.add(`${String(p.repPuctCertificate)}::${String(p.eflVersionCode)}`);
          }
        }

        const resolveIds: string[] = [];
        for (const it of openItems) {
          const sha = String(it?.eflPdfSha256 || "").trim();
          const url = String(it?.eflUrl || "").trim();
          const cert = String(it?.repPuctCertificate || "").trim();
          const ver = String(it?.eflVersionCode || "").trim();
          const cv = cert && ver ? `${cert}::${ver}` : "";
          if ((sha && planShas.has(sha)) || (url && planUrls.has(url)) || (cv && planCertVer.has(cv))) {
            if (it?.id) resolveIds.push(String(it.id));
          }
        }

        if (resolveIds.length) {
          const now = new Date();
          const r = await (prisma as any).eflParseReviewQueue.updateMany({
            where: { id: { in: resolveIds }, resolvedAt: null },
            data: {
              resolvedAt: now,
              resolvedBy: "AUTO_TEMPLATE_MATCH",
              resolutionNotes: "Auto-resolved: matching RatePlan template already exists.",
            },
          });
          autoResolvedCount = Number(r?.count) || 0;
          if (autoResolvedCount > 0) {
            // Remove newly resolved items from this response so the UI reflects the change immediately.
            const resolvedSet = new Set(resolveIds);
            items = openItems.filter((it: any) => !resolvedSet.has(String(it?.id)));
          }
        }
      }
    }

    if (autoResolve && where.resolvedAt === null) {
      // Auto-dedupe OPEN queue items by offerId to prevent duplicate rows showing up for
      // the same WattBuy offer (e.g., earlier runs that queued "missing docs.efl" and later
      // runs that queued "fetch failed" for the same offerId).
      // Only dedupe parse-type queue rows. PLAN_CALC_QUARANTINE is intentionally sticky.
      const openItems = (Array.isArray(items) ? items : []).filter(
        (it: any) => String(it?.kind ?? "") !== "PLAN_CALC_QUARANTINE",
      );
      const groups = new Map<string, any[]>();
      for (const it of openItems) {
        const oid = String(it?.offerId ?? "").trim();
        if (!oid) continue;
        const arr = groups.get(oid) ?? [];
        arr.push(it);
        groups.set(oid, arr);
      }

      const resolveIds: string[] = [];
      Array.from(groups.values()).forEach((arr) => {
        if (arr.length <= 1) return;
        // Keep newest (already sorted desc), resolve the rest.
        const toResolve = arr
          .slice(1)
          .map((x: any) => String(x?.id))
          .filter(Boolean);
        resolveIds.push(...toResolve);
      });

      if (resolveIds.length) {
        const r = await (prisma as any).eflParseReviewQueue.updateMany({
          where: { id: { in: resolveIds }, resolvedAt: null },
          data: {
            resolvedAt: new Date(),
            resolvedBy: "AUTO_DEDUPE_OFFERID",
            resolutionNotes: "Auto-resolved duplicate OPEN queue rows for the same offerId.",
          },
        });
        autoDedupedCount = Number(r?.count) || 0;
        if (autoDedupedCount > 0) {
          const resolvedSet = new Set(resolveIds);
          items = openItems.filter((it: any) => !resolvedSet.has(String(it?.id)));
        }
      }
    }

    const totalCount = await (prisma as any).eflParseReviewQueue.count({ where });

    return NextResponse.json({
      ok: true,
      status: statusParam === "RESOLVED" ? "RESOLVED" : "OPEN",
      count: items.length,
      totalCount,
      limit,
      autoResolvedCount,
      autoDedupedCount,
      items,
    });
  } catch (error) {
    // eslint-disable-next-line no-console
    console.error("[ADMIN_EFL_REVIEW_LIST] Error listing EFL review queue", error);
    return jsonError(
      500,
      "Failed to load EFL parse review queue",
      error instanceof Error ? error.message : String(error),
    );
  }
}


