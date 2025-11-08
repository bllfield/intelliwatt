import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import { requireAdmin } from '@/lib/auth/admin';

export const runtime = 'nodejs';

export async function GET(req: NextRequest) {
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

    return NextResponse.json(users);
  } catch (error) {
    console.error('Error fetching users:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
} 