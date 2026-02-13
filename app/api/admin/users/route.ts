import { NextRequest, NextResponse } from 'next/server';
import { requireAdmin } from '@/lib/auth/admin';
import { db } from '@/lib/db';

export const dynamic = 'force-dynamic';

export async function GET(request: NextRequest) {
  try {
    const gate = requireAdmin(request);
    if (!gate.ok) return NextResponse.json(gate.body, { status: gate.status });

    const users = await db.user.findMany({
      include: {
        entries: true,
        referrals: true,
        profile: true,
      },
      orderBy: {
        createdAt: 'desc',
      },
    });

    const userIds = users.map((user) => user.id);

    const houses = userIds.length
      ? await db.houseAddress.findMany({
          where: {
            userId: { in: userIds },
          },
          select: {
            id: true,
            userId: true,
            archivedAt: true,
            addressLine1: true,
          },
          orderBy: {
            createdAt: 'asc',
          },
        })
      : [];

    type HouseSummary = (typeof houses)[number];

    const housesByUser = houses.reduce<Record<string, HouseSummary[]>>((acc, house) => {
      if (!acc[house.userId]) {
        acc[house.userId] = [];
      }
      acc[house.userId].push(house);
      return acc;
    }, {});

    const payload = users.map((user) => ({
      ...user,
      houseAddresses: housesByUser[user.id] ?? [],
    }));

    return NextResponse.json(payload);
  } catch (error) {
    console.error('Error fetching users:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
} 