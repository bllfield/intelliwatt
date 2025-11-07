import { NextRequest, NextResponse } from 'next/server';

function cronAuthorized(req: NextRequest) {
  const vercelHeader = req.headers.get('x-vercel-cron');
  const providedSecret = req.headers.get('x-cron-secret') || req.nextUrl.searchParams.get('token') || '';
  const expectedSecret = process.env.CRON_SECRET || '';

  const secretOk = expectedSecret ? providedSecret === expectedSecret : true;
  const vercelOk = Boolean(vercelHeader);

  return { secretOk, vercelOk, vercelHeader: vercelHeader || null };
}

export async function GET(req: NextRequest) {
  const { secretOk, vercelOk, vercelHeader } = cronAuthorized(req);
  if (!secretOk) {
    return NextResponse.json({ ok: false, error: 'invalid or missing x-cron-secret', vercelOk, vercelHeader }, { status: 401 });
  }

  return NextResponse.json({
    ok: true,
    vercelOk,
    vercelHeader,
    now: new Date().toISOString(),
  });
}
