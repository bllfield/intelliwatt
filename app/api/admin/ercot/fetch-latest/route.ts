import { NextRequest, NextResponse } from 'next/server';
import { fetchToBuffer } from '@/lib/ercot/http';
import { ingestLocalFile } from '@/scripts/ercot/load_from_file';
import fs from 'fs';
import os from 'os';
import path from 'path';
import crypto from 'crypto';
import { PrismaClient } from '@prisma/client';

export const dynamic = 'force-dynamic';

function jsonError(message: string, status = 400) {
  return NextResponse.json({ ok: false, error: message }, { status });
}

export async function GET(req: NextRequest) {
  const adminToken = req.headers.get('x-admin-token');
  if (!process.env.ADMIN_TOKEN || adminToken !== process.env.ADMIN_TOKEN) {
    return jsonError('Unauthorized', 401);
  }

  let urlParam = req.nextUrl.searchParams.get('url');
  const notes = req.nextUrl.searchParams.get('notes') ?? undefined;
  const pageUrl = req.nextUrl.searchParams.get('pageUrl');
  if (!urlParam && pageUrl) {
    const { resolveLatestErcotUrl } = await import('@/lib/ercot/resolve_latest');
    const resolved = await resolveLatestErcotUrl(pageUrl, process.env.ERCOT_PAGE_FILTER);
    urlParam = resolved.url;
  }
  if (!urlParam) {
    return jsonError('Missing required param: url or pageUrl');
  }

  const prisma = new PrismaClient();

  try {
    const buf = await fetchToBuffer({ url: urlParam });
    const sha = crypto.createHash('sha256').update(buf).digest('hex');

    let already: any = null;
    const ingestModel = (prisma as any).ercotIngestLog;
    if (ingestModel?.findFirst) {
      already = await ingestModel.findFirst({ where: { fileHash: sha } });
    }
    if (already) {
      return NextResponse.json({ ok: true, skipped: true, reason: 'duplicate_hash', sha256: sha });
    }

    const base = path.basename(new URL(urlParam).pathname) || `ercot_${Date.now()}.txt`;
    const tmp = path.join(os.tmpdir(), base);
    fs.writeFileSync(tmp, buf);

    const result = await ingestLocalFile(tmp, notes ?? `remote:${urlParam}`);

    return NextResponse.json({ ok: true, fileName: base, sha256: sha, result });
  } catch (err: any) {
    return jsonError(err?.message || 'fetch-latest failed', 500);
  } finally {
    await prisma.$disconnect();
  }
}
