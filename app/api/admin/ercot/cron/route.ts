// app/api/admin/ercot/cron/route.ts

import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import { getLatestDailyFiles, downloadZip } from '@/lib/ercot/fetchDaily';
import { putObject, objectExists } from '@/lib/ercot/upload';
import { getEwsReportsForReportType, downloadUrlToBuffer, buildAgent } from '@/lib/ercot/ews';
import crypto from 'node:crypto';

export const dynamic = 'force-dynamic';

// This route is intended to be called by Vercel Cron or your droplet.
// Usage: GET /api/admin/ercot/cron?token=<CRON_SECRET>
export async function GET(req: NextRequest) {
  const token = req.nextUrl.searchParams.get('token');
  const headerToken = req.headers.get('x-cron-secret') || '';
  
  if (!process.env.CRON_SECRET || (token !== process.env.CRON_SECRET && headerToken !== process.env.CRON_SECRET)) {
    // Also accept Vercel managed cron (optional)
    if (req.headers.get('x-vercel-cron') === '1') {
      // Allow Vercel cron
    } else {
      return NextResponse.json({ ok: false, error: 'unauthorized' }, { status: 401 });
    }
  }

  const ercotPage = process.env.ERCOT_PAGE_URL;
  if (!ercotPage) {
    return NextResponse.json({ ok: false, error: 'missing ERCOT_PAGE_URL' }, { status: 500 });
  }

  if (!process.env.S3_BUCKET || !process.env.S3_ACCESS_KEY_ID || !process.env.S3_SECRET_ACCESS_KEY || !(process.env.S3_ENDPOINT || process.env.DO_SPACES_ENDPOINT)) {
    return NextResponse.json({ ok: false, error: 'missing S3 config (S3_BUCKET, keys, endpoint)' }, { status: 500 });
  }

  try {
    // Prefer EWS if credentials are configured
    if (process.env.ERCOT_EWS_BASE && (process.env.ERCOT_EWS_PFX || (process.env.ERCOT_EWS_CERT && process.env.ERCOT_EWS_KEY))) {
      const artifacts = await getEwsReportsForReportType();
      const agent = buildAgent();

      const yyyy = new Date().getUTCFullYear();
      const mm = String(new Date().getUTCMonth() + 1).padStart(2, '0');
      const dd = String(new Date().getUTCDate()).padStart(2, '0');
      const dateKey = `${yyyy}-${mm}-${dd}`;

      const results: Array<{ tdsp: string; key: string; bytes: number; skipped?: boolean; error?: string }> = [];

      for (const art of artifacts) {
        try {
          const key = `ercot/${dateKey}/${art.fileName}`;
          
          // Idempotency: skip if object already exists
          if (await objectExists(key)) {
            results.push({ tdsp: art.fileName, key, bytes: 0, skipped: true });
            continue;
          }

          const buf = await downloadUrlToBuffer(art.downloadUrl, agent);
          
          // Compute SHA256 for idempotence tracking
          const sha256 = crypto.createHash('sha256').update(buf).digest('hex');
          
          // Check if we already ingested this file by SHA256
          const exists = await prisma.ercotIngest.findFirst({ where: { fileSha256: sha256 } });
          if (exists) {
            results.push({ tdsp: art.fileName, key, bytes: 0, skipped: true });
            continue;
          }

          await putObject(key, new Uint8Array(buf), 'application/zip');

          // Record in ErcotIngest
          await prisma.ercotIngest.create({
            data: {
              status: 'ok',
              note: `ews-daily-${dateKey}`,
              fileUrl: art.downloadUrl,
              fileSha256: sha256,
              tdsp: art.fileName.toLowerCase().replace(/[^a-z0-9]/g, '_').slice(0, 20),
              rowCount: null,
              headers: {
                filename: art.fileName,
                storageKey: key,
                sizeBytes: buf.byteLength,
                postDateTime: art.postDateTime || new Date().toISOString()
              } as any,
              error: null,
              errorDetail: null
            }
          });

          results.push({ tdsp: art.fileName, key, bytes: buf.byteLength });
        } catch (err: any) {
          const errorMsg = String(err?.message || err).slice(0, 500);
          await prisma.ercotIngest.create({
            data: {
              status: 'error',
              note: `ews-daily-${dateKey}`,
              fileUrl: art.downloadUrl,
              fileSha256: null,
              tdsp: art.fileName.toLowerCase().replace(/[^a-z0-9]/g, '_').slice(0, 20),
              error: 'EWS_DOWNLOAD_OR_UPLOAD_FAILED',
              errorDetail: errorMsg
            }
          });
          results.push({ tdsp: art.fileName, key: '', bytes: 0, error: errorMsg });
        }
      }

      return NextResponse.json({
        ok: true,
        mode: 'ews',
        postedAt: artifacts[0]?.postDateTime || new Date().toISOString(),
        dateKey,
        count: results.length,
        results
      });
    }

    // Fallback to API/HTML scraping
    const { postedAt, files } = await getLatestDailyFiles(ercotPage);
    // Partition key: YYYY-MM-DD
    const yyyy = postedAt.getUTCFullYear();
    const mm = String(postedAt.getUTCMonth() + 1).padStart(2, '0');
    const dd = String(postedAt.getUTCDate()).padStart(2, '0');
    const dateKey = `${yyyy}-${mm}-${dd}`;

    const results: Array<{ tdsp: string; key: string; bytes: number; skipped?: boolean; error?: string }> = [];

    for (const f of files) {
      const key = `ercot/${dateKey}/${f.filename}`;
      // Idempotency: skip if object already exists
      if (await objectExists(key)) {
        results.push({ tdsp: f.tdsp, key, bytes: 0, skipped: true });
        continue;
      }

      try {
        const zip = await downloadZip(f.href);
        
        // Compute SHA256 for idempotence tracking
        const sha256 = crypto.createHash('sha256').update(zip).digest('hex');
        
        // Check if we already ingested this file by SHA256
        const exists = await prisma.ercotIngest.findFirst({ where: { fileSha256: sha256 } });
        if (exists) {
          results.push({ tdsp: f.tdsp, key, bytes: 0, skipped: true });
          continue;
        }

        await putObject(key, zip, 'application/zip');

        // Record in ErcotIngest (adapted to existing schema)
        await prisma.ercotIngest.create({
          data: {
            status: 'ok',
            note: `daily-${dateKey}`,
            fileUrl: f.href,
            fileSha256: sha256,
            tdsp: f.tdsp.toLowerCase().replace(/[^a-z0-9]/g, '_').slice(0, 20), // normalize tdsp name
            rowCount: null, // zip file, not parsed yet
            headers: {
              filename: f.filename,
              storageKey: key,
              sizeBytes: zip.byteLength,
              postedAt: postedAt.toISOString()
            } as any,
            error: null,
            errorDetail: null
          }
        });

        results.push({ tdsp: f.tdsp, key, bytes: zip.byteLength });
      } catch (err: any) {
        const errorMsg = String(err?.message || err).slice(0, 500);
        await prisma.ercotIngest.create({
          data: {
            status: 'error',
            note: `daily-${dateKey}`,
            fileUrl: f.href,
            fileSha256: null,
            tdsp: f.tdsp.toLowerCase().replace(/[^a-z0-9]/g, '_').slice(0, 20),
            error: 'DOWNLOAD_OR_UPLOAD_FAILED',
            errorDetail: errorMsg
          }
        });
        results.push({ tdsp: f.tdsp, key: '', bytes: 0, error: errorMsg });
      }
    }

    return NextResponse.json({
      ok: true,
      postedAt: postedAt.toISOString(),
      dateKey,
      count: results.length,
      results
    });
  } catch (err: any) {
    const errorMsg = String(err?.message || err).slice(0, 500);
    await prisma.ercotIngest.create({
      data: {
        status: 'error',
        note: 'cron',
        fileUrl: ercotPage,
        fileSha256: null,
        error: 'FETCH_FAILED',
        errorDetail: errorMsg
      }
    });
    return NextResponse.json({ ok: false, error: 'FETCH_FAILED', detail: errorMsg }, { status: 500 });
  }
}
