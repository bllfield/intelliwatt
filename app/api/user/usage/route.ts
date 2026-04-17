import { cookies } from 'next/headers';
import { NextRequest, NextResponse } from 'next/server';

import { prisma } from '@/lib/db';
import { normalizeEmail } from '@/lib/utils/email';
import { resolveIntervalsLayer } from '@/lib/usage/resolveIntervalsLayer';
import { buildUserUsageHouseContract } from "@/lib/usage/userUsageHouseContract";
import { IntervalSeriesKind } from '@/modules/usageSimulator/kinds';
import { toPublicHouseLabel } from "@/modules/usageSimulator/houseLabel";
import {
  classifySimulationFailure,
  recordSimulationDataAlert,
} from '@/modules/usageSimulator/simulationDataAlerts';

/** Allow time for per-house interval resolution (SMT/Green Button) when loading Usage. */
export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 120;
const PER_HOUSE_RESOLVE_TIMEOUT_MS = 45_000;

async function withTaskTimeout<T>(task: Promise<T>, timeoutMs: number, label: string): Promise<T | null> {
  let timer: NodeJS.Timeout | null = null;
  try {
    const timeoutPromise = new Promise<never>((_, reject) => {
      timer = setTimeout(() => reject(new Error(`${label}_timeout`)), timeoutMs);
    });
    return await Promise.race([task, timeoutPromise]);
  } catch (err) {
    console.warn(`[user/usage] ${label} failed/timed out`, err);
    return null;
  } finally {
    if (timer) clearTimeout(timer);
  }
}

export async function GET(_request: NextRequest) {
  try {
    const cookieStore = cookies();
    const rawEmail = cookieStore.get('intelliwatt_user')?.value;
    if (!rawEmail) {
      return NextResponse.json({ ok: false, error: 'Not authenticated' }, { status: 401 });
    }

    const userEmail = normalizeEmail(rawEmail);
    const user = await prisma.user.findUnique({
      where: { email: userEmail },
      select: { id: true },
    });

    if (!user) {
      return NextResponse.json({ ok: false, error: 'User not found' }, { status: 404 });
    }

    const houses = await prisma.houseAddress.findMany({
      where: { userId: user.id, archivedAt: null },
      select: {
        id: true,
        label: true,
        addressLine1: true,
        addressCity: true,
        addressState: true,
        esiid: true,
      },
    });

    const results = [];
    for (const house of houses) {
      let result: { dataset: any | null; alternatives: { smt: any; greenButton: any } };
      try {
        const resolved = await withTaskTimeout(
          resolveIntervalsLayer({
            userId: user.id,
            houseId: house.id,
            layerKind: IntervalSeriesKind.ACTUAL_USAGE_INTERVALS,
            esiid: house.esiid ?? null,
          }),
          PER_HOUSE_RESOLVE_TIMEOUT_MS,
          `resolveIntervalsLayer:${house.id}`
        );
        result = resolved ?? { dataset: null, alternatives: { smt: null, greenButton: null } };
      } catch (err) {
        console.warn('[user/usage] actual dataset fetch failed for house', house.id, err);
        const rawErrCode = (err as any)?.code;
        const errCode = String(rawErrCode ?? (err as any)?.name ?? 'INTERNAL_ERROR');
        const errMessage = String((err as any)?.message ?? 'actual interval fetch failed');
        const classification = classifySimulationFailure({
          code: errCode,
          message: errMessage,
          error: String((err as any)?.error ?? ''),
        });
        void recordSimulationDataAlert({
          source: 'USAGE_DASHBOARD',
          userId: user.id,
          userEmail,
          houseId: house.id,
          houseLabel: toPublicHouseLabel({
            label: house.label,
            addressLine1: house.addressLine1,
            fallbackId: house.id,
          }),
          reasonCode: classification.reasonCode,
          reasonMessage: classification.reasonMessage,
          missingData: classification.missingData,
          context: {
            route: '/api/user/usage',
            internalCode: errCode,
            internalMessage: errMessage,
          },
        }).catch(() => null);
        result = { dataset: null, alternatives: { smt: null, greenButton: null } };
      }
      results.push(
        await buildUserUsageHouseContract({
          userId: user.id,
          house: {
            id: house.id,
            label: house.label,
            addressLine1: house.addressLine1,
            addressCity: house.addressCity,
            addressState: house.addressState,
            esiid: house.esiid,
          },
          resolvedUsage: result,
        })
      );
    }

    return NextResponse.json(
      {
        ok: true,
        houses: results,
      },
      {
        headers: {
          // User-scoped usage must reflect latest simulator/baseline changes immediately.
          "Cache-Control": "private, no-store, max-age=0, must-revalidate",
        },
      },
    );
  } catch (error) {
    console.error('[user/usage] failed to fetch usage dataset', error);
    // If an admin is logged in (e.g., impersonation/support), include a safe detail string
    // to speed up debugging without leaking internals to normal users.
    let detail: string | undefined = undefined;
    try {
      const cookieStore = cookies();
      const isAdmin = Boolean(cookieStore.get('intelliwatt_admin')?.value);
      if (isAdmin) {
        detail = String((error as any)?.message || error || '').slice(0, 500);
      }
    } catch {
      // ignore
    }
    return NextResponse.json(
      {
        ok: false,
        error: 'Internal error',
        explanation: 'Usage data could not be loaded right now due to a temporary backend failure.',
        ...(detail ? { detail } : {}),
      },
      { status: 500 }
    );
  }
}