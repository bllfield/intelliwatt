import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/db';

export const dynamic = 'force-dynamic';

export async function GET(_req: NextRequest) {
  try {
    const revocations = await prisma.smtAuthorization.findMany({
      where: {
        revokedReason: 'customer_requested',
      },
      orderBy: {
        archivedAt: 'desc',
      },
      select: {
        id: true,
        esiid: true,
        meterNumber: true,
        archivedAt: true,
        smtStatusMessage: true,
        user: {
          select: {
            email: true,
          },
        },
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

    const formatted = revocations.map((record) => ({
      id: record.id,
      email: record.user?.email ?? null,
      esiid: record.esiid,
      meterNumber: record.meterNumber ?? null,
      archivedAt: record.archivedAt?.toISOString() ?? null,
      smtStatusMessage: record.smtStatusMessage ?? null,
      house: {
        addressLine1: record.houseAddress.addressLine1,
        addressLine2: record.houseAddress.addressLine2,
        addressCity: record.houseAddress.addressCity,
        addressState: record.houseAddress.addressState,
        addressZip5: record.houseAddress.addressZip5,
      },
    }));

    return NextResponse.json(formatted);
  } catch (error) {
    console.error('[admin/smt/revocations] Failed to load SMT revocation queue', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}


