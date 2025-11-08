import { NextRequest, NextResponse } from 'next/server';
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

export const dynamic = 'force-dynamic';

export async function GET(request: NextRequest) {
  try {
    const jackpotPayouts = await prisma.jackpotPayout.findMany({
      include: {
        user: true,
      },
      orderBy: {
        createdAt: 'desc',
      },
    });

    return NextResponse.json(jackpotPayouts);
  } catch (error) {
    console.error('Error fetching jackpot payouts:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
} 