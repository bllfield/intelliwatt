import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import { requireAdmin } from '@/lib/auth/admin';

export const runtime = 'nodejs';

export async function GET(req: NextRequest) {
  try {
    const financeRecords = await prisma.financeRecord.findMany({
      orderBy: {
        createdAt: 'desc',
      },
    });

    return NextResponse.json(financeRecords);
  } catch (error) {
    console.error('Error fetching finance records:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
} 