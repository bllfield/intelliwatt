import { NextRequest, NextResponse } from 'next/server';
import { requireVercelCron } from '@/lib/auth/cron';
import { runErcotIngest } from '@/lib/ercot/ingest';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * GET /api/admin/ercot/cron
 * 
 * Scheduled ERCOT data ingestion endpoint.
 * Downloads ERCOT ESIID extracts, normalizes addresses, and loads into ErcotEsiidIndex.
 * 
 * Requires x-vercel-cron header (from Vercel Cron) or x-cron-secret header.
 */
export async function GET(req: NextRequest) {
  const guard = requireVercelCron(req);
  if (guard) return guard;

  const corrId = `ercot-cron-${Date.now()}-${Math.random().toString(36).substring(2, 9)}`;
  const startMs = Date.now();

  try {
    const result = await runErcotIngest(fetch);

    const durationMs = Date.now() - startMs;
    console.log(JSON.stringify({ corrId, route: 'ercot-cron', status: 200, durationMs, ingestId: result.id, status: result.status }));

    return NextResponse.json({
      ok: result.ok,
      corrId,
      ingestId: result.id,
      status: result.status,
      recordsSeen: 'seen' in result ? result.seen : 0,
      recordsUpserted: 'upserted' in result ? result.upserted : 0,
      fileHash: 'fileHash' in result ? result.fileHash : undefined,
      sourceUrl: 'sourceUrl' in result ? result.sourceUrl : undefined,
      message: result.status === 'noop' ? result.message : undefined,
      error: 'error' in result ? result.error : undefined,
      durationMs,
    });
  } catch (error: any) {
    const durationMs = Date.now() - startMs;
    console.error(JSON.stringify({ corrId, route: 'ercot-cron', status: 500, durationMs, error: error?.message }));

    return NextResponse.json(
      {
        ok: false,
        corrId,
        error: error?.message || 'Failed to process ERCOT ingestion',
        durationMs,
      },
      { status: 500 }
    );
  }
}

