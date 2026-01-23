import { NextRequest, NextResponse } from "next/server";

import { prisma } from "@/lib/db";
import { defaultBotMessageForKey, resolveBotPageKey } from "@/lib/intelliwattbot/pageMessages";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function sanitizeEventKey(raw: string | null): string | null {
  const s = typeof raw === "string" ? raw.trim().toLowerCase() : "";
  if (!s) return null;
  // Keep it URL-safe + stable for DB keys.
  const cleaned = s.replace(/[^a-z0-9_.-]+/g, "_").replace(/^_+|_+$/g, "");
  return cleaned ? cleaned : null;
}

export async function GET(req: NextRequest) {
  try {
    const url = new URL(req.url);
    const path = (url.searchParams.get("path") ?? "").trim();
    const pageKey = resolveBotPageKey(path);
    const eventKey = sanitizeEventKey(url.searchParams.get("event"));
    const compositeKey = eventKey ? `${pageKey}::${eventKey}` : pageKey;

    // Keep DB load minimal and fail open if the DB is under pressure.
    // We can fetch both keys in one query and then pick the best match.
    const rows = await (prisma as any).intelliwattBotPageMessage
      .findMany({
        where: { pageKey: { in: eventKey ? [pageKey, compositeKey] : [pageKey] } },
        select: { pageKey: true, message: true, enabled: true, updatedAt: true },
      })
      .catch(() => null);

    const list = Array.isArray(rows) ? rows : [];
    const rowEvent = eventKey ? list.find((r: any) => String(r?.pageKey ?? "") === compositeKey) ?? null : null;
    const rowBase = list.find((r: any) => String(r?.pageKey ?? "") === pageKey) ?? null;

    const pickDb = (row: any | null) =>
      row && row.enabled && typeof row.message === "string" && row.message.trim() ? row.message.trim() : null;

    const fromEvent = pickDb(rowEvent);
    const fromBase = pickDb(rowBase);
    const message = fromEvent ?? fromBase ?? defaultBotMessageForKey(pageKey);

    return NextResponse.json(
      {
        ok: true,
        pageKey,
        compositeKey,
        eventKey,
        message,
        source: fromEvent ? "db_event" : fromBase ? "db_page" : "default",
        updatedAt: (rowEvent?.updatedAt ?? rowBase?.updatedAt) ? new Date(rowEvent?.updatedAt ?? rowBase?.updatedAt).toISOString() : null,
      },
      {
        status: 200,
        headers: {
          // This is safe to cache briefly and reduces DB pressure dramatically.
          "Cache-Control": "public, s-maxage=60, stale-while-revalidate=600",
        },
      },
    );
  } catch (e: any) {
    // Fail open: never crash the UI over bot copy.
    const url = new URL(req.url);
    const path = (url.searchParams.get("path") ?? "").trim();
    const pageKey = resolveBotPageKey(path);
    const eventKey = sanitizeEventKey(url.searchParams.get("event"));
    const compositeKey = eventKey ? `${pageKey}::${eventKey}` : pageKey;
    return NextResponse.json(
      {
        ok: true,
        pageKey,
        compositeKey,
        eventKey,
        message: defaultBotMessageForKey(pageKey),
        source: "default_error",
        warning: e?.message ?? String(e),
      },
      {
        status: 200,
        headers: {
          "Cache-Control": "public, s-maxage=60, stale-while-revalidate=600",
        },
      },
    );
  }
}


