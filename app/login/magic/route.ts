import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import { NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { verifyReferralToken } from '@/lib/referral/verify';

export const runtime = 'nodejs';

export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  const token = searchParams.get('token');

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
      secure: true,
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
    const referrerToken = cookieStore.get('intelliwatt_referrer')?.value;

    // Find user (or create if new)
    let user = await db.user.findUnique({
      where: { email: record.email },
    });

    const isNewUser = !user;

    if (!user) {
      user = await db.user.create({
        data: {
          email: record.email,
        },
      });
    }

    // Process referral if token exists and user is new
    if (referrerToken && isNewUser) {
      const referralData = verifyReferralToken(referrerToken);
      
      if (referralData && referralData.userId !== user.id) {
        // Check if referral already exists
        const existingReferral = await db.referral.findFirst({
          where: {
            referredById: referralData.userId,
            referredEmail: user.email,
          },
        });

        if (!existingReferral) {
          // Create referral record
          await db.referral.create({
            data: {
              referredById: referralData.userId,
              referredEmail: user.email,
            },
          });

          // Award 5 entries to the referrer
          await db.entry.create({
            data: {
              userId: referralData.userId,
              type: 'referral',
              amount: 5,
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

    // Set login cookie
    cookieStore.set({
      name: 'intelliwatt_user',
      value: user.email,
      httpOnly: true,
      secure: true,
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