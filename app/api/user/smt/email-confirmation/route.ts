import { NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import { EntryStatus } from '@prisma/client';

import { prisma } from '@/lib/db';
import { normalizeEmail } from '@/lib/utils/email';
import { qualifyReferralsForUser } from '@/lib/referral/qualify';
import { refreshUserEntryStatuses } from '@/lib/hitthejackwatt/entryLifecycle';
import { getRollingBackfillRange, refreshSmtAuthorizationStatus, requestSmtBackfillForAuthorization } from '@/lib/smt/agreements';
import { pickBestSmtAuthorization } from '@/lib/smt/authorizationSelection';
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

    const candidateAuthorizations = await prisma.smtAuthorization.findMany({
      where: {
        userId: user.id,
        archivedAt: null,
      },
      orderBy: {
        createdAt: 'desc',
      },
      take: 25,
      select: { id: true, houseAddressId: true, smtStatus: true, smtStatusMessage: true, createdAt: true },
    });
    const allAuthorizations = await prisma.smtAuthorization.findMany({
      where: { userId: user.id },
      orderBy: { createdAt: 'desc' },
      take: 100,
      select: { id: true },
    });
    const authorization = pickBestSmtAuthorization(candidateAuthorizations);

    if (!authorization) {
      return NextResponse.json({ error: 'No SMT authorization found to confirm' }, { status: 400 });
    }

    const now = new Date();
    const houseAddressId = authorization.houseAddressId ?? null;
    const refreshCandidateIds = Array.from(
      new Set([authorization.id, ...candidateAuthorizations.map((a) => String(a.id)), ...allAuthorizations.map((a) => String(a.id))]),
    );

    if (status === 'approved') {
      // User explicitly confirmed approval; bypass cooldown so we do a real SMT check now.
      // Try all candidate local authorizations for this user in case one row is stale/pending
      // while another row already maps to an ACTIVE SMT agreement.
      let refreshResult: any = null;
      let sawNetworkError = false;
      for (const candidateId of refreshCandidateIds) {
        const res = await refreshSmtAuthorizationStatus(candidateId, { force: true });
        if (!res.ok) {
          if (res.reason === 'network-error') sawNetworkError = true;
          continue;
        }
        refreshResult = res;
        const statusNow = String(res.status ?? (res as any)?.authorization?.smtStatus ?? '').toUpperCase();
        if (ACTIVE_STATUSES.has(statusNow)) break;
      }

      if (!refreshResult?.ok) {
        const message = sawNetworkError
          ? 'Unable to reach Smart Meter Texas right now. Please try again in a moment.'
          : 'Unable to verify Smart Meter Texas agreement status right now. Please try again in a moment.';
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
      const resolvedAuthorizationId = String(refreshResult.authorization?.id ?? authorization.id);
      const resolvedAuthorization = await prisma.smtAuthorization.findUnique({
        where: { id: resolvedAuthorizationId },
        select: { id: true, houseAddressId: true, smtStatus: true, smtStatusMessage: true },
      });
      const resolvedHouseAddressId = resolvedAuthorization?.houseAddressId ?? houseAddressId;

      if (!isActive) {
        if (normalizedStatus === 'DECLINED') {
          await markAuthorizationDeclined({
            authorizationId: resolvedAuthorizationId,
            userId: user.id,
            houseAddressId: resolvedHouseAddressId,
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
          where: { id: resolvedAuthorizationId },
          data: {
            emailConfirmationStatus: 'APPROVED',
            emailConfirmationAt: now,
            smtStatus: refreshedAuth?.smtStatus ?? 'ACTIVE',
            smtStatusMessage,
          },
        });

        await ensureSmartMeterEntry(user.id, resolvedHouseAddressId, now);

        await tx.userProfile.updateMany({
          where: { userId: user.id },
          data: {
            esiidAttentionRequired: false,
            esiidAttentionCode: null,
            esiidAttentionAt: null,
          },
        });
      });

      // Trigger rolling 12-month backfill after SMT email approval, if possible.
      // IMPORTANT: SMT guidance is a 365-day window ending "yesterday" (not "now").
      try {
        const latestAuth = await prisma.smtAuthorization.findUnique({
          where: { id: resolvedAuthorizationId },
          select: {
            id: true,
            esiid: true,
            meterNumber: true,
            smtBackfillRequestedAt: true,
          },
        });

        // Avoid duplicate backfill requests.
        if (latestAuth?.esiid && !latestAuth.smtBackfillRequestedAt) {
          const range = getRollingBackfillRange(12);
          const res = await requestSmtBackfillForAuthorization({
            authorizationId: latestAuth.id,
            esiid: latestAuth.esiid,
            meterNumber: latestAuth.meterNumber,
            startDate: range.startDate,
            endDate: range.endDate,
          });

          if (res.ok) {
            await prisma.smtAuthorization.update({
              where: { id: latestAuth.id },
              data: { smtBackfillRequestedAt: new Date() },
            });
          }
        }
      } catch (error) {
        console.error('[user/smt/email-confirmation] Failed to request SMT backfill', error);
      }

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
