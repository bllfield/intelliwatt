import { NextRequest, NextResponse } from 'next/server';
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

export async function GET(request: NextRequest) {
  try {
    const commissions = await prisma.commissionRecord.findMany({
      include: {
        user: true,
      },
      orderBy: {
        createdAt: 'desc',
      },
    });

    return NextResponse.json(commissions);
  } catch (error) {
    console.error('Error fetching commissions:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
} 