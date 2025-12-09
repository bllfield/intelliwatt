import { NextRequest, NextResponse } from 'next/server';
import { Prisma } from '@prisma/client';
import { prisma } from '@/lib/db';
import { usagePrisma } from '@/lib/db/usageClient';
import { normalizeSmtIntervals } from '@/app/lib/smt/normalize';
import { requireAdmin } from '@/lib/auth/admin';

export const runtime = 'nodejs';
export const maxDuration = 300; // allow large SMT raw uploads

export const dynamic = 'force-dynamic';

export async function POST(req: NextRequest) {
  const gate = requireAdmin(req);
  if (!gate.ok) return NextResponse.json(gate.body, { status: gate.status });

  const body = await req.json().catch(() => ({} as Record<string, unknown>));
  const filename = body.filename as string | undefined;
  const sizeBytes = (body.sizeBytes ?? body.size_bytes) as number | undefined;
  const sha256 = body.sha256 as string | undefined;
  const receivedAt = (body.receivedAt ?? body.received_at) as string | undefined;
  const source = (body.source as string | undefined) ?? 'adhocusage';
  const esiid = typeof body.esiid === 'string' && body.esiid.trim() ? body.esiid.trim() : null;
  const contentType =
    (body.contentType as string | undefined) ??
    (body.content_type as string | undefined) ??
    'application/octet-stream';
  const storagePath =
    (body.storagePath as string | undefined) ??
    (body.storage_path as string | undefined) ??
    `/adhocusage/${filename ?? ''}`;
  // STEP 1: Accept optional contentBase64 for large-file SMT ingestion path
  const contentBase64 = body.contentBase64 as string | undefined;

  const missing: string[] = [];

  if (!filename) missing.push('filename (string)');
  if (typeof sizeBytes !== 'number' || Number.isNaN(sizeBytes)) {
    missing.push('size_bytes|sizeBytes (number)');
  }
  if (!sha256) missing.push('sha256 (string)');
  // NOTE: contentBase64 is optional for backward compatibility with old callers

  if (missing.length > 0) {
    const receivedKeys = Object.keys(body ?? {});
    console.error('[raw-upload] validation failed', { missing, receivedKeys });
    return NextResponse.json(
      {
        ok: false,
        error: 'VALIDATION',
        details: 'Missing or invalid required fields',
        missing,
        receivedKeys,
      },
      { status: 400 },
    );
  }

  // Log whether contentBase64 was provided (for SMT large-file ingestion debugging)
  if (contentBase64) {
    console.log('[raw-upload] contentBase64 provided, length:', contentBase64.length);
  } else {
    console.log('[raw-upload] no contentBase64 (legacy path or S3 storage)');
  }

  try {
    // Idempotency: if a row with this sha256 already exists, return it instead of failing
    const existing = await prisma.rawSmtFile.findUnique({
      where: { sha256 }, // requires a UNIQUE on sha256 (which you added)
      select: { id: true, filename: true, size_bytes: true, sha256: true, created_at: true },
    });

    if (existing) {
      return NextResponse.json({
        ok: true,
        duplicate: true,
        id: String(existing.id), // BigInt -> string
        filename: existing.filename,
        sizeBytes: existing.size_bytes,
        sha256: existing.sha256,
        createdAt: existing.created_at, // Date serializes fine
      });
    }

    // Create new record
    // STEP 1: Store contentBase64 as Buffer if provided (RawSmtFile.content is Bytes type)
    const contentBuffer = contentBase64 ? Buffer.from(contentBase64, 'base64') : undefined;
    
    const row = await prisma.rawSmtFile.create({
      data: {
        filename: filename!,
        size_bytes: sizeBytes!,
        sha256: sha256!,
        source,
        content_type: contentType,
        storage_path: storagePath,
        content: contentBuffer,
        received_at: receivedAt ? new Date(receivedAt) : new Date(),
      },
      select: { id: true, filename: true, size_bytes: true, sha256: true, created_at: true },
    });

    // Early purge of prior data for this ESIID so normalization has a clean slate
    if (esiid) {
      try {
        const houses = await prisma.houseAddress.findMany({
          where: { esiid, archivedAt: null },
          select: { id: true },
        });
        const houseIds = houses.map((h) => h.id);

        await prisma.$transaction(async (tx) => {
          await tx.smtBillingRead.deleteMany({ where: { esiid } });
          await tx.smtInterval.deleteMany({ where: { esiid } });

          if (houseIds.length > 0) {
            const manualIds = await tx.manualUsageUpload.findMany({ where: { houseId: { in: houseIds } }, select: { id: true } });
            if (manualIds.length > 0) {
              await tx.entry.updateMany({ where: { manualUsageId: { in: manualIds.map((m) => m.id) } }, data: { manualUsageId: null } });
            }
            await tx.manualUsageUpload.deleteMany({ where: { houseId: { in: houseIds } } });
            await tx.greenButtonUpload.deleteMany({ where: { houseId: { in: houseIds } } });
          }
        });

        if (houseIds.length > 0) {
          await usagePrisma.greenButtonInterval.deleteMany({ where: { homeId: { in: houseIds } } });
          await usagePrisma.rawGreenButton.deleteMany({ where: { homeId: { in: houseIds } } });
        }
      } catch (err) {
        console.error('[raw-upload] failed to purge existing data for esiid', { esiid, err });
      }
    }

    // If the payload was provided inline, normalize immediately (mirrors green-button flow)
    let normalizedSummary: any = null;
    if (contentBuffer && contentBuffer.length > 0) {
      const { intervals, stats } = normalizeSmtIntervals(contentBuffer.toString('utf8'), {
        source: source ?? 'smt',
      });

      if (intervals.length > 0) {
        const timestamps = intervals.map((i) => i.ts.getTime()).filter((ms) => Number.isFinite(ms));
        const tsMax = timestamps.length ? new Date(Math.max(...timestamps)) : null;
        const tsMinAll = timestamps.length ? new Date(Math.min(...timestamps)) : null;

        if (!tsMax) {
          normalizedSummary = {
            inserted: 0,
            skipped: intervals.length,
            records: intervals.length,
            tsMin: tsMinAll ? tsMinAll.toISOString() : stats.tsMin ?? null,
            tsMax: stats.tsMax ?? null,
            diagnostics: stats,
          };
          return NextResponse.json({
            ok: true,
            id: String(row.id),
            filename: row.filename,
            sizeBytes: row.size_bytes,
            sha256: row.sha256,
            createdAt: row.created_at,
            normalizedInline: normalizedSummary,
          });
        }

        const windowStart = tsMax ? new Date(tsMax.getTime() - 365 * 24 * 60 * 60 * 1000) : null;
        const bounded = windowStart ? intervals.filter((i) => i.ts >= windowStart && i.ts <= tsMax) : intervals;

        const distinctEsiids = Array.from(new Set(bounded.map((i) => i.esiid))).filter(Boolean);

        let inserted = 0;
        let skipped = 0;

        if (bounded.length > 0 && tsMax) {
          try {
            await prisma.$transaction(async (tx) => {
              const boundedTs = bounded.map((i) => i.ts.getTime()).filter((ms) => Number.isFinite(ms));
              const tsMinBound = boundedTs.length ? new Date(Math.min(...boundedTs)) : tsMinAll;

              const pairs = Array.from(new Set(bounded.map((i) => `${i.esiid}|${i.meter}`)))
                .map((k) => {
                  const [e, m] = k.split('|');
                  return { esiid: e, meter: m };
                });

              for (const pair of pairs) {
                const pairIntervals = bounded.filter((i) => i.esiid === pair.esiid && i.meter === pair.meter);
                if (pairIntervals.length === 0) continue;

                const pairTimestamps = pairIntervals.map((i) => i.ts.getTime()).filter((ms) => Number.isFinite(ms));
                const pairMin = pairTimestamps.length ? new Date(Math.min(...pairTimestamps)) : tsMinBound;
                const pairMax = pairTimestamps.length ? new Date(Math.max(...pairTimestamps)) : tsMax;

                await tx.smtInterval.deleteMany({
                  where: {
                    esiid: pair.esiid,
                    meter: pair.meter,
                    ts: { gte: pairMin ?? tsMinBound ?? tsMax, lte: pairMax ?? tsMax },
                  },
                });
              }

              const result = await tx.smtInterval.createMany({
                data: bounded.map((interval) => ({
                  esiid: interval.esiid,
                  meter: interval.meter,
                  ts: interval.ts,
                  kwh: new Prisma.Decimal(interval.kwh),
                  source: interval.source ?? source ?? 'smt',
                })),
                skipDuplicates: false,
              });

              inserted = result.count;
              skipped = bounded.length - result.count;
            });
          } catch (err) {
            console.error('[raw-upload:inline] failed overwrite transaction', { err });
            throw err;
          }

          // Dual-write to usage DB so dashboards see SMT data from inline uploads
          try {
            const usageClient: any = usagePrisma;
            if (usageClient?.usageIntervalModule) {
              const pairs = Array.from(new Set(bounded.map((i) => `${i.esiid}|${i.meter}`)))
                .map((k) => {
                  const [e, m] = k.split('|');
                  return { esiid: e, meter: m };
                });

              for (const pair of pairs) {
                const pairIntervals = bounded.filter((i) => i.esiid === pair.esiid && i.meter === pair.meter);
                if (pairIntervals.length === 0) continue;

                const pairTimestamps = pairIntervals.map((i) => i.ts.getTime()).filter((ms) => Number.isFinite(ms));
                const pairMin = pairTimestamps.length ? new Date(Math.min(...pairTimestamps)) : tsMinAll;
                const pairMax = pairTimestamps.length ? new Date(Math.max(...pairTimestamps)) : tsMax;

                await usageClient.usageIntervalModule.deleteMany({
                  where: {
                    esiid: pair.esiid,
                    meter: pair.meter,
                    ts: { gte: pairMin ?? tsMinAll ?? tsMax, lte: pairMax ?? tsMax },
                  },
                });

                await usageClient.usageIntervalModule.createMany({
                  data: pairIntervals.map((interval) => ({
                    esiid: interval.esiid,
                    meter: interval.meter,
                    ts: interval.ts,
                    kwh: new Prisma.Decimal(interval.kwh),
                    filled: false,
                    source: interval.source ?? source ?? 'smt',
                  })),
                  skipDuplicates: false,
                });
              }
            }
          } catch (usageErr) {
            console.error('[raw-upload:inline] usage dual-write failed', usageErr);
          }

          if (distinctEsiids.length > 0) {
            try {
              const houses = await prisma.houseAddress.findMany({
                where: { esiid: { in: distinctEsiids }, archivedAt: null },
                select: { id: true },
              });
              const houseIds = houses.map((h) => h.id);

              if (houseIds.length > 0) {
                const manualIds = await prisma.manualUsageUpload.findMany({
                  where: { houseId: { in: houseIds } },
                  select: { id: true },
                });
                if (manualIds.length > 0) {
                  await prisma.entry.updateMany({
                    where: { manualUsageId: { in: manualIds.map((m) => m.id) } },
                    data: { manualUsageId: null },
                  });
                }
                await prisma.manualUsageUpload.deleteMany({ where: { houseId: { in: houseIds } } });
                await prisma.greenButtonUpload.deleteMany({ where: { houseId: { in: houseIds } } });

                await usagePrisma.greenButtonInterval.deleteMany({ where: { homeId: { in: houseIds } } });
                await usagePrisma.rawGreenButton.deleteMany({ where: { homeId: { in: houseIds } } });
              }
            } catch (err) {
              console.error('[raw-upload:inline] failed to cleanup green-button/manual data for ESIID(s)', {
                distinctEsiids,
                err,
              });
            }
          }

          try {
            await prisma.rawSmtFile.delete({ where: { id: row.id } });
          } catch (err) {
            console.error('[raw-upload:inline] failed to delete raw record after inline normalize', { err });
          }

          normalizedSummary = {
            inserted,
            skipped,
            records: bounded.length,
            tsMin: tsMinAll ? tsMinAll.toISOString() : stats.tsMin ?? null,
            tsMax: tsMax.toISOString(),
            diagnostics: stats,
          };
        }
      }
    }

    return NextResponse.json({
      ok: true,
      id: String(row.id), // BigInt -> string
      filename: row.filename,
      sizeBytes: row.size_bytes,
      sha256: row.sha256,
      createdAt: row.created_at,
      normalizedInline: normalizedSummary,
    });
  } catch (e: any) {
    // Safety net: if we still hit a P2002 (unique constraint), treat as idempotent
    if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002' && sha256) {
      try {
        const existing = await prisma.rawSmtFile.findUnique({
          where: { sha256 },
          select: { id: true, filename: true, size_bytes: true, sha256: true, created_at: true },
        });
        if (existing) {
          return NextResponse.json({
            ok: true,
            duplicate: true,
            id: String(existing.id),
            filename: existing.filename,
            sizeBytes: existing.size_bytes,
            sha256: existing.sha256,
            createdAt: existing.created_at,
          });
        }
      } catch (lookupError) {
        // If lookup fails, fall through to generic error
        console.error('[raw-upload] P2002 but lookup failed', lookupError);
      }
    }

    // Safe error serialization - avoid BigInt issues
    const errorDetails = e?.message || e?.toString() || 'Unknown database error';
    return NextResponse.json(
      { ok: false, error: 'DB', details: errorDetails },
      { status: 500 },
    );
  }
}
