import { NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import { prisma } from '@/lib/db';
import { pickBestSmtAuthorization } from '@/lib/smt/authorizationSelection';
import { refreshSmtAuthorizationStatus } from '@/lib/smt/agreements';
import { normalizeEmail } from '@/lib/utils/email';

export const dynamic = 'force-dynamic';

export async function GET() {
  try {
    const cookieStore = cookies();
    const rawEmail = cookieStore.get('intelliwatt_user')?.value;

    if (!rawEmail) {
      return NextResponse.json({ connected: false }, { status: 401 });
    }

    const email = normalizeEmail(rawEmail);
    const user = await prisma.user.findUnique({
      where: { email },
      select: { id: true },
    });

    if (!user) {
      return NextResponse.json({ connected: false }, { status: 404 });
    }

    const prismaAny = prisma as any;

    // IMPORTANT:
    // Scope SMT status to the active house (primary if set, else most recent) so multi-home users
    // and helpdesk impersonation see the correct ESIID in-session.
    const activeHouse =
      (await prismaAny.houseAddress.findFirst({
        where: { userId: user.id, archivedAt: null, isPrimary: true },
        orderBy: { createdAt: 'desc' },
        select: { id: true, esiid: true },
      })) ??
      (await prismaAny.houseAddress.findFirst({
        where: { userId: user.id, archivedAt: null },
        orderBy: { createdAt: 'desc' },
        select: { id: true, esiid: true },
      }));

    if (!activeHouse) {
      return NextResponse.json({ connected: false });
    }

    const authorizationCandidates = await prismaAny.smtAuthorization.findMany({
      where: {
        userId: user.id,
        archivedAt: null,
        OR: [{ houseAddressId: activeHouse.id }, { houseId: activeHouse.id }],
      },
      orderBy: { createdAt: 'desc' },
      take: 25,
      select: {
        id: true,
        esiid: true,
        meterNumber: true,
        authorizationStartDate: true,
        authorizationEndDate: true,
        tdspName: true,
        smtStatus: true,
        smtStatusMessage: true,
        smtLastSyncAt: true,
        emailConfirmationStatus: true,
        emailConfirmationAt: true,
        houseAddress: {
          select: {
            addressLine1: true,
            addressLine2: true,
            addressCity: true,
            addressState: true,
            addressZip5: true,
            esiid: true,
          },
        },
      },
    });
    const authorization = pickBestSmtAuthorization(authorizationCandidates as any[]);

    if (!authorization) {
      return NextResponse.json({ connected: false });
    }

    // If we already know SMT is ACTIVE, but the confirmation flag is still pending/declined,
    // normalize it so the UI/admin dashboard does not keep showing "needs approval".
    const smtStatusNorm = String(authorization.smtStatus ?? '').trim().toUpperCase();
    const isActive = smtStatusNorm === 'ACTIVE' || smtStatusNorm === 'ALREADY_ACTIVE';
    const emailNorm = String(authorization.emailConfirmationStatus ?? '').trim().toUpperCase();
    const needsFlagFix = isActive && emailNorm !== 'APPROVED';

    // Also: if status looks pending and it’s stale, do a best-effort refresh (cooldown enforced in lib).
    const isMaybePending = !smtStatusNorm || smtStatusNorm === 'PENDING';
    const lastSyncAt = authorization.smtLastSyncAt ? new Date(authorization.smtLastSyncAt) : null;
    const staleMs = 2 * 60 * 1000;
    const isStale = !lastSyncAt || Date.now() - lastSyncAt.getTime() > staleMs;

    if (needsFlagFix || (isMaybePending && isStale)) {
      try {
        await refreshSmtAuthorizationStatus(authorization.id);
        const refreshed = await prismaAny.smtAuthorization.findUnique({
          where: { id: authorization.id },
          select: {
            id: true,
            esiid: true,
            meterNumber: true,
            authorizationStartDate: true,
            authorizationEndDate: true,
            tdspName: true,
            smtStatus: true,
            smtStatusMessage: true,
            smtLastSyncAt: true,
            emailConfirmationStatus: true,
            emailConfirmationAt: true,
            houseAddress: {
              select: {
                addressLine1: true,
                addressLine2: true,
                addressCity: true,
                addressState: true,
                addressZip5: true,
              },
            },
          },
        });
        if (refreshed) {
          authorization.smtStatus = refreshed.smtStatus;
          authorization.smtStatusMessage = refreshed.smtStatusMessage;
          authorization.smtLastSyncAt = refreshed.smtLastSyncAt;
          authorization.emailConfirmationStatus = refreshed.emailConfirmationStatus;
          authorization.emailConfirmationAt = refreshed.emailConfirmationAt;
        }
      } catch {
        // ignore; UI will still show current DB values
      }
    }

    const address = authorization.houseAddress ?? null;

    // Keep precedence consistent with /api/user/smt/orchestrate:
    // prefer the ESIID the customer actually authorized (authorization row), then fall back to
    // the active house ESIID (and finally the joined address ESIID if present).
    const authEsiid = String(authorization.esiid ?? "").trim();
    const houseEsiid = String(activeHouse.esiid ?? "").trim();
    const addressEsiid = String(address?.esiid ?? "").trim();
    const effectiveEsiid = (authEsiid || houseEsiid || addressEsiid) || null;

    return NextResponse.json({
      connected: true,
      authorization: {
        id: authorization.id,
        esiid: effectiveEsiid,
        meterNumber: authorization.meterNumber,
        authorizationStartDate: authorization.authorizationStartDate?.toISOString() ?? null,
        authorizationEndDate: authorization.authorizationEndDate?.toISOString() ?? null,
        tdspName: authorization.tdspName ?? null,
        smtStatus: authorization.smtStatus ?? null,
        smtStatusMessage: authorization.smtStatusMessage ?? null,
        emailConfirmationStatus: authorization.emailConfirmationStatus,
        emailConfirmationAt: authorization.emailConfirmationAt?.toISOString() ?? null,
        houseAddress: address
          ? {
              line1: address.addressLine1,
              line2: address.addressLine2,
              city: address.addressCity,
              state: address.addressState,
              zip5: address.addressZip5,
            }
          : null,
      },
    });
  } catch (error) {
    console.error('[user/smt/status] Failed to load authorization status', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}

