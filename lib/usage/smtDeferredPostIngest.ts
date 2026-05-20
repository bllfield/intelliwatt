import crypto from 'node:crypto';

import { Prisma } from '@prisma/client';

import { shouldDeferHeavyDbWorkForPool } from '@/lib/db/connectionPoolBudget';
import { prisma } from '@/lib/db';
import { usagePrisma } from '@/lib/db/usageClient';
import { runPlanPipelineForHome } from '@/lib/plan-engine/runPlanPipelineForHome';
import { ensureCoreMonthlyBuckets } from '@/lib/usage/aggregateMonthlyBuckets';

export const DEFERRED_POST_INGEST_SOURCE = 'smt-post-ingest-deferred';

const DEFERRED_POST_INGEST_PREFIX = 'deferred-post-ingest://';

type DeferredPostIngestTask = {
  esiid: string;
  rangeStartIso: string;
  rangeEndIso: string;
};

export function shouldThrottleInlinePostIngest(): boolean {
  // In constrained serverless envs (connection_limit=1 per URL, or limit < datasource count),
  // running heavy post-ingest inline causes pool starvation (P2024). Keep ingest fast and defer.
  return shouldDeferHeavyDbWorkForPool();
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

export async function enqueueDeferredPostIngestTasks(args: {
  distinctEsiids: string[];
  rangeStart: Date;
  rangeEnd: Date;
  logPrefix?: string;
}): Promise<number> {
  const { distinctEsiids, rangeStart, rangeEnd } = args;
  const logPrefix = args.logPrefix ?? '[smt-deferred-post-ingest]';
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
        console.error(`${logPrefix} failed to enqueue deferred post-ingest task`, { esiid: task.esiid, err: e });
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

async function withTaskTimeoutRequired<T>(
  task: Promise<T>,
  timeoutMs: number,
  label: string,
  logPrefix: string,
): Promise<T> {
  const result = await withTaskTimeout(task, timeoutMs, label, logPrefix);
  if (result === null) {
    throw new Error(`${label}_failed_or_timed_out`);
  }
  return result;
}

async function withTaskTimeout<T>(
  task: Promise<T>,
  timeoutMs: number,
  label: string,
  logPrefix: string,
): Promise<T | null> {
  let timer: NodeJS.Timeout | null = null;
  try {
    const timeoutPromise = new Promise<never>((_, reject) => {
      timer = setTimeout(() => reject(new Error(`${label}_timeout`)), timeoutMs);
    });
    return await Promise.race([task, timeoutPromise]);
  } catch (err) {
    console.error(`${logPrefix} ${label} failed/timed out`, err);
    return null;
  } finally {
    if (timer) clearTimeout(timer);
  }
}

export async function processDeferredPostIngestQueue(args: {
  maxTasks?: number;
  taskTimeoutMs?: number;
  logPrefix?: string;
}): Promise<{ processed: number; remaining: number }> {
  const maxTasks = Math.max(0, Math.trunc(Number(args.maxTasks) || 0));
  const taskTimeoutMs = Math.max(1_000, Math.trunc(Number(args.taskTimeoutMs) || 20_000));
  const logPrefix = args.logPrefix ?? '[smt-deferred-post-ingest]';
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
        taskTimeoutMs,
        `deferredUsageDualWrite:${task.esiid}`,
        logPrefix,
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
          taskTimeoutMs,
          `deferredEnsureBuckets:${h.id}`,
          logPrefix,
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
          taskTimeoutMs,
          `deferredPlanPipeline:${h.id}`,
          logPrefix,
        );
      }
      await prisma.rawSmtFile.delete({ where: { id: taskRow.id } });
      processed += 1;
    } catch (e) {
      console.error(`${logPrefix} deferred post-ingest task failed; keeping queued task`, {
        taskFile: taskRow.filename,
        err: e,
      });
    }
  }
  const remaining = await prisma.rawSmtFile.count({ where: { source: DEFERRED_POST_INGEST_SOURCE } });
  return { processed, remaining };
}
