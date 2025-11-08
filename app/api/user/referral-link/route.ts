import { NextRequest, NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import { db } from '@/lib/db';
import crypto from 'crypto';

export const dynamic = 'force-dynamic';

// Generate a signed referral token
function generateReferralToken(userId: string, campaignId?: string): string {
  const secret = process.env.REFERRAL_SECRET || 'default-secret-change-in-production';
  const payload = {
    userId,
    campaignId: campaignId || 'default',
    issuedAt: Date.now(),
  };
  
  const data = JSON.stringify(payload);
  const signature = crypto
    .createHmac('sha256', secret)
    .update(data)
    .digest('hex');
  
  const token = Buffer.from(`${data}:${signature}`).toString('base64url');
  return token;
}

// Verify and decode a referral token
function verifyReferralToken(token: string): { userId: string; campaignId: string; issuedAt: number } | null {
  try {
    const secret = process.env.REFERRAL_SECRET || 'default-secret-change-in-production';
    const decoded = Buffer.from(token, 'base64url').toString('utf-8');
    const [data, signature] = decoded.split(':');
    
    if (!data || !signature) return null;
    
    const expectedSignature = crypto
      .createHmac('sha256', secret)
      .update(data)
      .digest('hex');
    
    if (signature !== expectedSignature) return null;
    
    const payload = JSON.parse(data);
    
    // Check expiry (90 days)
    const maxAge = 90 * 24 * 60 * 60 * 1000; // 90 days in ms
    if (Date.now() - payload.issuedAt > maxAge) return null;
    
    return payload;
  } catch (error) {
    return null;
  }
}

// GET - Get or create user's referral link
export async function GET(request: NextRequest) {
  try {
    const cookieStore = cookies();
    const userEmail = cookieStore.get('intelliwatt_user')?.value;
    
    if (!userEmail) {
      return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });
    }

    const user = await db.user.findUnique({
      where: { email: userEmail },
    });

    if (!user) {
      return NextResponse.json({ error: 'User not found' }, { status: 404 });
    }

    // Generate referral token
    const token = generateReferralToken(user.id);
    const baseUrl = process.env.NEXT_PUBLIC_BASE_URL || 'https://intelliwatt.com';
    const referralLink = `${baseUrl}/join?ref=${token}&utm_source=referral`;

    // Generate vanity code (first 6 chars of user ID, uppercase)
    const vanityCode = user.id.substring(0, 6).toUpperCase();

    return NextResponse.json({
      referralLink,
      token,
      vanityCode,
      message: 'Share this link to earn 5 entries per friend who signs up!',
    });
  } catch (error) {
    console.error('Error generating referral link:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}

