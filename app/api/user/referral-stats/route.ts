import { NextRequest, NextResponse } from 'next/server';
import { cookies } from 'next/headers';

import { db } from '@/lib/db';
import { normalizeEmail } from '@/lib/utils/email';

export const dynamic = 'force-dynamic';

export async function GET(_request: NextRequest) {
  try {
    const cookieStore = cookies();
    const userEmailRaw = cookieStore.get('intelliwatt_user')?.value;

    if (!userEmailRaw) {
      return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });
    }

    const userEmail = normalizeEmail(userEmailRaw);

    const user = await db.user.findUnique({
      where: { email: userEmail },
      select: { id: true },
    });

    if (!user) {
      return NextResponse.json({ error: 'User not found' }, { status: 404 });
    }

    const [totalReferrals, referralEntryTotals] = await db.$transaction([
      db.referral.count({
        where: {
          referredById: user.id,
        },
      }),
      db.entry.aggregate({
        where: {
          userId: user.id,
          type: 'referral',
          status: {
            in: ['ACTIVE', 'EXPIRING_SOON'],
          },
        },
        _sum: {
          amount: true,
        },
      }),
    ]);

    const totalEntries = referralEntryTotals._sum.amount ?? 0;

    return NextResponse.json({
      totalReferrals,
      totalEntries,
    });
  } catch (error) {
    console.error('Error loading referral stats:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}

