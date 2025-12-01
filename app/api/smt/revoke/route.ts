import { NextRequest, NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import { prisma } from '@/lib/db';
import { normalizeEmail } from '@/lib/utils/email';
import { refreshUserEntryStatuses } from '@/lib/hitthejackwatt/entryLifecycle';
import { terminateSmtAgreement } from '@/lib/smt/agreements';

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
        houseId: true,
        houseAddressId: true,
        esiid: true,
        contactEmail: true,
        smtAgreementId: true,
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

    const retailEmail =
      authorization.contactEmail && authorization.contactEmail.trim().length > 0
        ? authorization.contactEmail.trim()
        : userEmail;

    if (authorization.smtAgreementId && retailEmail) {
      try {
        await terminateSmtAgreement(
          authorization.smtAgreementId,
          retailEmail,
        );
      } catch (terminateError) {
        console.error(
          '[smt/revoke] Failed to terminate SMT agreement via proxy',
          terminateError,
        );
        return NextResponse.json(
          {
            error:
              'We could not reach Smart Meter Texas to terminate the data sharing agreement. Please try again or contact support.',
          },
          { status: 502 },
        );
      }
    }

    const archivedAuthorization = await prisma.smtAuthorization.update({
      where: { id: authorization.id },
      data: {
        archivedAt: now,
        smtStatus: 'archived',
        smtStatusMessage: 'Customer requested revocation',
        revokedReason: 'customer_requested',
      },
      select: {
        id: true,
        houseId: true,
        houseAddressId: true,
        esiid: true,
        meterNumber: true,
        authorizationEndDate: true,
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

    const houseConditions: Array<{ houseId: string | null }> = [];
    const candidateHouseIds = new Set<string | null>();

    if (archivedAuthorization?.houseId) {
      candidateHouseIds.add(archivedAuthorization.houseId);
    }
    if (archivedAuthorization?.houseAddressId) {
      candidateHouseIds.add(archivedAuthorization.houseAddressId);
    }
    if (candidateHouseIds.size === 0) {
      candidateHouseIds.add(null);
    }

    candidateHouseIds.forEach((value) => {
      houseConditions.push({ houseId: value });
    });

    let entriesToDelete = await prisma.entry.findMany({
      where: {
        userId: user.id,
        type: 'smart_meter_connect',
        OR: houseConditions,
      },
      select: { id: true },
    });

    if (entriesToDelete.length === 0) {
      entriesToDelete = await prisma.entry.findMany({
        where: {
          userId: user.id,
          type: 'smart_meter_connect',
          houseId: null,
        },
        select: { id: true },
      });
    }

    if (entriesToDelete.length > 0) {
      const entryIds = entriesToDelete.map((entry) => entry.id);

      await prisma.$transaction([
        prisma.entryStatusLog.deleteMany({
          where: {
            entryId: {
              in: entryIds,
            },
          },
        }),
        prisma.entry.deleteMany({
          where: {
            id: {
              in: entryIds,
            },
          },
        }),
      ]);
    }

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


