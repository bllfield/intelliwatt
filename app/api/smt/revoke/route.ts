import { NextRequest, NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import { prisma } from '@/lib/db';
import { normalizeEmail } from '@/lib/utils/email';
import { refreshUserEntryStatuses } from '@/lib/hitthejackwatt/entryLifecycle';

export const dynamic = 'force-dynamic';

export async function POST(request: NextRequest) {
  try {
    const cookieStore = cookies();
    const userEmailRaw = cookieStore.get('intelliwatt_user')?.value;

    if (!userEmailRaw) {
      return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });
    }

    const body = await request.json().catch(() => null);
    const authorizationId =
      typeof body?.authorizationId === 'string' && body.authorizationId.trim().length > 0
        ? body.authorizationId.trim()
        : null;

    if (!authorizationId) {
      return NextResponse.json({ error: 'authorizationId is required' }, { status: 400 });
    }

    const userEmail = normalizeEmail(userEmailRaw);
    const user = await prisma.user.findUnique({
      where: { email: userEmail },
      select: { id: true },
    });

    if (!user) {
      return NextResponse.json({ error: 'User not found' }, { status: 404 });
    }

    const authorization = await prisma.smtAuthorization.findFirst({
      where: {
        id: authorizationId,
        userId: user.id,
      },
      select: {
        id: true,
        archivedAt: true,
      },
    });

    if (!authorization) {
      return NextResponse.json({ error: 'SMT authorization not found' }, { status: 404 });
    }

    if (authorization.archivedAt) {
      return NextResponse.json({
        ok: true,
        message: 'Authorization already archived',
      });
    }

    const now = new Date();

    await prisma.smtAuthorization.update({
      where: { id: authorization.id },
      data: {
        archivedAt: now,
        smtStatus: 'archived',
        smtStatusMessage: 'Customer requested revocation',
        revokedReason: 'customer_requested',
      },
    });

    await prisma.userProfile.updateMany({
      where: { userId: user.id },
      data: {
        esiidAttentionRequired: true,
        esiidAttentionCode: 'smt_revoke_requested',
        esiidAttentionAt: now,
      },
    });

    await refreshUserEntryStatuses(user.id);

    return NextResponse.json({
      ok: true,
      message: 'Smart Meter Texas access revocation requested.',
    });
  } catch (error) {
    console.error('[smt/revoke] Failed to revoke SMT authorization', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}


