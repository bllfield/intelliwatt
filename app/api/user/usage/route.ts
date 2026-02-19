import { cookies } from 'next/headers';
import { NextRequest, NextResponse } from 'next/server';

import { prisma } from '@/lib/db';
import { normalizeEmail } from '@/lib/utils/email';
import { getActualUsageDatasetForHouse } from '@/lib/usage/actualDatasetForHouse';

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
      let result: Awaited<ReturnType<typeof getActualUsageDatasetForHouse>>;
      try {
        result = await getActualUsageDatasetForHouse(house.id, house.esiid ?? null);
      } catch (err) {
        console.warn('[user/usage] actual dataset fetch failed for house', house.id, err);
        result = { dataset: null, alternatives: { smt: null, greenButton: null } };
      }
      results.push({
        houseId: house.id,
        label: house.label || house.addressLine1,
        address: {
          line1: house.addressLine1,
          city: house.addressCity,
          state: house.addressState,
        },
        esiid: house.esiid,
        dataset: result.dataset,
        alternatives: result.alternatives,
      });
    }

    return NextResponse.json(
      {
        ok: true,
        houses: results,
      },
      {
        headers: {
          // Browser/private caching only; user-specific (cookie auth). This just reduces repeated fetches.
          // Usage changes infrequently; keep this fairly "sticky" so re-entering the page doesn't feel like recomputation.
          'Cache-Control': 'private, max-age=900, stale-while-revalidate=86400',
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
    return NextResponse.json({ ok: false, error: 'Internal error', ...(detail ? { detail } : {}) }, { status: 500 });
  }
}
