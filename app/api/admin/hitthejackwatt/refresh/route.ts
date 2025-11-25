import { NextResponse } from 'next/server';
import { refreshAllUsersAndBuildExpiryDigest } from '@/lib/hitthejackwatt/entryLifecycle';

export const dynamic = 'force-dynamic';

export async function POST(request: Request) {
  const token = request.headers.get('x-admin-token') || '';
  if (process.env.ADMIN_TOKEN && token !== process.env.ADMIN_TOKEN) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  try {
    const flagged = await refreshAllUsersAndBuildExpiryDigest();
    return NextResponse.json({
      ok: true,
      flaggedCount: flagged.length,
      entries: flagged.map((entry) => ({
        entryId: entry.entryId,
        userId: entry.userId,
        entryType: entry.entryType,
        status: entry.status,
        expiresAt: entry.expiresAt ? entry.expiresAt.toISOString() : null,
        recordedAt: entry.recordedAt.toISOString(),
        email: entry.email,
      })),
    });
  } catch (error) {
    console.error('[ENTRY_EXPIRY_REFRESH_ERROR]', error);
    return NextResponse.json({ error: 'Failed to refresh entry statuses' }, { status: 500 });
  }
}

