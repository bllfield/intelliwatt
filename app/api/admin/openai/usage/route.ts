import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/db';

export const dynamic = 'force-dynamic';

export async function GET(request: NextRequest) {
  try {
    const adminToken = process.env.ADMIN_TOKEN;
    if (!adminToken) {
      return NextResponse.json(
        { error: 'ADMIN_TOKEN not configured' },
        { status: 500 },
      );
    }

    const headerToken = request.headers.get('x-admin-token');
    if (!headerToken || headerToken !== adminToken) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const url = new URL(request.url);
    const windowDaysParam = url.searchParams.get('windowDays');
    const windowDays = Math.max(
      1,
      Math.min(90, Number(windowDaysParam) || 30),
    );

    const now = new Date();
    const windowStart = new Date(
      now.getTime() - windowDays * 24 * 60 * 60 * 1000,
    );

    const [windowEvents, recentEvents] = await Promise.all([
      prisma.openAIUsageEvent.findMany({
        where: { createdAt: { gte: windowStart } },
        orderBy: { createdAt: 'asc' },
      }),
      prisma.openAIUsageEvent.findMany({
        orderBy: { createdAt: 'desc' },
        take: 50,
      }),
    ]);

    const summaryByDayMap = new Map<
      string,
      { calls: number; totalTokens: number; costUsd: number }
    >();

    let windowTotalCost = 0;

    for (const ev of windowEvents) {
      const dateKey = ev.createdAt.toISOString().slice(0, 10);
      const day =
        summaryByDayMap.get(dateKey) ?? {
          calls: 0,
          totalTokens: 0,
          costUsd: 0,
        };

      day.calls += 1;
      day.totalTokens += ev.totalTokens;
      day.costUsd += Number(ev.costUsd);
      summaryByDayMap.set(dateKey, day);
      windowTotalCost += Number(ev.costUsd);
    }

    const summaryByDay = Array.from(summaryByDayMap.entries())
      .sort((a, b) => a[0].localeCompare(b[0]))
      .map(([date, stats]) => ({ date, ...stats }));

    type ModuleSummary = {
      module: string;
      calls: number;
      totalTokens: number;
      costUsd: number;
      callsLastWindow: number;
      costUsdLastWindow: number;
    };

    const moduleMap = new Map<string, ModuleSummary>();

    const addToModule = (ev: (typeof windowEvents)[number], inWindow: boolean) => {
      const key = ev.module;
      const mod: ModuleSummary =
        moduleMap.get(key) ?? {
          module: key,
          calls: 0,
          totalTokens: 0,
          costUsd: 0,
          callsLastWindow: 0,
          costUsdLastWindow: 0,
        };

      mod.calls += 1;
      mod.totalTokens += ev.totalTokens;
      mod.costUsd += Number(ev.costUsd);

      if (inWindow) {
        mod.callsLastWindow += 1;
        mod.costUsdLastWindow += Number(ev.costUsd);
      }

      moduleMap.set(key, mod);
    };

    for (const ev of windowEvents) {
      addToModule(ev, true);
    }

    for (const ev of recentEvents) {
      if (ev.createdAt >= windowStart) continue;
      addToModule(ev, false);
    }

    const summaryByModule = Array.from(moduleMap.values()).sort(
      (a, b) => b.costUsdLastWindow - a.costUsdLastWindow,
    );

    const recent = recentEvents.map((ev) => ({
      id: ev.id,
      createdAt: ev.createdAt.toISOString(),
      module: ev.module,
      operation: ev.operation,
      model: ev.model,
      inputTokens: ev.inputTokens,
      outputTokens: ev.outputTokens,
      totalTokens: ev.totalTokens,
      costUsd: Number(ev.costUsd),
    }));

    return NextResponse.json({
      ok: true,
      windowDays,
      totalWindowCalls: windowEvents.length,
      totalWindowCostUsd: windowTotalCost,
      summaryByDay,
      summaryByModule,
      recentEvents: recent,
    });
  } catch (error) {
    // eslint-disable-next-line no-console
    console.error('[admin/openai/usage] Failed to load OpenAI usage', error);
    return NextResponse.json(
      { error: 'Failed to load OpenAI usage' },
      { status: 500 },
    );
  }
}


