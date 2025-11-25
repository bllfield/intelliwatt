import { NextResponse } from 'next/server';
import { getEntryExpiryDigestRecords } from '@/lib/hitthejackwatt/entryLifecycle';

export const dynamic = 'force-dynamic';

export async function GET() {
  try {
    const entries = await getEntryExpiryDigestRecords();
    return NextResponse.json(
      entries.map((entry) => ({
        entryId: entry.entryId,
        userId: entry.userId,
        entryType: entry.entryType,
        status: entry.status,
        expiresAt: entry.expiresAt ? entry.expiresAt.toISOString() : null,
        recordedAt: entry.recordedAt.toISOString(),
        email: entry.email,
      })),
    );
  } catch (error) {
    console.error('[ENTRY_EXPIRY_DIGEST_FETCH_ERROR]', error);
    return NextResponse.json({ error: 'Failed to load entry expiry digest' }, { status: 500 });
  }
}

