import { NextRequest, NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import { db } from '@/lib/db';
import { generateReferralToken } from '@/lib/referral/verify';
import { normalizeEmail } from '@/lib/utils/email';

export const dynamic = 'force-dynamic';

// GET - Get or create user's referral link
export async function GET(request: NextRequest) {
  try {
    const cookieStore = cookies();
    const userEmailRaw = cookieStore.get('intelliwatt_user')?.value;

    if (!userEmailRaw) {
      return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });
    }

    const userEmail = normalizeEmail(userEmailRaw);

    const user = await db.user.findUnique({
      where: { email: userEmail },
    });

    if (!user) {
      return NextResponse.json({ error: 'User not found' }, { status: 404 });
    }

    const token = generateReferralToken(user.id);
    const baseUrl = process.env.NEXT_PUBLIC_BASE_URL || 'https://intelliwatt.com';
    const referralLink = `${baseUrl}/join?ref=${token}&utm_source=referral`;

    const vanityCode = user.id.substring(0, 6).toUpperCase();

    return NextResponse.json({
      referralLink,
      token,
      vanityCode,
      message: 'Share this link to earn 1 entry per friend who signs up!',
    });
  } catch (error) {
    console.error('Error generating referral link:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}

