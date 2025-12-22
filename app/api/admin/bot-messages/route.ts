import { NextRequest, NextResponse } from "next/server";

import { prisma } from "@/lib/db";
import { guardAdmin } from "@/lib/auth/requireAdmin";
import { BOT_PAGES, defaultBotMessageForKey } from "@/lib/intelliwattbot/pageMessages";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function parseCompositeKey(raw: any): { baseKey: string; eventKey: string | null; compositeKey: string } | null {
  if (typeof raw !== "string") return null;
  const s = raw.trim();
  if (!s) return null;

  const parts = s.split("::");
  const baseKey = (parts[0] ?? "").trim();
  if (!baseKey) return null;
  const eventKey = parts.length > 1 ? (parts.slice(1).join("::").trim() || null) : null;
  return { baseKey, eventKey, compositeKey: eventKey ? `${baseKey}::${eventKey}` : baseKey };
}

function isValidPageKey(k: any): boolean {
  const parsed = parseCompositeKey(k);
  if (!parsed) return false;
  return BOT_PAGES.some((p) => p.key === parsed.baseKey);
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
        baseKey: p.key,
        eventKey: null,
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

    // Add any event-specific variants found in DB (pageKey like "dashboard_plans::calculating").
    const variants: any[] = [];
    for (const r of rows ?? []) {
      const k = String((r as any)?.pageKey ?? "");
      if (!k.includes("::")) continue;
      const parsed = parseCompositeKey(k);
      if (!parsed) continue;
      const baseMeta = BOT_PAGES.find((p) => p.key === parsed.baseKey);
      if (!baseMeta) continue;
      variants.push({
        pageKey: parsed.compositeKey,
        baseKey: parsed.baseKey,
        eventKey: parsed.eventKey,
        label: `${baseMeta.label} — event: ${parsed.eventKey}`,
        paths: baseMeta.paths,
        defaultMessage: baseMeta.defaultMessage,
        current: {
          enabled: Boolean((r as any)?.enabled),
          message:
            (r as any)?.enabled && typeof (r as any)?.message === "string" && String((r as any).message).trim()
              ? String((r as any).message)
              : null,
          updatedAt: (r as any)?.updatedAt ? new Date((r as any).updatedAt).toISOString() : null,
        },
      });
    }

    // Base pages first, then variants.
    const combined = [...pages, ...variants].sort((a, b) => {
      const ak = String(a.baseKey ?? a.pageKey);
      const bk = String(b.baseKey ?? b.pageKey);
      if (ak !== bk) return ak < bk ? -1 : 1;
      const ae = a.eventKey ? String(a.eventKey) : "";
      const be = b.eventKey ? String(b.eventKey) : "";
      return ae < be ? -1 : ae > be ? 1 : 0;
    });

    return NextResponse.json({ ok: true, pages: combined }, { status: 200 });
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: e?.message ?? String(e) }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  const denied = guardAdmin(req);
  if (denied) return denied;

  try {
    const body = (await req.json().catch(() => null)) as any;
    const pageKeyRaw = body?.pageKey;
    const enabled = body?.enabled;
    const messageRaw = body?.message;

    if (!isValidPageKey(pageKeyRaw)) {
      return NextResponse.json({ ok: false, error: "invalid_pageKey" }, { status: 400 });
    }

    const parsed = parseCompositeKey(pageKeyRaw)!;
    const pageKey = parsed.compositeKey;

    const message = typeof messageRaw === "string" ? messageRaw.trim() : "";
    const nextEnabled = typeof enabled === "boolean" ? enabled : true;
    const defaultKey = parsed.baseKey as any;

    const upserted = await (prisma as any).intelliwattBotPageMessage.upsert({
      where: { pageKey },
      create: {
        pageKey,
        enabled: nextEnabled,
        message: message || defaultBotMessageForKey(defaultKey),
      },
      update: {
        enabled: nextEnabled,
        message: message || defaultBotMessageForKey(defaultKey),
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


