import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/db';

export const dynamic = 'force-dynamic';

export async function GET(request: NextRequest) {
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