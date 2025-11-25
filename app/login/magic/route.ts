import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import { NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { verifyReferralToken } from '@/lib/referral/verify';
import { normalizeEmail } from '@/lib/utils/email';

export const dynamic = 'force-dynamic';

export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  const token = searchParams.get('token');
  const referralTokenFromQuery = searchParams.get('ref');

  if (!token) {
    return new Response('Missing token', { status: 400 });
  }

  // Handle temporary tokens (when database is not available)
  if (token.startsWith('temp_')) {
    console.log('Temporary token used - database not available');
    // For temporary tokens, create a basic user session
    const cookieStore = cookies();
    
    // Set login cookie with a placeholder email
    cookieStore.set({
      name: 'intelliwatt_user',
      value: 'temp_user@intelliwatt.com',
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'lax',
      path: '/',
      maxAge: 60 * 60 * 24 * 7,
    });

    return NextResponse.redirect(new URL('/dashboard', req.url));
  }

  // Handle real tokens from database
  try {
    const record = await db.magicLinkToken.findUnique({
      where: { token },
    });

    if (!record || record.used || new Date() > record.expiresAt) {
      return new Response('Invalid or expired token', { status: 401 });
    }

    const cookieStore = cookies();
    const cookieReferralToken = cookieStore.get('intelliwatt_referrer')?.value;
    const referrerToken =
      (typeof referralTokenFromQuery === 'string' && referralTokenFromQuery.trim().length > 0
        ? referralTokenFromQuery.trim()
        : null) ||
      cookieReferralToken ||
      null;

    // Normalize email to lowercase for consistent storage and lookup
    const normalizedEmail = normalizeEmail(record.email);

    // Find user (or create if new)
    let user = await db.user.findUnique({
      where: { email: normalizedEmail },
    });

    const isNewUser = !user;

    if (!user) {
      user = await db.user.create({
        data: {
          email: normalizedEmail,
        },
      });
    }

    // Process referral if token exists and user is new
    if (referrerToken && isNewUser) {
      const referralData = verifyReferralToken(referrerToken);

      if (referralData && referralData.userId !== user.id) {
        const prismaAny = db as any;
        const existingReferral = await prismaAny.referral.findFirst({
          where: {
            referredById: referralData.userId,
            referredEmail: normalizedEmail,
          },
        });

        if (existingReferral) {
          await prismaAny.referral.update({
            where: { id: existingReferral.id },
            data: {
              referredUserId: user.id,
              status:
                existingReferral.status === 'QUALIFIED'
                  ? existingReferral.status
                  : 'PENDING',
            },
          });
        } else {
          await prismaAny.referral.create({
            data: {
              referredById: referralData.userId,
              referredEmail: normalizedEmail,
              referredUserId: user.id,
              status: 'PENDING',
            },
          });
        }
      }
    }

    // Mark token as used
    await db.magicLinkToken.update({
      where: { token },
      data: { used: true },
    });

    // Set login cookie (use normalized email)
    cookieStore.set({
      name: 'intelliwatt_user',
      value: normalizedEmail,
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'lax',
      path: '/',
      maxAge: 60 * 60 * 24 * 7,
    });

    // Clear referrer cookie after use
    cookieStore.set({
      name: 'intelliwatt_referrer',
      value: '',
      expires: new Date(0),
      path: '/',
    });

    // Use NextResponse.redirect instead of redirect() to avoid NEXT_REDIRECT error
    return NextResponse.redirect(new URL('/dashboard', req.url));
  } catch (dbError) {
    console.error('Database error in magic link login:', dbError);
    return new Response('Database error - please try again', { status: 500 });
  }
} 