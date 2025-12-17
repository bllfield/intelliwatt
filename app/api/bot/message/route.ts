import { NextRequest, NextResponse } from "next/server";

import { prisma } from "@/lib/db";
import { defaultBotMessageForKey, resolveBotPageKey } from "@/lib/intelliwattbot/pageMessages";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  try {
    const url = new URL(req.url);
    const path = (url.searchParams.get("path") ?? "").trim();
    const pageKey = resolveBotPageKey(path);

    const row = await (prisma as any).intelliwattBotPageMessage.findUnique({
      where: { pageKey },
      select: { pageKey: true, message: true, enabled: true, updatedAt: true },
    });

    const fromDb = row && row.enabled && typeof row.message === "string" && row.message.trim();
    const message = fromDb ? row.message.trim() : defaultBotMessageForKey(pageKey);

    return NextResponse.json(
      {
        ok: true,
        pageKey,
        message,
        source: fromDb ? "db" : "default",
        updatedAt: row?.updatedAt ? new Date(row.updatedAt).toISOString() : null,
      },
      { status: 200 },
    );
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: e?.message ?? String(e) }, { status: 500 });
  }
}


