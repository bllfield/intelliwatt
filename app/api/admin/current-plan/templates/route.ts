import { NextRequest, NextResponse } from 'next/server';
import { getCurrentPlanPrisma } from '@/lib/prismaCurrentPlan';

export const dynamic = 'force-dynamic';

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

    const url = new URL(request.url);
    const limitParam = url.searchParams.get('limit');
    const limit = Math.max(1, Math.min(200, Number(limitParam) || 50));

    const currentPlanPrisma = getCurrentPlanPrisma() as any;
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
    });
  } catch (error) {
    // eslint-disable-next-line no-console
    console.error('[admin/current-plan/templates] Failed to load templates', error);
    return NextResponse.json(
      { ok: false, error: 'Failed to load parsed bill templates' },
      { status: 500 },
    );
  }
}


