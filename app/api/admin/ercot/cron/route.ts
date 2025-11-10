import { NextRequest, NextResponse } from 'next/server';
import { requireVercelCron } from '@/lib/auth/cron';
import { prisma } from '@/lib/db';

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
    // Create ingest record
    const ingest = await prisma.ercotIngest.create({
      data: {
        status: 'pending',
        startedAt: new Date(),
      },
    });

    try {
      // TODO: Implement ERCOT data fetching logic
      // 1. Determine which TDSP files to fetch (or fetch all)
      // 2. Download ERCOT extract files
      // 3. Compute file hash for idempotence
      // 4. Check if hash already exists (skip if duplicate)
      // 5. Parse CSV/JSON data
      // 6. Normalize addresses (USPS normalization)
      // 7. Upsert into ErcotEsiidIndex
      // 8. Update ingest record with status and counts

      // For now, return a placeholder response
      await prisma.ercotIngest.update({
        where: { id: ingest.id },
        data: {
          status: 'success',
          finishedAt: new Date(),
          recordsSeen: 0,
          recordsUpserted: 0,
          errorMessage: 'ERCOT ingestion not yet implemented - placeholder endpoint',
        },
      });
    } catch (error: any) {
      await prisma.ercotIngest.update({
        where: { id: ingest.id },
        data: {
          status: 'error',
          finishedAt: new Date(),
          errorMessage: error?.message || 'Unknown error during ERCOT ingestion',
        },
      });
      throw error;
    }

    const durationMs = Date.now() - startMs;
    console.log(JSON.stringify({ corrId, route: 'ercot-cron', status: 200, durationMs, ingestId: ingest.id }));

    const updatedIngest = await prisma.ercotIngest.findUnique({
      where: { id: ingest.id },
    });

    return NextResponse.json({
      ok: true,
      corrId,
      ingestId: ingest.id,
      status: updatedIngest?.status || 'unknown',
      recordsSeen: updatedIngest?.recordsSeen || 0,
      recordsUpserted: updatedIngest?.recordsUpserted || 0,
      message: 'ERCOT ingestion endpoint is active but not yet implemented',
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

