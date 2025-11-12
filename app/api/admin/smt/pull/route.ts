import { NextRequest, NextResponse } from 'next/server';
import { requireAdmin } from '@/lib/auth/admin';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const WEBHOOK_HEADER = 'x-intelliwatt-secret' as const;

/**
 * POST /api/admin/smt/pull
 * 
 * Trigger SMT pull for a given ESIID via webhook.
 * Requires x-admin-token header.
 */
export async function POST(req: NextRequest) {
  const gate = requireAdmin(req);
  if (!gate.ok) return NextResponse.json(gate.body, { status: gate.status });

  let body: any;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ ok: false, error: 'BAD_JSON' }, { status: 400 });
  }

  if (body?.mode === 'inline') {
    const {
      source = 'adhocusage',
      filename = 'adhoc.csv',
      mime = 'text/csv',
      encoding = 'base64',
      content_b64,
      esiid,
      meter,
      captured_at,
    } = body ?? {};

    if (!content_b64 || encoding !== 'base64') {
      return NextResponse.json({ ok: false, error: 'INLINE_MISSING_B64' }, { status: 400 });
    }

    try {
      const buf = Buffer.from(content_b64, 'base64');
      const sizeBytes = buf.byteLength;
      const { createHash } = await import('crypto');
      const sha256 = createHash('sha256').update(buf).digest('hex');

      return NextResponse.json({
        ok: true,
        mode: 'inline',
        filename,
        mime,
        source,
        esiid,
        meter,
        captured_at,
        sizeBytes,
        sha256,
        message: 'Inline payload received and verified (not persisted).',
      });
    } catch (err: any) {
      return NextResponse.json({ ok: false, error: 'INLINE_DECODE_FAILED', detail: String(err?.message ?? err) }, { status: 400 });
    }
  }

  try {
    const { esiid, meter } = body || {};

    if (!esiid) {
      return NextResponse.json(
        { ok: false, error: 'MISSING_ESIID', details: 'esiid is required' },
        { status: 400 }
      );
    }

    const WEBHOOK_SECRET = process.env.INTELLIWATT_WEBHOOK_SECRET ?? process.env.DROPLET_WEBHOOK_SECRET;
    if (!WEBHOOK_SECRET) {
      console.error('SMT webhook missing INTELLIWATT_WEBHOOK_SECRET/DROPLET_WEBHOOK_SECRET');
      return NextResponse.json(
        { ok: false, error: 'SERVER_MISCONFIG', details: 'Missing INTELLIWATT_WEBHOOK_SECRET/DROPLET_WEBHOOK_SECRET' },
        { status: 500 }
      );
    }

    const DROPLET_WEBHOOK_URL = process.env.DROPLET_WEBHOOK_URL;
    if (!DROPLET_WEBHOOK_URL) {
      console.error('SMT webhook missing DROPLET_WEBHOOK_URL');
      return NextResponse.json(
        { ok: false, error: 'SERVER_MISCONFIG', details: 'Missing DROPLET_WEBHOOK_URL' },
        { status: 500 }
      );
    }

    let webhookResponse: Response;
    try {
      webhookResponse = await fetch(DROPLET_WEBHOOK_URL, {
        method: 'POST',
        headers: {
          [WEBHOOK_HEADER]: WEBHOOK_SECRET,
          'content-type': 'application/json',
        },
        body: JSON.stringify({
          reason: 'admin_triggered',
          esiid,
          meter: meter || undefined,
          ts: Date.now(),
        }),
        cache: 'no-store',
      });
    } catch (err: any) {
      return NextResponse.json({
        ok: false,
        error: 'WEBHOOK_CONNECTION_FAILED',
        details: err?.message || 'Failed to connect to webhook',
      }, { status: 502 });
    }

    if (!webhookResponse.ok) {
      const errorText = await webhookResponse.text().catch(() => 'Unknown error');
      return NextResponse.json({
        ok: false,
        error: 'WEBHOOK_FAILED',
        details: errorText,
        status: webhookResponse.status,
      }, { status: 502 });
    }

    const webhookData = await webhookResponse.json().catch(() => ({}));

    return NextResponse.json({
      ok: true,
      message: 'SMT pull triggered successfully',
      esiid,
      meter: meter || null,
      webhookResponse: webhookData,
    });
  } catch (e: any) {
    return NextResponse.json(
      { ok: false, error: e?.message || 'Failed to trigger SMT pull' },
      { status: 500 }
    );
  }
}

