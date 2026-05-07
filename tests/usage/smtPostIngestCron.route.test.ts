import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

const mocks = vi.hoisted(() => ({
  requireVercelCron: vi.fn(),
  processDeferredPostIngestQueue: vi.fn(),
}));

vi.mock('@/lib/auth/cron', () => ({
  requireVercelCron: (...args: any[]) => mocks.requireVercelCron(...args),
}));

vi.mock('@/lib/usage/smtDeferredPostIngest', () => ({
  processDeferredPostIngestQueue: (...args: any[]) => mocks.processDeferredPostIngestQueue(...args),
}));

describe('admin SMT deferred post-ingest cron route', () => {
  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
    delete process.env.ADMIN_TOKEN;
    mocks.requireVercelCron.mockReturnValue(null);
    mocks.processDeferredPostIngestQueue.mockResolvedValue({ processed: 1, remaining: 2 });
  });

  it('processes the queue for cron invocations with bounded defaults', async () => {
    const { POST } = await import('@/app/api/admin/smt/cron/post-ingest/route');
    const req = new NextRequest('http://localhost/api/admin/smt/cron/post-ingest', {
      method: 'POST',
      headers: {
        'x-vercel-cron': '1',
      },
    });

    const res = await POST(req);
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(mocks.requireVercelCron).toHaveBeenCalledTimes(1);
    expect(mocks.processDeferredPostIngestQueue).toHaveBeenCalledWith({
      maxTasks: 1,
      taskTimeoutMs: 60_000,
      logPrefix: '[smt-post-ingest-cron]',
    });
    expect(body).toEqual({
      ok: true,
      queue: { processed: 1, remaining: 2 },
      maxTasks: 1,
      taskTimeoutMs: 60_000,
    });
  });

  it('rejects requests without cron or admin auth', async () => {
    const { POST } = await import('@/app/api/admin/smt/cron/post-ingest/route');
    const req = new NextRequest('http://localhost/api/admin/smt/cron/post-ingest', {
      method: 'POST',
    });

    const res = await POST(req);
    const body = await res.json();

    expect(res.status).toBe(401);
    expect(mocks.processDeferredPostIngestQueue).not.toHaveBeenCalled();
    expect(body).toEqual({
      ok: false,
      error: 'Unauthorized',
    });
  });
});
