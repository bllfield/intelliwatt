import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import { requireVercelCron } from '@/lib/auth/cron';

export const runtime = 'nodejs';

export async function GET(req: NextRequest) {
  const guard = requireVercelCron(req);
  if (guard) return guard;

  const sp = req.nextUrl.searchParams;
  const rawStatus = sp.get('status');
  const rawTdsp = sp.get('tdsp');

  const where: any = {};
  if (rawStatus && rawStatus.trim()) where.status = rawStatus.trim();
  if (rawTdsp && rawTdsp.trim()) where.tdsp = rawTdsp.trim();

  try {
    const ingestModel = (prisma as any).ercotIngestLog;
    const row = ingestModel
      ? await ingestModel.findFirst({
          where,
          orderBy: { finishedAt: 'desc' },
        })
      : null;
    return NextResponse.json({ ok: true, row }
    );
  } catch (err: any) {
    return NextResponse.json({ ok: false, error: String(err?.message || err) }, { status: 500 });
  }
}
