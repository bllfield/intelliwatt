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

    const rowEvent = eventKey
      ? await (prisma as any).intelliwattBotPageMessage
          .findUnique({
            where: { pageKey: compositeKey },
            select: { pageKey: true, message: true, enabled: true, updatedAt: true },
          })
          .catch(() => null)
      : null;

    const rowBase = await (prisma as any).intelliwattBotPageMessage
      .findUnique({
        where: { pageKey },
        select: { pageKey: true, message: true, enabled: true, updatedAt: true },
      })
      .catch(() => null);

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
      { status: 200 },
    );
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: e?.message ?? String(e) }, { status: 500 });
  }
}


