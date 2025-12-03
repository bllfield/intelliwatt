import { NextRequest, NextResponse } from 'next/server';
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

export const dynamic = 'force-dynamic';

export async function GET(request: NextRequest) {
  try {
    const users = await prisma.user.findMany({
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
      ? await prisma.houseAddress.findMany({
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