import { NextResponse } from 'next/server';
import { prisma } from '@/lib/db';

export const dynamic = 'force-dynamic';

export async function GET() {
  try {
    const now = new Date();
    const prismaAny = prisma as any;

    const [
      totalUsers,
      activeSmtAuthorizations,
      activeManualUploads,
      activeHouseCount,
      applianceCount,
      smtUserResults,
      manualUserResults,
    ] = await Promise.all([
      prisma.user.count(),
      prisma.smtAuthorization.count({
        where: { archivedAt: null },
      }),
      prismaAny.manualUsageUpload.count({
        where: { expiresAt: { gte: now } },
      }),
      prisma.houseAddress.count({
        where: { archivedAt: null },
      }),
      prismaAny.appliance.count(),
      prisma.smtAuthorization.findMany({
        where: { archivedAt: null },
        select: { userId: true },
        distinct: ['userId'],
      }),
      prismaAny.manualUsageUpload.findMany({
        where: { expiresAt: { gte: now } },
        select: { userId: true },
        distinct: ['userId'],
      }),
    ]);

    const usageUserSet = new Set<string>();
    for (const record of smtUserResults) {
      usageUserSet.add(record.userId);
    }
    for (const record of manualUserResults) {
      usageUserSet.add(record.userId);
    }

    return NextResponse.json({
      totalUsers,
      activeSmtAuthorizations,
      activeManualUploads,
      activeHouseCount,
      applianceCount,
      totalUsageCustomers: usageUserSet.size,
    });
  } catch (error) {
    console.error('Error fetching admin summary stats:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}


