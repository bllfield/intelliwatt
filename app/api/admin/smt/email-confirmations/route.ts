import { NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import { getRollingBackfillRange, refreshSmtAuthorizationStatus, requestSmtBackfillForAuthorization } from '@/lib/smt/agreements';

export const dynamic = 'force-dynamic';

type RawAuthorization = {
  id: string;
  userId: string;
  emailConfirmationStatus: 'PENDING' | 'DECLINED' | 'APPROVED';
  emailConfirmationAt: Date | null;
  createdAt: Date;
  authorizationEndDate: Date | null;
  smtStatus: string | null;
  smtStatusMessage: string | null;
  houseAddress: {
    addressLine1: string | null;
    addressLine2: string | null;
    addressCity: string | null;
    addressState: string | null;
    addressZip5: string | null;
  } | null;
  user: {
    email: string | null;
  } | null;
};

export async function GET() {
  try {
    const prismaAny = prisma as any;
    // Best-effort cleanup:
    // - If SMT status is ACTIVE, refreshSmtAuthorizationStatus() will auto-mark emailConfirmationStatus=APPROVED
    //   and clear attention flags so the admin dashboard doesn't show "awaiting confirmation".
    // - IMPORTANT: `smtLastSyncAt` is also used by orchestrator/pull flows, so we cannot rely on it
    //   to determine staleness for status checks. Instead, we force-refresh a small batch of older
    //   queued rows each time this endpoint is loaded.
    const now = Date.now();
    const forceMinAgeMs = 3 * 60 * 1000; // don't force-hit SMT for brand new rows
    const forceCutoff = new Date(now - forceMinAgeMs);
    const maxForceRefresh = 40;

    const candidates = (await prismaAny.smtAuthorization.findMany({
      where: {
        archivedAt: null,
        emailConfirmationStatus: { in: ['PENDING', 'DECLINED'] },
      },
      orderBy: { createdAt: 'desc' },
      take: 150,
      select: { id: true, createdAt: true },
    })) as Array<{ id: string; createdAt: Date }>;

    const forceIds = candidates
      .filter((c) => c.createdAt && c.createdAt <= forceCutoff)
      .slice(0, maxForceRefresh)
      .map((c) => String(c.id));

    if (forceIds.length > 0) {
      await Promise.all(
        forceIds.map((id) =>
          refreshSmtAuthorizationStatus(id, {
            force: true,
            triggerUsagePullIfActive: true,
          }).catch(() => null),
        ),
      );
    }

    const authorizations = (await prismaAny.smtAuthorization.findMany({
      where: {
        archivedAt: null,
        emailConfirmationStatus: {
          in: ['PENDING', 'DECLINED'],
        },
      },
      orderBy: {
        createdAt: 'desc',
      },
      select: {
        id: true,
        userId: true,
        emailConfirmationStatus: true,
        emailConfirmationAt: true,
        createdAt: true,
        authorizationEndDate: true,
        smtStatus: true,
        smtStatusMessage: true,
        houseAddress: {
          select: {
            addressLine1: true,
            addressLine2: true,
            addressCity: true,
            addressState: true,
            addressZip5: true,
          },
        },
        user: {
          select: {
            email: true,
          },
        },
      },
    })) as RawAuthorization[];

    // Filter out rows where SMT is already ACTIVE-ish (these should have been auto-approved, but keep this defensive).
    const mapped = authorizations
      .filter((auth) => {
        const st = String(auth.smtStatus ?? '').trim().toUpperCase();
        // Be liberal: older rows may have stored codes like "ACT".
        const isActiveish = st === 'ACTIVE' || st === 'ALREADY_ACTIVE' || st === 'ACT' || st.includes('ACTIVE');
        return !isActiveish;
      })
      .map((auth) => ({
      id: auth.id,
      userId: auth.userId,
      email: auth.user?.email ?? null,
      status: auth.emailConfirmationStatus,
      confirmedAt: auth.emailConfirmationAt?.toISOString() ?? null,
      createdAt: auth.createdAt.toISOString(),
      authorizationEndDate: auth.authorizationEndDate?.toISOString() ?? null,
      smtStatus: auth.smtStatus ?? null,
      smtStatusMessage: auth.smtStatusMessage ?? null,
      houseAddress: auth.houseAddress
        ? {
            addressLine1: auth.houseAddress.addressLine1 ?? '',
            addressLine2: auth.houseAddress.addressLine2 ?? null,
            addressCity: auth.houseAddress.addressCity ?? '',
            addressState: auth.houseAddress.addressState ?? '',
            addressZip5: auth.houseAddress.addressZip5 ?? '',
          }
        : null,
    }));

    return NextResponse.json({
      pending: mapped.filter((record) => record.status === 'PENDING'),
      declined: mapped.filter((record) => record.status === 'DECLINED'),
    });
  } catch (error) {
    console.error('[admin/smt/email-confirmations] Failed to load email confirmations', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}

export async function POST(req: Request) {
  try {
    const prismaAny = prisma as any;
    const body = (await req.json().catch(() => null)) as
      | { authorizationId?: string; action?: string }
      | null;

    if (!body || typeof body !== 'object' || !body.authorizationId) {
      return NextResponse.json(
        { ok: false, error: 'authorizationId is required' },
        { status: 400 },
      );
    }

    const auth = await prismaAny.smtAuthorization.findUnique({
      where: { id: body.authorizationId },
      select: {
        id: true,
        esiid: true,
        meterNumber: true,
        emailConfirmationStatus: true,
        emailConfirmationAt: true,
        smtBackfillRequestedAt: true,
      },
    });

    if (!auth) {
      return NextResponse.json(
        { ok: false, error: 'Authorization not found' },
        { status: 404 },
      );
    }

    // Only trigger backfill once the email is approved/confirmed.
    if (auth.emailConfirmationStatus !== 'APPROVED') {
      return NextResponse.json(
        {
          ok: false,
          error: 'Authorization is not approved for backfill',
          status: auth.emailConfirmationStatus,
        },
        { status: 409 },
      );
    }

    // Avoid spamming SMT with duplicate backfill requests if we've already sent one.
    if (auth.smtBackfillRequestedAt) {
      return NextResponse.json({
        ok: true,
        skipped: true,
        message: 'Backfill already requested for this authorization',
      });
    }

    const { startDate, endDate } = getRollingBackfillRange(12);

    const res = await requestSmtBackfillForAuthorization({
      authorizationId: auth.id,
      esiid: auth.esiid,
      meterNumber: auth.meterNumber,
      startDate,
      endDate,
    });

    if (res.ok) {
      await prismaAny.smtAuthorization.update({
        where: { id: auth.id },
        data: {
          smtBackfillRequestedAt: new Date(),
        },
      });
    }

    return NextResponse.json({ ok: res.ok, message: res.message });
  } catch (error) {
    console.error('[admin/smt/email-confirmations] Failed to request SMT backfill', error);
    return NextResponse.json({ ok: false, error: 'Internal server error' }, { status: 500 });
  }
}
