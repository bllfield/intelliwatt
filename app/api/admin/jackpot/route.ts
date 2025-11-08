import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import { requireAdmin } from '@/lib/auth/admin';

export const runtime = 'nodejs';

export async function GET(req: NextRequest) {
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