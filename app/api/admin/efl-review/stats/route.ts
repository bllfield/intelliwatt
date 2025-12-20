import { NextRequest, NextResponse } from "next/server";

import { prisma } from "@/lib/db";

export const dynamic = "force-dynamic";

const ADMIN_TOKEN = process.env.ADMIN_TOKEN;

function jsonError(status: number, error: string, details?: unknown) {
  return NextResponse.json(
    { ok: false, error, ...(details ? { details } : {}) },
    { status },
  );
}

function normalizeReason(reason: unknown): string {
  const s = String(reason ?? "").trim();
  if (!s) return "—";
  // Prefer stable prefix buckets to avoid a million unique strings.
  // Examples:
  //  - "SUSPECT_TOU_CLASSIFIED_AS_NON_TOU"
  //  - "UNKNOWN_UTILITY_ID: ..."
  //  - "REVALIDATE_QUARANTINE: ..."
  const firstLine = s.split(/\r?\n/)[0] ?? s;
  const prefix = firstLine.split("|")[0]?.trim() ?? firstLine.trim();
  const colonIdx = prefix.indexOf(":");
  const head = colonIdx >= 0 ? prefix.slice(0, colonIdx).trim() : prefix;
  return head.length > 0 ? head.slice(0, 80) : "—";
}

export async function GET(req: NextRequest) {
  try {
    if (!ADMIN_TOKEN) return jsonError(500, "ADMIN_TOKEN is not configured");
    const headerToken = req.headers.get("x-admin-token");
    if (!headerToken || headerToken !== ADMIN_TOKEN) {
      return jsonError(401, "Unauthorized (invalid admin token)");
    }

    const sp = req.nextUrl.searchParams;
    const limitRaw = Number(sp.get("limit") ?? 5000);
    const limit = Math.max(1, Math.min(20000, Number.isFinite(limitRaw) ? limitRaw : 5000));

    const unresolved = await (prisma as any).eflParseReviewQueue.findMany({
      where: { resolvedAt: null },
      orderBy: { createdAt: "asc" },
      take: limit,
      select: {
        id: true,
        kind: true,
        finalStatus: true,
        queueReason: true,
        createdAt: true,
      } as any,
    });

    const totalSampled = Array.isArray(unresolved) ? unresolved.length : 0;

    const countsByKind: Record<string, number> = {};
    const countsByKindAndStatus: Record<string, Record<string, number>> = {};
    const reasonCountsByKind: Record<string, Record<string, number>> = {};

    for (const row of unresolved as any[]) {
      const kind = String(row?.kind ?? "—");
      const status = String(row?.finalStatus ?? "—");
      const reasonBucket = normalizeReason(row?.queueReason);

      countsByKind[kind] = (countsByKind[kind] ?? 0) + 1;
      countsByKindAndStatus[kind] ??= {};
      countsByKindAndStatus[kind][status] = (countsByKindAndStatus[kind][status] ?? 0) + 1;

      reasonCountsByKind[kind] ??= {};
      reasonCountsByKind[kind][reasonBucket] = (reasonCountsByKind[kind][reasonBucket] ?? 0) + 1;
    }

    const topReasonsByKind = Object.fromEntries(
      Object.entries(reasonCountsByKind).map(([kind, m]) => {
        const top = Object.entries(m)
          .sort((a, b) => b[1] - a[1])
          .slice(0, 15)
          .map(([reason, count]) => ({ reason, count }));
        return [kind, top];
      }),
    );

    return NextResponse.json({
      ok: true,
      sampled: { total: totalSampled, limit, truncated: totalSampled === limit },
      countsByKind,
      countsByKindAndStatus,
      topReasonsByKind,
      note:
        "This endpoint returns a sampled view (up to `limit`) of unresolved queue rows. Use topReasonsByKind to prioritize systemic fixes, then run drain processing endpoints to clear newly-eligible rows.",
    });
  } catch (e: any) {
    return jsonError(500, "Failed to compute EFL review queue stats", {
      message: e instanceof Error ? e.message : String(e),
    });
  }
}

