import { NextRequest, NextResponse } from 'next/server';

import { requireVercelCron } from '@/lib/auth/cron';
import { processDeferredPostIngestQueue } from '@/lib/usage/smtDeferredPostIngest';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 300;

const ADMIN_TOKEN = process.env.ADMIN_TOKEN;
const DEFAULT_MAX_TASKS = 1;
const MAX_MAX_TASKS = 5;
const DEFAULT_TASK_TIMEOUT_MS = 60_000;
const MAX_TASK_TIMEOUT_MS = 120_000;

function jsonError(status: number, error: string, details?: unknown) {
  return NextResponse.json({ ok: false, error, ...(details ? { details } : {}) }, { status });
}

function requireCronOrAdmin(req: NextRequest): Response | null {
  if (req.headers.get('x-vercel-cron')) {
    return requireVercelCron(req);
  }
  const headerToken = req.headers.get('x-admin-token');
  if (!ADMIN_TOKEN || !headerToken || headerToken !== ADMIN_TOKEN) {
    return jsonError(401, 'Unauthorized');
  }
  return null;
}

function readPositiveInt(value: string | null, fallback: number, max: number): number {
  const raw = String(value ?? '').trim();
  if (!raw) return fallback;
  const parsed = Number(raw);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.max(0, Math.min(max, Math.trunc(parsed)));
}

export async function POST(req: NextRequest) {
  const guard = requireCronOrAdmin(req);
  if (guard) return guard as any;

  const url = new URL(req.url);
  const maxTasks = readPositiveInt(url.searchParams.get('maxTasks'), DEFAULT_MAX_TASKS, MAX_MAX_TASKS);
  const taskTimeoutMs = readPositiveInt(
    url.searchParams.get('taskTimeoutMs'),
    DEFAULT_TASK_TIMEOUT_MS,
    MAX_TASK_TIMEOUT_MS,
  );

  try {
    const queue = await processDeferredPostIngestQueue({
      maxTasks,
      taskTimeoutMs,
      logPrefix: '[smt-post-ingest-cron]',
    });
    return NextResponse.json({
      ok: true,
      queue,
      maxTasks,
      taskTimeoutMs,
    });
  } catch (error: any) {
    return jsonError(500, 'deferred_post_ingest_failed', error?.message ?? String(error));
  }
}

export async function GET(req: NextRequest) {
  return POST(req);
}
