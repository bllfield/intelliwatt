import { cookies } from 'next/headers';
import { NextRequest, NextResponse } from 'next/server';

import { prisma } from '@/lib/db';
import { normalizeEmail } from '@/lib/utils/email';
import { resolveIntervalsLayer } from '@/lib/usage/resolveIntervalsLayer';
import { IntervalSeriesKind } from '@/modules/usageSimulator/kinds';
import { toPublicHouseLabel } from "@/modules/usageSimulator/houseLabel";
import { getHomeProfileSimulatedByUserHouse } from "@/modules/homeProfile/repo";
import { getApplianceProfileSimulatedByUserHouse } from "@/modules/applianceProfile/repo";
import { normalizeStoredApplianceProfile } from "@/modules/applianceProfile/validation";
import { getManualUsageInputForUserHouse } from "@/modules/manualUsage/store";
import { resolveSharedWeatherSensitivityEnvelope } from "@/modules/weatherSensitivity/shared";
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
      const [homeProfile, applianceProfileRec, manualUsageRec] = await Promise.all([
        getHomeProfileSimulatedByUserHouse({ userId: user.id, houseId: house.id }),
        getApplianceProfileSimulatedByUserHouse({ userId: user.id, houseId: house.id }),
        getManualUsageInputForUserHouse({ userId: user.id, houseId: house.id }).catch(() => ({ payload: null })),
      ]);
      const applianceProfile = normalizeStoredApplianceProfile((applianceProfileRec?.appliancesJson as any) ?? null);
      const weatherSensitivity = await resolveSharedWeatherSensitivityEnvelope({
        actualDataset: result.dataset,
        manualUsagePayload: manualUsageRec?.payload ?? null,
        homeProfile,
        applianceProfile,
        weatherHouseId: house.id,
      }).catch(() => ({ score: null, derivedInput: null }));
      results.push({
        houseId: house.id,
        label: toPublicHouseLabel({
          label: house.label,
          addressLine1: house.addressLine1,
          fallbackId: house.id,
        }),
        address: {
          line1: house.addressLine1,
          city: house.addressCity,
          state: house.addressState,
        },
        esiid: house.esiid,
        dataset: result.dataset,
        alternatives: result.alternatives,
        datasetError:
          result.dataset == null
            ? {
                code: 'ACTUAL_DATA_UNAVAILABLE',
                explanation:
                  'We could not load interval usage for this home right now. This can happen when SMT/Green Button data is still syncing or temporarily unavailable.',
              }
            : null,
        weatherSensitivityScore: weatherSensitivity.score,
        weatherEfficiencyDerivedInput: weatherSensitivity.derivedInput,
      });
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