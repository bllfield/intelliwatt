import { NextRequest, NextResponse } from 'next/server';
import { extractCurrentPlanFromBillTextWithOpenAI } from '@/lib/billing/parseBillText';

export const dynamic = 'force-dynamic';

type AdminBillParseBody = {
  rawText?: string;
  esiidHint?: string | null;
  addressLine1Hint?: string | null;
  cityHint?: string | null;
  stateHint?: string | null;
};

export async function POST(request: NextRequest) {
  try {
    const adminToken = process.env.ADMIN_TOKEN;
    if (!adminToken) {
      return NextResponse.json(
        { ok: false, error: 'ADMIN_TOKEN not configured' },
        { status: 500 },
      );
    }

    const headerToken = request.headers.get('x-admin-token');
    if (!headerToken || headerToken !== adminToken) {
      return NextResponse.json({ ok: false, error: 'Unauthorized' }, { status: 401 });
    }

    const body = (await request.json().catch(() => null)) as AdminBillParseBody | null;
    if (!body || typeof body.rawText !== 'string' || body.rawText.trim().length === 0) {
      return NextResponse.json(
        { ok: false, error: 'rawText is required in request body' },
        { status: 400 },
      );
    }

    const rawText = body.rawText.slice(0, 50000); // hard cap for safety

    const parsed = await extractCurrentPlanFromBillTextWithOpenAI(rawText, {
      esiidHint: body.esiidHint ?? null,
      addressLine1Hint: body.addressLine1Hint ?? null,
      cityHint: body.cityHint ?? null,
      stateHint: body.stateHint ?? null,
    });

    return NextResponse.json({
      ok: true,
      parsed,
      rawTextPreview: rawText.slice(0, 2000),
    });
  } catch (error) {
    // eslint-disable-next-line no-console
    console.error('[admin/current-plan/bill-parse] Failed to parse bill', error);
    const message =
      error && typeof error === 'object' && 'message' in (error as any)
        ? (error as any).message
        : 'Failed to parse bill';
    return NextResponse.json(
      {
        ok: false,
        error: message,
      },
      { status: 500 },
    );
  }
}


