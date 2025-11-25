import { NextResponse } from 'next/server';
import { recalculateAllReferrals } from '@/lib/referral/qualify';

export const dynamic = 'force-dynamic';

export async function POST() {
  try {
    const result = await recalculateAllReferrals();
    return NextResponse.json({
      ok: true,
      ...result,
      timestamp: new Date().toISOString(),
    });
  } catch (error) {
    console.error('Error recalculating referrals:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}

