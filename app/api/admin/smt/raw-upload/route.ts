import { NextRequest, NextResponse } from 'next/server';
import { Prisma } from '@prisma/client';
import { prisma } from '@/lib/db';
import { usagePrisma } from '@/lib/db/usageClient';
import { ensureCoreMonthlyBuckets } from '@/lib/usage/aggregateMonthlyBuckets';
import { normalizeSmtIntervals } from '@/app/lib/smt/normalize';
import { requireAdmin } from '@/lib/auth/admin';
import { runPlanPipelineForHome } from '@/lib/plan-engine/runPlanPipelineForHome';

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
  const meter =
    typeof body.meter === 'string' && body.meter.trim() ? (body.meter as string).trim() : null;
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
  // IMPORTANT:
  // Never purge an entire ESIID history by default. Partial/daily interval files arrive frequently
  // and would otherwise wipe older history (causing "only 30 days show up" symptoms).
  // Full-history reset must be explicitly requested.
  const purgeAll: boolean = body.purgeAll === true;
  // When SMT uploads are chunked into multiple raw-upload calls, we should only run
  // expensive "post ingest" steps (bucket aggregation + plan pipeline) once the final
  // chunk has been ingested.
  const postIngest: boolean = body.postIngest === false ? false : true; // default: true

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
    const contentBuffer = contentBase64 ? Buffer.from(contentBase64, 'base64') : undefined;

    // Idempotency: if a row with this sha256 already exists, we still allow inline normalization
    // when content is provided (e.g., operator "force refresh" / reprocess after a prior failure).
    const existing = await prisma.rawSmtFile.findUnique({
      where: { sha256 }, // requires a UNIQUE on sha256 (which you added)
      select: { id: true, filename: true, size_bytes: true, sha256: true, created_at: true },
    });

    const duplicate = Boolean(existing);
    const row = existing
      ? existing
      : await prisma.rawSmtFile.create({
          data: {
            filename: filename!,
            size_bytes: sizeBytes!,
            sha256: sha256!,
            source,
            content_type: contentType,
            storage_path: storagePath,
            received_at: receivedAt ? new Date(receivedAt) : new Date(),
          },
          select: { id: true, filename: true, size_bytes: true, sha256: true, created_at: true },
        });

    // Early purge of prior data for this ESIID so normalization has a clean slate.
    // NOTE: This is intentionally off by default; only do it for explicit "full refresh" requests.
    if (esiid && purgeAll) {
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
        }, { timeout: 30000 });

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
        esiid,
        meter: meter ?? undefined,
        source: source ?? 'smt',
      });

      // Always emit and return normalization diagnostics (even if intervals=0) so we can
      // debug parsing/header issues in production without needing raw file bytes.
      try {
        console.log('[raw-upload] normalizeSmtIntervals result', {
          filename,
          source,
          esiid,
          meter,
          intervals: intervals.length,
          stats,
        });
      } catch {
        // never block ingest on logging
      }

      if (intervals.length === 0) {
        normalizedSummary = {
          intervalsInserted: 0,
          inserted: 0,
          skipped: 0,
          records: 0,
          tsMin: stats.tsMin ?? null,
          tsMax: stats.tsMax ?? null,
          diagnostics: stats,
        };
      }

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
            // Give this overwrite transaction more time; large FTP files can
            // generate many intervals and the default 5s interactive timeout
            // is too aggressive.
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

              const payload = bounded.map((interval) => ({
                esiid: interval.esiid,
                meter: interval.meter,
                ts: interval.ts,
                kwh: new Prisma.Decimal(interval.kwh),
                source: interval.source ?? source ?? 'smt',
              }));

              // Chunk large createMany writes to reduce memory spikes and oversized DB statements.
              const CHUNK_SIZE = 5000;
              let createdTotal = 0;
              for (let i = 0; i < payload.length; i += CHUNK_SIZE) {
                const slice = payload.slice(i, i + CHUNK_SIZE);
                const res = await tx.smtInterval.createMany({
                  data: slice,
                  skipDuplicates: false,
                });
                createdTotal += res.count;
              }

              inserted = createdTotal;
              skipped = bounded.length - createdTotal;
            }, { timeout: 30000 });
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

                const payload = pairIntervals.map((interval) => ({
                  esiid: interval.esiid,
                  meter: interval.meter,
                  ts: interval.ts,
                  kwh: new Prisma.Decimal(interval.kwh),
                  filled: false,
                  source: interval.source ?? source ?? 'smt',
                }));

                const CHUNK_SIZE = 5000;
                for (let i = 0; i < payload.length; i += CHUNK_SIZE) {
                  await usageClient.usageIntervalModule.createMany({
                    data: payload.slice(i, i + CHUNK_SIZE),
                    skipDuplicates: false,
                  });
                }
              }
            }
          } catch (usageErr) {
            console.error('[raw-upload:inline] usage dual-write failed', usageErr);
          }

          if (distinctEsiids.length > 0 && postIngest) {
            // Best-effort: ensure CORE monthly bucket totals exist for homes touched by this upload.
            // Must never fail SMT ingest.
            try {
              const houses = await prisma.houseAddress.findMany({
                where: { esiid: { in: distinctEsiids }, archivedAt: null },
                select: { id: true, esiid: true },
              });

              const rangeEnd = tsMax ?? new Date();
              const rangeStart = windowStart ?? new Date(rangeEnd.getTime() - 365 * 24 * 60 * 60 * 1000);

              for (const h of houses) {
                if (!h?.id) continue;
                await ensureCoreMonthlyBuckets({
                  homeId: h.id,
                  esiid: h.esiid,
                  rangeStart,
                  rangeEnd,
                  source: "SMT",
                  intervalSource: "SMT",
                });
              }
            } catch (bucketErr) {
              console.error('[raw-upload:inline] CORE bucket aggregation failed (best-effort)', bucketErr);
            }

            // Proactive: any usage being present should trigger the plans pipeline (best-effort, bounded).
            // This fills template mappings + plan-engine estimate cache so /dashboard/plans is instant later.
            try {
              const houses = await prisma.houseAddress.findMany({
                where: { esiid: { in: distinctEsiids }, archivedAt: null },
                select: { id: true },
              });
              for (const h of houses) {
                if (!h?.id) continue;
                await runPlanPipelineForHome({
                  homeId: h.id,
                  reason: 'usage_present',
                  isRenter: false,
                  timeBudgetMs: 7000,
                  maxTemplateOffers: 2,
                  maxEstimatePlans: 12,
                  monthlyCadenceDays: 30,
                  proactiveCooldownMs: 10 * 60 * 1000,
                });
              }
            } catch (pipelineErr) {
              console.error('[raw-upload:inline] plan pipeline failed (best-effort)', pipelineErr);
            }
          }

          // IMPORTANT for debugging/audit: keep the RawSmtFile row (sha256 + storage_path metadata).
          // Raw bytes live in object storage / droplet path referenced by storage_path, not in Postgres.

          normalizedSummary = {
            // Compatibility: older droplet upload server expects `intervalsInserted`
            // (but our app code prefers `inserted`).
            intervalsInserted: inserted,
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
      ...(duplicate ? { duplicate: true } : {}),
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
