import { NextRequest, NextResponse } from 'next/server';
import { requireAdmin } from '@/lib/auth/admin';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * POST /api/admin/smt/pull
 * 
 * Trigger SMT pull for a given ESIID via webhook.
 * Requires x-admin-token header.
 */
export async function POST(req: NextRequest) {
  const gate = requireAdmin(req);
  if (!gate.ok) return NextResponse.json(gate.body, { status: gate.status });

  try {
    const body = await req.json();
    const { esiid, meter } = body || {};

    if (!esiid) {
      return NextResponse.json(
        { ok: false, error: 'MISSING_ESIID', details: 'esiid is required' },
        { status: 400 }
      );
    }

    const webhookUrl = process.env.DROPLET_WEBHOOK_URL ?? process.env.INTELLIWATT_WEBHOOK_URL;
    const webhookSecret = process.env.DROPLET_WEBHOOK_SECRET ?? process.env.INTELLIWATT_WEBHOOK_SECRET;

    if (!webhookUrl || !webhookSecret) {
      return NextResponse.json(
        {
          ok: false,
          error: 'WEBHOOK_NOT_CONFIGURED',
          details: 'Set DROPLET_WEBHOOK_URL/SECRET or INTELLIWATT_WEBHOOK_URL/SECRET',
        },
        { status: 503 }
      );
    }

    // Trigger SMT pull via webhook
    let webhookResponse: Response;
    try {
      webhookResponse = await fetch(webhookUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-intelliwatt-secret': webhookSecret,
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

