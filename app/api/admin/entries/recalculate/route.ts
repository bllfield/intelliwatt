import { NextResponse } from 'next/server';
import { refreshAllUsersAndBuildExpiryDigest } from '@/lib/hitthejackwatt/entryLifecycle';

export const dynamic = 'force-dynamic';

export async function POST() {
  try {
    const digest = await refreshAllUsersAndBuildExpiryDigest();
    return NextResponse.json({
      ok: true,
      flaggedCount: digest.length,
      timestamp: new Date().toISOString(),
    });
  } catch (error) {
    console.error('Error recalculating entry statuses:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}

