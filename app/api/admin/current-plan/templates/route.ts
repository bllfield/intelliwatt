import { NextRequest, NextResponse } from 'next/server';
import { getCurrentPlanPrisma } from '@/lib/prismaCurrentPlan';

export const dynamic = 'force-dynamic';

function errDetails(err: unknown): { message: string; code?: string | null } {
  const anyErr = err as any;
  const msg =
    err instanceof Error
      ? err.message
      : typeof anyErr?.message === 'string'
        ? anyErr.message
        : String(err ?? 'unknown error');
  const code = typeof anyErr?.code === 'string' ? (anyErr.code as string) : null;
  return { message: msg, ...(code ? { code } : {}) };
}

export async function GET(request: NextRequest) {
  try {
    const adminToken = process.env.ADMIN_TOKEN;
    if (!adminToken) {
      return NextResponse.json(
        { ok: false, error: 'ADMIN_TOKEN not configured' },
        { status: 500 },
      );
    }

    const headerToken = request.headers.get('x-admin-token');
    if (!headerToken || headerToken !== adminToken) {
      return NextResponse.json({ ok: false, error: 'Unauthorized' }, { status: 401 });
    }

    if (!process.env.CURRENT_PLAN_DATABASE_URL) {
      return NextResponse.json(
        { ok: false, error: 'CURRENT_PLAN_DATABASE_URL is not configured' },
        { status: 500 },
      );
    }

    const url = new URL(request.url);
    const limitParam = url.searchParams.get('limit');
    const limit = Math.max(1, Math.min(200, Number(limitParam) || 50));

    const currentPlanPrisma = getCurrentPlanPrisma() as any;

    // Debug: confirm which DB Vercel is connected to (safe to return; no secrets).
    let dbInfo: { db: string | null; schema: string | null } | null = null;
    try {
      const r = (await currentPlanPrisma.$queryRaw`SELECT current_database()::text AS db, current_schema()::text AS schema`) as any;
      const row = Array.isArray(r) ? r[0] : r;
      dbInfo = {
        db: typeof row?.db === 'string' ? row.db : null,
        schema: typeof row?.schema === 'string' ? row.schema : null,
      };
    } catch {
      // ignore (best-effort only)
    }
    const parsedDelegate = currentPlanPrisma.parsedCurrentPlan as any;

    const templates = await parsedDelegate.findMany({
      orderBy: { createdAt: 'desc' },
      take: limit,
    });

    const serialized = templates.map((t: any) => ({
      id: t.id as string,
      userId: t.userId as string,
      houseId: (t.houseId as string | null) ?? null,
      uploadId: (t.uploadId as string | null) ?? null,
      providerName: (t.providerName as string | null) ?? null,
      planName: (t.planName as string | null) ?? null,
      rateType: (t.rateType as string | null) ?? null,
      tdspName: (t.tdspName as string | null) ?? null,
      esiid: (t.esiid as string | null) ?? null,
      meterNumber: (t.meterNumber as string | null) ?? null,
      serviceAddressLine1: (t.serviceAddressLine1 as string | null) ?? null,
      serviceAddressCity: (t.serviceAddressCity as string | null) ?? null,
      serviceAddressState: (t.serviceAddressState as string | null) ?? null,
      serviceAddressZip: (t.serviceAddressZip as string | null) ?? null,
      parserVersion: (t.parserVersion as string | null) ?? null,
      confidenceScore:
        typeof t.confidenceScore === 'number' && Number.isFinite(t.confidenceScore)
          ? (t.confidenceScore as number)
          : null,
      hasTimeOfUse: Boolean(t.timeOfUseConfigJson),
      hasBillCredits: Boolean(t.billCreditsJson),
      createdAt: (t.createdAt as Date).toISOString(),
      updatedAt: (t.updatedAt as Date).toISOString(),
    }));

    return NextResponse.json({
      ok: true,
      limit,
      count: serialized.length,
      templates: serialized,
      ...(dbInfo ? { dbInfo } : {}),
    });
  } catch (error) {
    const d = errDetails(error);
    // eslint-disable-next-line no-console
    console.error('[admin/current-plan/templates] Failed to load templates', {
      code: (d as any).code ?? null,
      message: d.message,
    });

    const msg = String(d.message || '');
    const code = (d as any).code ?? null;
    const looksLikeMissingTable =
      code === 'P2021' ||
      /relation\s+"?ParsedCurrentPlan"?\s+does\s+not\s+exist/i.test(msg) ||
      /table\s+`?ParsedCurrentPlan`?\s+does\s+not\s+exist/i.test(msg);

    const hint = looksLikeMissingTable
      ? 'Current-plan DB schema likely not migrated. Run: npx prisma migrate deploy --schema prisma/current-plan/schema.prisma'
      : null;

    return NextResponse.json(
      {
        ok: false,
        error: 'Failed to load parsed bill templates',
        ...(code ? { code } : {}),
        details: msg.slice(0, 600),
        ...(hint ? { hint } : {}),
      },
      { status: 500 },
    );
  }
}


