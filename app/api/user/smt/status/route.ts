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

    const authorization = await prisma.smtAuthorization.findFirst({
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

    return NextResponse.json({
      connected: true,
      authorization: {
        id: authorization.id,
        esiid: authorization.esiid,
        meterNumber: authorization.meterNumber,
        authorizationStartDate: authorization.authorizationStartDate?.toISOString() ?? null,
        authorizationEndDate: authorization.authorizationEndDate?.toISOString() ?? null,
        tdspName: authorization.tdspName ?? null,
        houseAddress: {
          line1: authorization.houseAddress.addressLine1,
          line2: authorization.houseAddress.addressLine2,
          city: authorization.houseAddress.addressCity,
          state: authorization.houseAddress.addressState,
          zip5: authorization.houseAddress.addressZip5,
        },
      },
    });
  } catch (error) {
    console.error('[user/smt/status] Failed to load authorization status', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}


