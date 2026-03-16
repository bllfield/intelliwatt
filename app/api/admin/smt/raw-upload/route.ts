import { NextRequest, NextResponse } from 'next/server';
import { Prisma } from '@prisma/client';
import crypto from 'node:crypto';
import { prisma } from '@/lib/db';
import { usagePrisma } from '@/lib/db/usageClient';
import { ensureCoreMonthlyBuckets } from '@/lib/usage/aggregateMonthlyBuckets';
import { replaceNormalizedSmtIntervals } from '@/lib/usage/normalizeSmtIntervals';
import { normalizeSmtIntervals } from '@/app/lib/smt/normalize';
import { requireAdmin } from '@/lib/auth/admin';
import { runPlanPipelineForHome } from '@/lib/plan-engine/runPlanPipelineForHome';

export const runtime = 'nodejs';
export const maxDuration = 300; // allow large SMT raw uploads

export const dynamic = 'force-dynamic';

const DEFERRED_POST_INGEST_SOURCE = 'smt-post-ingest-deferred';
const DEFERRED_POST_INGEST_PREFIX = 'deferred-post-ingest://';
const THROTTLED_DEFERRED_QUEUE_MIN_INTERVAL_MS = 60_000;
let throttledDeferredQueueLastRunAtMs = 0;

type DeferredPostIngestTask = {
  esiid: string;
  rangeStartIso: string;
  rangeEndIso: string;
};

function parseConnectionLimitFromUrl(rawUrl: string | undefined): number | null {
  const value = String(rawUrl ?? '').trim();
  if (!value) return null;
  try {
    const u = new URL(value);
    const parsed = Number(u.searchParams.get('connection_limit') ?? '');
    return Number.isFinite(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

function shouldThrottleInlinePostIngest(): boolean {
  // In constrained serverless envs (connection_limit=1), running heavy post-ingest
  // work inline reliably causes pool starvation timeouts. Keep ingest fast and defer.
  const primaryLimit = parseConnectionLimitFromUrl(process.env.DATABASE_URL);
  const usageLimit = parseConnectionLimitFromUrl(process.env.USAGE_DATABASE_URL);
  const minConfiguredLimit = [primaryLimit, usageLimit]
    .filter((v): v is number => typeof v === 'number' && Number.isFinite(v))
    .reduce<number | null>((min, v) => (min == null ? v : Math.min(min, v)), null);
  return minConfiguredLimit != null && minConfiguredLimit <= 1;
}

function encodeDeferredTaskPath(task: DeferredPostIngestTask): string {
  const payload = Buffer.from(JSON.stringify(task), 'utf8').toString('base64url');
  return `${DEFERRED_POST_INGEST_PREFIX}${payload}`;
}

function decodeDeferredTaskPath(value: string | null | undefined): DeferredPostIngestTask | null {
  const raw = String(value ?? '');
  if (!raw.startsWith(DEFERRED_POST_INGEST_PREFIX)) return null;
  const payload = raw.slice(DEFERRED_POST_INGEST_PREFIX.length);
  if (!payload) return null;
  try {
    const parsed = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8')) as DeferredPostIngestTask;
    const esiid = String(parsed?.esiid ?? '').trim();
    const rangeStartIso = String(parsed?.rangeStartIso ?? '');
    const rangeEndIso = String(parsed?.rangeEndIso ?? '');
    if (!esiid) return null;
    if (!Number.isFinite(new Date(rangeStartIso).getTime())) return null;
    if (!Number.isFinite(new Date(rangeEndIso).getTime())) return null;
    return { esiid, rangeStartIso, rangeEndIso };
  } catch {
    return null;
  }
}

async function enqueueDeferredPostIngestTasks(args: {
  distinctEsiids: string[];
  rangeStart: Date;
  rangeEnd: Date;
}): Promise<number> {
  const { distinctEsiids, rangeStart, rangeEnd } = args;
  let enqueued = 0;
  for (const esiid of distinctEsiids) {
    const task: DeferredPostIngestTask = {
      esiid: String(esiid ?? '').trim(),
      rangeStartIso: rangeStart.toISOString(),
      rangeEndIso: rangeEnd.toISOString(),
    };
    if (!task.esiid) continue;
    const storagePath = encodeDeferredTaskPath(task);
    const sha = crypto.createHash('sha256').update(storagePath).digest('hex');
    try {
      await prisma.rawSmtFile.create({
        data: {
          filename: `deferred-post-ingest-${task.esiid}-${task.rangeEndIso.slice(0, 10)}.json`,
          size_bytes: 0,
          sha256: sha,
          source: DEFERRED_POST_INGEST_SOURCE,
          content_type: 'application/json',
          storage_path: storagePath,
          received_at: new Date(),
        },
      });
      enqueued += 1;
    } catch (e: any) {
      if (!(e instanceof Prisma.PrismaClientKnownRequestError) || e.code !== 'P2002') {
        console.error('[raw-upload:inline] failed to enqueue deferred post-ingest task', { esiid: task.esiid, err: e });
      }
    }
  }
  return enqueued;
}

async function replayUsageDualWriteForWindow(args: {
  esiid: string;
  rangeStart: Date;
  rangeEnd: Date;
}): Promise<void> {
  const { esiid, rangeStart, rangeEnd } = args;
  const rows = await prisma.smtInterval.findMany({
    where: { esiid, ts: { gte: rangeStart, lte: rangeEnd } },
    select: { esiid: true, meter: true, ts: true, kwh: true, source: true },
    orderBy: [{ meter: 'asc' }, { ts: 'asc' }],
  });
  if (rows.length === 0) return;
  const usageClient: any = usagePrisma;
  if (!usageClient?.usageIntervalModule) return;
  const byMeter = new Map<string, typeof rows>();
  for (const r of rows) {
    const key = String(r.meter ?? '');
    const arr = byMeter.get(key) ?? [];
    arr.push(r);
    byMeter.set(key, arr);
  }
  for (const meterRows of Array.from(byMeter.values())) {
    const minTs = meterRows[0].ts;
    const maxTs = meterRows[meterRows.length - 1].ts;
    const meter = meterRows[0].meter;
    await usageClient.usageIntervalModule.deleteMany({
      where: { esiid, meter, ts: { gte: minTs, lte: maxTs } },
    });
    await usageClient.usageIntervalModule.createMany({
      data: meterRows.map((row) => ({
        esiid: row.esiid,
        meter: row.meter,
        ts: row.ts,
        kwh: row.kwh,
        filled: false,
        source: row.source ?? 'smt-deferred',
      })),
      skipDuplicates: true,
    });
  }
}

async function processDeferredPostIngestQueue(args: {
  maxTasks?: number;
}): Promise<{ processed: number; remaining: number }> {
  const maxTasks = Math.max(0, Math.trunc(Number(args.maxTasks) || 0));
  if (maxTasks <= 0) {
    const remaining = await prisma.rawSmtFile.count({ where: { source: DEFERRED_POST_INGEST_SOURCE } });
    return { processed: 0, remaining };
  }
  const pending = await prisma.rawSmtFile.findMany({
    where: { source: DEFERRED_POST_INGEST_SOURCE },
    orderBy: { received_at: 'asc' },
    take: maxTasks,
    select: { id: true, storage_path: true, filename: true },
  });
  let processed = 0;
  for (const taskRow of pending) {
    const task = decodeDeferredTaskPath(taskRow.storage_path);
    if (!task) {
      await prisma.rawSmtFile.delete({ where: { id: taskRow.id } }).catch(() => null);
      continue;
    }
    const rangeStart = new Date(task.rangeStartIso);
    const rangeEnd = new Date(task.rangeEndIso);
    try {
      await withTaskTimeoutRequired(
        replayUsageDualWriteForWindow({
          esiid: task.esiid,
          rangeStart,
          rangeEnd,
        }),
        20_000,
        `deferredUsageDualWrite:${task.esiid}`
      );
      const houses = await prisma.houseAddress.findMany({
        where: { esiid: task.esiid, archivedAt: null },
        select: { id: true, esiid: true },
      });
      for (const h of houses) {
        if (!h?.id) continue;
        await withTaskTimeoutRequired(
          ensureCoreMonthlyBuckets({
            homeId: h.id,
            esiid: h.esiid,
            rangeStart,
            rangeEnd,
            source: 'SMT',
            intervalSource: 'SMT',
          }),
          20_000,
          `deferredEnsureBuckets:${h.id}`
        );
      }
      for (const h of houses) {
        if (!h?.id) continue;
        await withTaskTimeoutRequired(
          runPlanPipelineForHome({
            homeId: h.id,
            reason: 'usage_present',
            isRenter: false,
            timeBudgetMs: 7000,
            maxTemplateOffers: 2,
            maxEstimatePlans: 12,
            monthlyCadenceDays: 30,
            proactiveCooldownMs: 10 * 60 * 1000,
          }),
          20_000,
          `deferredPlanPipeline:${h.id}`
        );
      }
      await prisma.rawSmtFile.delete({ where: { id: taskRow.id } });
      processed += 1;
    } catch (e) {
      console.error('[raw-upload:inline] deferred post-ingest task failed; keeping queued task', {
        taskFile: taskRow.filename,
        err: e,
      });
    }
  }
  const remaining = await prisma.rawSmtFile.count({ where: { source: DEFERRED_POST_INGEST_SOURCE } });
  return { processed, remaining };
}

function deferredQueueMaxTasksForRequest(throttleInlinePostIngest: boolean): number {
  if (!throttleInlinePostIngest) return 3;
  const now = Date.now();
  if (now - throttledDeferredQueueLastRunAtMs < THROTTLED_DEFERRED_QUEUE_MIN_INTERVAL_MS) {
    return 0;
  }
  throttledDeferredQueueLastRunAtMs = now;
  // Under constrained pools, drain very slowly but never fully starve the queue.
  return 1;
}

async function withTaskTimeoutRequired<T>(task: Promise<T>, timeoutMs: number, label: string): Promise<T> {
  const result = await withTaskTimeout(task, timeoutMs, label);
  if (result === null) {
    throw new Error(`${label}_failed_or_timed_out`);
  }
  return result;
}

async function withTaskTimeout<T>(task: Promise<T>, timeoutMs: number, label: string): Promise<T | null> {
  let timer: NodeJS.Timeout | null = null;
  try {
    const timeoutPromise = new Promise<never>((_, reject) => {
      timer = setTimeout(() => reject(new Error(`${label}_timeout`)), timeoutMs);
    });
    return await Promise.race([task, timeoutPromise]);
  } catch (err) {
    console.error(`[raw-upload:inline] ${label} failed/timed out`, err);
    return null;
  } finally {
    if (timer) clearTimeout(timer);
  }
}

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
  // Default to false so upload/normalize returns fast unless caller explicitly opts in.
  const postIngest: boolean = body.postIngest === true;
  const throttleInlinePostIngest = shouldThrottleInlinePostIngest();
  const runInlinePostIngest = postIngest && !throttleInlinePostIngest;

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
            const persisted = await replaceNormalizedSmtIntervals({
              intervals: bounded.map((interval) => ({
                esiid: interval.esiid,
                meter: interval.meter,
                ts: interval.ts,
                kwh: interval.kwh,
                source: interval.source ?? source ?? 'smt',
              })),
              transactionTimeoutMs: 30_000,
              primaryChunkSize: 5000,
              usageChunkSize: 5000,
              // Avoid second-client write pressure in constrained pools.
              writeUsageModule: !throttleInlinePostIngest,
            });
            inserted = persisted.inserted;
            skipped = persisted.skipped;
          } catch (err) {
            console.error('[raw-upload:inline] failed overwrite transaction', { err });
            throw err;
          }

          if (distinctEsiids.length > 0 && runInlinePostIngest) {
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
                await withTaskTimeout(
                  ensureCoreMonthlyBuckets({
                    homeId: h.id,
                    esiid: h.esiid,
                    rangeStart,
                    rangeEnd,
                    source: "SMT",
                    intervalSource: "SMT",
                  }),
                  20_000,
                  "ensureCoreMonthlyBuckets"
                );
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
                await withTaskTimeout(
                  runPlanPipelineForHome({
                    homeId: h.id,
                    reason: 'usage_present',
                    isRenter: false,
                    timeBudgetMs: 7000,
                    maxTemplateOffers: 2,
                    maxEstimatePlans: 12,
                    monthlyCadenceDays: 30,
                    proactiveCooldownMs: 10 * 60 * 1000,
                  }),
                  20_000,
                  "runPlanPipelineForHome"
                );
              }
            } catch (pipelineErr) {
              console.error('[raw-upload:inline] plan pipeline failed (best-effort)', pipelineErr);
            }
          }
          let deferredTasksEnqueued = 0;
          if (distinctEsiids.length > 0 && postIngest && !runInlinePostIngest) {
            const rangeEnd = tsMax ?? new Date();
            const rangeStart = windowStart ?? new Date(rangeEnd.getTime() - 365 * 24 * 60 * 60 * 1000);
            deferredTasksEnqueued = await enqueueDeferredPostIngestTasks({
              distinctEsiids,
              rangeStart,
              rangeEnd,
            });
            console.warn('[raw-upload:inline] postIngest requested but deferred due to constrained DB pool', {
              esiids: distinctEsiids.length,
              tasksEnqueued: deferredTasksEnqueued,
            });
          }
          const deferredQueueMaxTasks = deferredQueueMaxTasksForRequest(throttleInlinePostIngest);
          const deferredQueueRun = await processDeferredPostIngestQueue({
            // In constrained pools (connection_limit<=1), avoid retry storms while
            // still allowing queued tasks to make incremental progress.
            maxTasks: deferredQueueMaxTasks,
          });

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
            postIngestDeferred: postIngest && !runInlinePostIngest,
            usageDualWriteDeferred: throttleInlinePostIngest,
            deferredQueueProcessingSkipped: deferredQueueMaxTasks === 0,
            deferredTasksEnqueued,
            deferredTasksProcessed: deferredQueueRun.processed,
            deferredTasksRemaining: deferredQueueRun.remaining,
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