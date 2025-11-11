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
    // ERCOT Public API (preferred over HTML scraping)
    ERCOT_SUBSCRIPTION_KEY: has('ERCOT_SUBSCRIPTION_KEY'),
    ERCOT_USERNAME: has('ERCOT_USERNAME'),
    ERCOT_PASSWORD: has('ERCOT_PASSWORD'),
    // Spaces/S3
    S3_ENDPOINT: has('S3_ENDPOINT') || has('DO_SPACES_ENDPOINT'),
    S3_REGION: has('S3_REGION'),
    S3_BUCKET: has('S3_BUCKET'),
    S3_ACCESS_KEY_ID: has('S3_ACCESS_KEY_ID'),
    S3_SECRET_ACCESS_KEY: has('S3_SECRET_ACCESS_KEY'),
    S3_FORCE_PATH_STYLE: process.env.S3_FORCE_PATH_STYLE === 'true' || process.env.S3_FORCE_PATH_STYLE === '1'
  };

  // Required vars (must be present)
  const required = ['ERCOT_PAGE_URL', 'CRON_SECRET', 'S3_ENDPOINT', 'S3_REGION', 'S3_BUCKET', 'S3_ACCESS_KEY_ID', 'S3_SECRET_ACCESS_KEY'];
  const missing = required.filter(k => !vars[k as keyof typeof vars]);

  // ERCOT API vars are optional (fallback to HTML scraping if not set)
  const hasApiCreds = vars.ERCOT_SUBSCRIPTION_KEY && vars.ERCOT_USERNAME && vars.ERCOT_PASSWORD;

  return NextResponse.json({
    ok: missing.length === 0,
    missing,
    vars,
    mode: hasApiCreds ? 'api' : 'html-fallback'
  });
}

