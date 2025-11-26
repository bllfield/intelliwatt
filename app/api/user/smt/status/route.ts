import { NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import { prisma } from '@/lib/db';
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

    const authorization = await prismaAny.smtAuthorization.findFirst({
      where: {
        userId: user.id,
        archivedAt: null,
      },
      orderBy: {
        createdAt: 'desc',
      },
      select: {
        id: true,
        esiid: true,
        meterNumber: true,
        authorizationStartDate: true,
        authorizationEndDate: true,
        tdspName: true,
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

    if (!authorization) {
      return NextResponse.json({ connected: false });
    }

    const address = authorization.houseAddress ?? null;

    return NextResponse.json({
      connected: true,
      authorization: {
        id: authorization.id,
        esiid: authorization.esiid,
        meterNumber: authorization.meterNumber,
        authorizationStartDate: authorization.authorizationStartDate?.toISOString() ?? null,
        authorizationEndDate: authorization.authorizationEndDate?.toISOString() ?? null,
        tdspName: authorization.tdspName ?? null,
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


