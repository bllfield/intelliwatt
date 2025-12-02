import { NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import { EntryStatus } from '@prisma/client';

import { prisma } from '@/lib/db';
import { normalizeEmail } from '@/lib/utils/email';
import { qualifyReferralsForUser } from '@/lib/referral/qualify';
import { refreshUserEntryStatuses } from '@/lib/hitthejackwatt/entryLifecycle';
import { refreshSmtAuthorizationStatus } from '@/lib/smt/agreements';
import { ensureSmartMeterEntry } from '@/lib/smt/ensureSmartMeterEntry';

export const dynamic = 'force-dynamic';

const ACTIVE_STATUSES = new Set(['ACTIVE', 'ALREADY_ACTIVE']);

async function markAuthorizationDeclined(params: {
  authorizationId: string;
  userId: string;
  houseAddressId: string | null;
  message: string;
  occurredAt: Date;
}) {
  const { authorizationId, userId, houseAddressId, message, occurredAt } = params;

  await prisma.$transaction(async (tx) => {
    const txAny = tx as any;

    await txAny.smtAuthorization.update({
      where: { id: authorizationId },
      data: {
        emailConfirmationStatus: 'DECLINED',
        emailConfirmationAt: occurredAt,
        smtStatus: 'DECLINED',
        smtStatusMessage: message,
      },
    });

    await tx.userProfile.updateMany({
      where: { userId },
      data: {
        esiidAttentionRequired: true,
        esiidAttentionCode: 'smt_email_declined',
        esiidAttentionAt: occurredAt,
      },
    });

    const affectedEntries = await tx.entry.findMany({
      where: {
        userId,
        type: 'smart_meter_connect',
        houseId: houseAddressId ?? null,
      },
      select: { id: true, status: true },
    });

    if (affectedEntries.length > 0) {
      await tx.entry.updateMany({
        where: {
          userId,
          type: 'smart_meter_connect',
          houseId: houseAddressId ?? null,
          status: { in: ['ACTIVE', 'EXPIRING_SOON'] },
        },
        data: {
          status: 'EXPIRED',
          expiresAt: occurredAt,
          expirationReason: 'smt_email_declined',
          lastValidated: occurredAt,
        },
      });

      await tx.entryStatusLog.createMany({
        data: affectedEntries.map((entry) => ({
          entryId: entry.id,
          previous: entry.status as EntryStatus,
          next: EntryStatus.EXPIRED,
          reason: 'smt_email_declined',
        })),
      });
    }
  });
}

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
      select: { id: true, houseAddressId: true },
    });

    if (!authorization) {
      return NextResponse.json({ error: 'No SMT authorization found to confirm' }, { status: 400 });
    }

    const now = new Date();
    const houseAddressId = authorization.houseAddressId ?? null;

    if (status === 'approved') {
      const refreshResult = await refreshSmtAuthorizationStatus(authorization.id);

      if (!refreshResult.ok) {
        const message =
          refreshResult.message ??
          'Unable to reach Smart Meter Texas right now. Please try again in a moment.';
        return NextResponse.json(
          {
            ok: false,
            error: 'smt_proxy_unreachable',
            message,
          },
          { status: 503 },
        );
      }

      const refreshedAuth = refreshResult.authorization ?? null;
      const normalizedStatus = (
        refreshResult.status ??
        refreshedAuth?.smtStatus ??
        ''
      ).toUpperCase();

      const isActive = ACTIVE_STATUSES.has(normalizedStatus);

      if (!isActive) {
        if (normalizedStatus === 'DECLINED') {
          await markAuthorizationDeclined({
            authorizationId: authorization.id,
            userId: user.id,
            houseAddressId,
            message:
              refreshedAuth?.smtStatusMessage ??
              'Smart Meter Texas reported this authorization as declined.',
            occurredAt: now,
          });

          await refreshUserEntryStatuses(user.id);

          return NextResponse.json(
            {
              ok: false,
              error: 'smt_declined',
              message:
                'Smart Meter Texas shows this authorization as declined. Please start the authorization process again.',
            },
            { status: 409 },
          );
        }

        return NextResponse.json(
          {
            ok: false,
            error: 'smt_not_active',
            message:
              'Smart Meter Texas still shows this authorization as pending. Approve the SMT email and try again.',
          },
          { status: 409 },
        );
      }

      const smtStatusMessage =
        refreshedAuth?.smtStatusMessage ??
        'Customer confirmed SMT authorization email';

      await prisma.$transaction(async (tx) => {
        const txAny = tx as any;

        await txAny.smtAuthorization.update({
          where: { id: authorization.id },
          data: {
            emailConfirmationStatus: 'APPROVED',
            emailConfirmationAt: now,
            smtStatus: refreshedAuth?.smtStatus ?? 'ACTIVE',
            smtStatusMessage,
          },
        });

        await ensureSmartMeterEntry(user.id, houseAddressId, now);

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

    await markAuthorizationDeclined({
      authorizationId: authorization.id,
      userId: user.id,
      houseAddressId,
      message: 'Customer declined SMT authorization email',
      occurredAt: now,
    });

    await refreshUserEntryStatuses(user.id);

    return NextResponse.json({ ok: true, status: 'declined' });
  } catch (error) {
    console.error('[user/smt/email-confirmation] Failed to update status', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
