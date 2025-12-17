import { NextRequest, NextResponse } from "next/server";

import { prisma } from "@/lib/db";
import { guardAdmin } from "@/lib/auth/requireAdmin";
import { BOT_PAGES, defaultBotMessageForKey } from "@/lib/intelliwattbot/pageMessages";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function isValidPageKey(k: any): boolean {
  return typeof k === "string" && BOT_PAGES.some((p) => p.key === k);
}

export async function GET(req: NextRequest) {
  const denied = guardAdmin(req);
  if (denied) return denied;

  try {
    const rows = await (prisma as any).intelliwattBotPageMessage.findMany({
      select: { pageKey: true, message: true, enabled: true, updatedAt: true },
    });
    const byKey = new Map<string, any>((rows ?? []).map((r: any) => [String(r.pageKey), r]));

    const pages = BOT_PAGES.map((p) => {
      const row = byKey.get(p.key) ?? null;
      const dbEnabled = row ? Boolean(row.enabled) : false;
      const dbMessage = row && typeof row.message === "string" ? row.message : null;
      return {
        pageKey: p.key,
        label: p.label,
        paths: p.paths,
        defaultMessage: p.defaultMessage,
        current: {
          enabled: row ? dbEnabled : false,
          message: row && dbEnabled && dbMessage ? String(dbMessage) : null,
          updatedAt: row?.updatedAt ? new Date(row.updatedAt).toISOString() : null,
        },
      };
    });

    return NextResponse.json({ ok: true, pages }, { status: 200 });
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: e?.message ?? String(e) }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  const denied = guardAdmin(req);
  if (denied) return denied;

  try {
    const body = (await req.json().catch(() => null)) as any;
    const pageKey = body?.pageKey;
    const enabled = body?.enabled;
    const messageRaw = body?.message;

    if (!isValidPageKey(pageKey)) {
      return NextResponse.json({ ok: false, error: "invalid_pageKey" }, { status: 400 });
    }

    const message = typeof messageRaw === "string" ? messageRaw.trim() : "";
    const nextEnabled = typeof enabled === "boolean" ? enabled : true;

    const upserted = await (prisma as any).intelliwattBotPageMessage.upsert({
      where: { pageKey },
      create: {
        pageKey,
        enabled: nextEnabled,
        message: message || defaultBotMessageForKey(pageKey),
      },
      update: {
        enabled: nextEnabled,
        message: message || defaultBotMessageForKey(pageKey),
      },
      select: { pageKey: true, enabled: true, message: true, updatedAt: true },
    });

    return NextResponse.json(
      {
        ok: true,
        row: {
          pageKey: upserted.pageKey,
          enabled: Boolean(upserted.enabled),
          message: String(upserted.message ?? ""),
          updatedAt: upserted.updatedAt ? new Date(upserted.updatedAt).toISOString() : null,
        },
      },
      { status: 200 },
    );
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: e?.message ?? String(e) }, { status: 500 });
  }
}


