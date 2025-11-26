import { NextResponse } from 'next/server';
import { prisma } from '@/lib/db';

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

    const mapped = authorizations.map((auth) => ({
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
