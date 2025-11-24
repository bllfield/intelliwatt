import { NextRequest, NextResponse } from 'next/server';
import { createMagicToken, storeToken } from '@/lib/magic/magic-token';
import { sendLoginEmail } from '@/lib/email/sendLoginEmail';
import { normalizeEmail } from '@/lib/utils/email';

export const dynamic = 'force-dynamic';

export async function POST(request: NextRequest) {
  try {
    const payload = await request.json();
    const email = payload?.email;
    const referralCode =
      typeof payload?.referralCode === "string" && payload.referralCode.trim().length > 0
        ? payload.referralCode.trim()
        : undefined;

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
      await storeToken(normalizedEmail, token);
      
      // Create the magic link URL
      const baseUrl = process.env.NEXT_PUBLIC_BASE_URL || (process.env.VERCEL_URL ? `https://${process.env.VERCEL_URL}` : 'https://intelliwatt.com');
      const referralQuery = referralCode ? `&ref=${encodeURIComponent(referralCode)}` : '';
      magicLink = `${baseUrl}/login/magic?token=${token}${referralQuery}`;
    } catch (dbError) {
      console.error('Database error:', dbError);
      // If database is not available, create a temporary token for testing
      token = `temp_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
      const baseUrl = process.env.NEXT_PUBLIC_BASE_URL || (process.env.VERCEL_URL ? `https://${process.env.VERCEL_URL}` : 'https://intelliwatt.com');
      const referralQuery = referralCode ? `&ref=${encodeURIComponent(referralCode)}` : '';
      magicLink = `${baseUrl}/login/magic?token=${token}${referralQuery}`;
      console.log('Using temporary token due to database unavailability');
    }

    // Log the magic link for testing
    console.log('=== MAGIC LINK FOR TESTING ===');
    console.log(`Email: ${normalizedEmail}`);
    console.log(`Magic Link: ${magicLink}`);
    console.log('==============================');

    // Try to send email (use original email for display, but normalized for storage)
    try {
      await sendLoginEmail(normalizedEmail, magicLink);
      console.log('Magic link email sent successfully');
    } catch (emailError) {
      console.error('Email sending failed:', emailError);
      // Don't fail the request if email fails - we still log the link
    }

    return NextResponse.json({ 
      success: true, 
      message: 'Magic link sent! Please check your email inbox.' 
    });
  } catch (error) {
    console.error('Error sending magic link:', error);
    return NextResponse.json(
      { error: 'Failed to send magic link. Please try again.' },
      { status: 500 }
    );
  }
} 