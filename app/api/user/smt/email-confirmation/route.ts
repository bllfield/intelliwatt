import { NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import { prisma } from '@/lib/db';
import { normalizeEmail } from '@/lib/utils/email';
import { qualifyReferralsForUser } from '@/lib/referral/qualify';
import { refreshUserEntryStatuses } from '@/lib/hitthejackwatt/entryLifecycle';

export const dynamic = 'force-dynamic';

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const status = body?.status;

    if (status !== 'approved' && status !== 'declined') {
      return NextResponse.json({ error: 'Invalid status' }, { status: 400 });
    }

    const cookieStore = cookies();
    const rawEmail = cookieStore.get('intelliwatt_user')?.value;

    if (!rawEmail) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const email = normalizeEmail(rawEmail);
    const user = await prisma.user.findUnique({
      where: { email },
      select: { id: true },
    });

    if (!user) {
      return NextResponse.json({ error: 'User missing' }, { status: 404 });
    }

    const authorization = await prisma.smtAuthorization.findFirst({
      where: {
        userId: user.id,
        archivedAt: null,
      },
      orderBy: {
        createdAt: 'desc',
      },
      select: { id: true },
    });

    if (!authorization) {
      return NextResponse.json({ error: 'No SMT authorization found to confirm' }, { status: 400 });
    }

    const now = new Date();

    if (status === 'approved') {
      await prisma.$transaction(async (tx) => {
        const txAny = tx as any;
        await txAny.smtAuthorization.update({
          where: { id: authorization.id },
          data: {
            emailConfirmationStatus: 'APPROVED',
            emailConfirmationAt: now,
            smtStatusMessage: 'Customer confirmed SMT authorization email',
          },
        });

        await tx.userProfile.updateMany({
          where: { userId: user.id },
          data: {
            esiidAttentionRequired: false,
            esiidAttentionCode: null,
            esiidAttentionAt: null,
          },
        });
      });

      await refreshUserEntryStatuses(user.id);
      await qualifyReferralsForUser(user.id);

      return NextResponse.json({ ok: true, status: 'approved' });
    }

    await prisma.$transaction(async (tx) => {
      const txAny = tx as any;
      await txAny.smtAuthorization.update({
        where: { id: authorization.id },
        data: {
          emailConfirmationStatus: 'DECLINED',
          emailConfirmationAt: now,
          smtStatusMessage: 'Customer declined SMT authorization email',
        },
      });

      await tx.userProfile.updateMany({
        where: { userId: user.id },
        data: {
          esiidAttentionRequired: true,
          esiidAttentionCode: 'smt_email_declined',
          esiidAttentionAt: now,
        },
      });

      await tx.entry.updateMany({
        where: {
          userId: user.id,
          type: 'smart_meter_connect',
          status: { in: ['ACTIVE', 'EXPIRING_SOON'] },
        },
        data: {
          status: 'EXPIRED',
          expiresAt: now,
          expirationReason: 'smt_email_declined',
        },
      });
    });

    await refreshUserEntryStatuses(user.id);

    return NextResponse.json({ ok: true, status: 'declined' });
  } catch (error) {
    console.error('[user/smt/email-confirmation] Failed to update status', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
