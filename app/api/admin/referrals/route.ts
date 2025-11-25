import { NextResponse } from 'next/server';
import { prisma } from '@/lib/db';

export const dynamic = 'force-dynamic';

export async function GET() {
  try {
    const prismaAny = prisma as any;
    const referrals = await prismaAny.referral.findMany({
      orderBy: { createdAt: 'desc' },
      include: {
        referredBy: {
          select: {
            id: true,
            email: true,
          },
        },
        referredUser: {
          select: {
            id: true,
            email: true,
          },
        },
        entry: {
          select: {
            id: true,
            createdAt: true,
          },
        },
      },
    });

    return NextResponse.json(
      referrals.map((referral: any) => ({
        id: referral.id,
        status: referral.status,
        referredEmail: referral.referredEmail,
        createdAt: referral.createdAt.toISOString(),
        qualifiedAt: referral.qualifiedAt ? referral.qualifiedAt.toISOString() : null,
        entryAwardedAt: referral.entryAwardedAt ? referral.entryAwardedAt.toISOString() : null,
        referredBy: {
          id: referral.referredBy.id,
          email: referral.referredBy.email,
        },
        referredUser: referral.referredUser
          ? {
              id: referral.referredUser.id,
              email: referral.referredUser.email,
            }
          : null,
        entry: referral.entry
          ? {
              id: referral.entry.id,
              createdAt: referral.entry.createdAt.toISOString(),
            }
          : null,
      })),
    );
  } catch (error) {
    console.error('Error fetching referrals:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}

