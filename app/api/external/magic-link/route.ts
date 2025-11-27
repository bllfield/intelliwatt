import { NextRequest, NextResponse } from 'next/server';
import { createMagicToken, storeToken } from '@/lib/magic/magic-token';
import { sendLoginEmail } from '@/lib/email/sendLoginEmail';
import { normalizeEmail } from '@/lib/utils/email';
import { REFERRAL_QUERY_PARAM } from '@/lib/referral';

export const dynamic = 'force-dynamic';

export async function POST(request: NextRequest) {
  try {
    const { email, zip, source = 'external', referralToken } = await request.json();

    if (!email || !email.includes('@')) {
      return NextResponse.json({ error: 'Valid email is required' }, { status: 400 });
    }

    // Normalize email to lowercase for consistent storage
    const normalizedEmail = normalizeEmail(email);

    // Create and store the magic token
    let token: string;
    let magicLink: string;
    
    try {
      token = await createMagicToken(normalizedEmail);
      await storeToken(normalizedEmail, token, referralToken);
      
      // Create the magic link URL - always redirect to dashboard
      const baseUrl =
        process.env.NEXT_PUBLIC_BASE_URL ||
        (process.env.VERCEL_URL ? `https://${process.env.VERCEL_URL}` : 'https://intelliwatt.com');
      const magicUrl = new URL('/login/magic', baseUrl);
      magicUrl.searchParams.set('token', token);
      if (typeof referralToken === 'string' && referralToken.trim().length > 0) {
        magicUrl.searchParams.set(REFERRAL_QUERY_PARAM, referralToken.trim());
      }
      magicLink = magicUrl.toString();
    } catch (dbError) {
      console.error('Database error:', dbError);
      // If database is not available, create a temporary token for testing
      token = `temp_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
      const baseUrl =
        process.env.NEXT_PUBLIC_BASE_URL ||
        (process.env.VERCEL_URL ? `https://${process.env.VERCEL_URL}` : 'https://intelliwatt.com');
      const magicUrl = new URL('/login/magic', baseUrl);
      magicUrl.searchParams.set('token', token);
      if (typeof referralToken === 'string' && referralToken.trim().length > 0) {
        magicUrl.searchParams.set(REFERRAL_QUERY_PARAM, referralToken.trim());
      }
      magicLink = magicUrl.toString();
      console.log('Using temporary token due to database unavailability');
    }

    // Log the magic link for testing
    console.log('=== EXTERNAL MAGIC LINK FOR TESTING ===');
    console.log(`Email: ${normalizedEmail}`);
    console.log(`Zip: ${zip || 'not provided'}`);
    console.log(`Source: ${source}`);
    console.log(`Referral Token: ${referralToken || 'not provided'}`);
    console.log(`Magic Link: ${magicLink}`);
    console.log('========================================');

    // Try to send email with custom subject for HitTheJackWatt
    try {
      const emailSubject = source === 'hitthejackwatt' 
        ? 'Your HitTheJackWatt Magic Link' 
        : 'Welcome to IntelliWatt - Access Your Dashboard';
      
      await sendLoginEmail(normalizedEmail, magicLink, emailSubject);
      console.log('External magic link email sent successfully');
    } catch (emailError) {
      console.error('Email sending failed:', emailError);
      // Don't fail the request if email fails - we still log the link
    }

    const response = NextResponse.json({ 
      success: true, 
      message: 'Magic link sent! Please check your email inbox.',
      magicLink: magicLink // Return the link for testing purposes
    });

    // Add CORS headers for HitTheJackWatt domains
    const origin = request.headers.get('origin');
    if (origin === 'https://bllfield.github.io' || origin === 'https://hitthejackwatt.com' || origin === 'https://www.hitthejackwatt.com') {
      response.headers.set('Access-Control-Allow-Origin', origin);
    }
    response.headers.set('Access-Control-Allow-Methods', 'POST, OPTIONS');
    response.headers.set('Access-Control-Allow-Headers', 'Content-Type');

    return response;
  } catch (error) {
    console.error('Error sending external magic link:', error);
    return NextResponse.json(
      { error: 'Failed to send magic link. Please try again.' },
      { status: 500 }
    );
  }
}

// Handle CORS preflight requests
export async function OPTIONS(request: NextRequest) {
  const origin = request.headers.get('origin');
  const response = new NextResponse(null, { status: 200 });
  
  if (origin === 'https://bllfield.github.io' || origin === 'https://hitthejackwatt.com' || origin === 'https://www.hitthejackwatt.com') {
    response.headers.set('Access-Control-Allow-Origin', origin);
  }
  response.headers.set('Access-Control-Allow-Methods', 'POST, OPTIONS');
  response.headers.set('Access-Control-Allow-Headers', 'Content-Type');
  return response;
}
