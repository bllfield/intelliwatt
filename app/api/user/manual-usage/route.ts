import { cookies } from 'next/headers';
import { NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import { normalizeEmail } from '@/lib/utils/email';
import { refreshUserEntryStatuses } from '@/lib/hitthejackwatt/entryLifecycle';

const MANUAL_USAGE_LIFETIME_DAYS = 365;

export async function POST(request: Request) {
  try {
    const cookieStore = cookies();
    const userEmailRaw = cookieStore.get('intelliwatt_user')?.value;

    if (!userEmailRaw) {
      return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });
    }

    const userEmail = normalizeEmail(userEmailRaw);
    const user = await prisma.user.findUnique({
      where: { email: userEmail },
      select: { id: true },
    });

    if (!user) {
      return NextResponse.json({ error: 'User not found' }, { status: 404 });
    }

    const body = await request.json().catch(() => ({}));
    const houseId =
      typeof body?.houseId === 'string' && body.houseId.trim().length > 0 ? body.houseId.trim() : null;

    if (houseId) {
      const ownsHouse = await prisma.houseAddress.findFirst({
        where: { id: houseId, userId: user.id },
        select: { id: true },
      });

      if (!ownsHouse) {
        return NextResponse.json({ error: 'House not found for user' }, { status: 403 });
      }
    }

    const now = new Date();
    const expiresAt = new Date(now.getTime() + MANUAL_USAGE_LIFETIME_DAYS * 24 * 60 * 60 * 1000);

    const manualUsage = await (prisma as any).manualUsageUpload.create({
      data: {
        userId: user.id,
        houseId,
        expiresAt,
      },
    });

    await refreshUserEntryStatuses(user.id);

    return NextResponse.json({
      id: manualUsage.id,
      expiresAt: manualUsage.expiresAt.toISOString(),
      uploadedAt: manualUsage.uploadedAt.toISOString(),
    });
  } catch (error) {
    console.error('Error creating manual usage record:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}

