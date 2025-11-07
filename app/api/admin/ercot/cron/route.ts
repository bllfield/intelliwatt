import { NextRequest, NextResponse } from 'next/server';
import { fetchToBuffer } from '@/lib/ercot/http';
import { ingestLocalFile } from '@/scripts/ercot/load_from_file';
import { PrismaClient } from '@prisma/client';
import crypto from 'crypto';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { requireVercelCron } from '@/lib/auth/cron';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

function jsonError(message: string, status = 400) {
  return NextResponse.json({ ok: false, error: message }, { status });
}

async function handler(req: NextRequest) {
  const guard = requireVercelCron(req);
  if (guard) {
    const tokenParam = req.nextUrl.searchParams.get('token');
    const cronSecret = process.env.CRON_SECRET || '';
    if (!tokenParam || !cronSecret || tokenParam !== cronSecret) {
      return guard;
    }
  }

  let dailyUrl = process.env.ERCOT_DAILY_URL || '';
  let monthlyUrl = process.env.ERCOT_MONTHLY_URL || '';

  if (!dailyUrl && process.env.ERCOT_PAGE_URL) {
    try {
      const { resolveLatestErcotUrl } = await import('@/lib/ercot/resolve_latest');
      const resolved = await resolveLatestErcotUrl(process.env.ERCOT_PAGE_URL!, process.env.ERCOT_PAGE_FILTER);
      dailyUrl = resolved.url;
    } catch (err) {
      console.warn('ERCOT_PAGE_URL resolution failed:', err);
    }
  }

  if (!dailyUrl && !monthlyUrl) {
    return jsonError('Missing ERCOT_DAILY_URL or ERCOT_MONTHLY_URL');
  }

  const prisma = new PrismaClient();
  const results: any[] = [];

  async function pull(url: string, label: string) {
    if (!url) return;
    const buf = await fetchToBuffer({ url });
    const sha = crypto.createHash('sha256').update(buf).digest('hex');

    const ingestModel = (prisma as any).ercotIngestLog;
    if (ingestModel?.findFirst) {
      const already = await ingestModel.findFirst({ where: { fileHash: sha } });
      if (already) {
        results.push({ label, skipped: true, reason: 'duplicate_hash', sha256: sha });
        return;
      }
    }

    const base = path.basename(new URL(url).pathname) || `ercot_${Date.now()}.txt`;
    const tmp = path.join(os.tmpdir(), `${label}_${base}`);
    fs.writeFileSync(tmp, buf);

    const result = await ingestLocalFile(tmp, `cron:${label}`);
    results.push({ label, ok: true, sha256: sha, result });
  }

  try {
    await pull(dailyUrl, 'daily');
    await pull(monthlyUrl, 'monthly');
    return NextResponse.json({ ok: true, results });
  } catch (err: any) {
    return jsonError(err?.message || 'cron failed', 500);
  } finally {
    await prisma.$disconnect();
  }
}

export const GET = handler;
export const POST = handler;
