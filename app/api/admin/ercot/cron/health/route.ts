// app/api/admin/ercot/cron/health/route.ts

import { NextRequest, NextResponse } from 'next/server';

export const dynamic = 'force-dynamic';

/**
 * Lightweight health check for the ERCOT daily job.
 * - Validates required environment variables only (no network calls).
 * - Accepts either:
 *    a) Vercel managed cron: x-vercel-cron header
 *    b) Manual: ?token=CRON_SECRET
 * - Returns which envs are present (true/false) so ops can diagnose missing config fast.
 */
export async function GET(req: NextRequest) {
  const isVercelCron = !!req.headers.get('x-vercel-cron');
  const token = req.nextUrl.searchParams.get('token');
  const cronOk = isVercelCron || (!!process.env.CRON_SECRET && token === process.env.CRON_SECRET);
  if (!cronOk) {
    return NextResponse.json({ ok: false, error: 'unauthorized' }, { status: 401 });
  }

  const has = (k: string) => !!process.env[k];

  const vars = {
    ERCOT_PAGE_URL: has('ERCOT_PAGE_URL'),
    CRON_SECRET: has('CRON_SECRET'),
    // Spaces/S3
    S3_ENDPOINT: has('S3_ENDPOINT') || has('DO_SPACES_ENDPOINT'),
    S3_REGION: has('S3_REGION'),
    S3_BUCKET: has('S3_BUCKET'),
    S3_ACCESS_KEY_ID: has('S3_ACCESS_KEY_ID'),
    S3_SECRET_ACCESS_KEY: has('S3_SECRET_ACCESS_KEY'),
    S3_FORCE_PATH_STYLE: process.env.S3_FORCE_PATH_STYLE === 'true' || process.env.S3_FORCE_PATH_STYLE === '1'
  };

  const missing = Object.entries(vars)
    .filter(([, v]) => !v)
    .map(([k]) => k);

  return NextResponse.json({
    ok: missing.length === 0,
    missing,
    vars
  });
}

