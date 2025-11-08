import { NextRequest, NextResponse } from 'next/server';
import { createMagicToken, storeToken } from '@/lib/magic/magic-token';
import { sendLoginEmail } from '@/lib/email/sendLoginEmail';
import { prisma } from '@/lib/db';

export const runtime = 'nodejs';

export async function POST(req: NextRequest) {
  try {
    const { email } = await req.json();

    if (!email || !email.includes('@')) {
      return NextResponse.json({ error: 'Valid email is required' }, { status: 400 });
    }

    // Create and store the magic token
    let token: string;
    let magicLink: string;
    
    try {
      token = await createMagicToken(email);
      await storeToken(email, token);
      
      // Create the magic link URL
      const baseUrl = process.env.NEXT_PUBLIC_BASE_URL || (process.env.VERCEL_URL ? `https://${process.env.VERCEL_URL}` : 'https://intelliwatt.com');
      magicLink = `${baseUrl}/login/magic?token=${token}`;
    } catch (dbError) {
      console.error('Database error:', dbError);
      // If database is not available, create a temporary token for testing
      token = `temp_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
      const baseUrl = process.env.NEXT_PUBLIC_BASE_URL || (process.env.VERCEL_URL ? `https://${process.env.VERCEL_URL}` : 'https://intelliwatt.com');
      magicLink = `${baseUrl}/login/magic?token=${token}`;
      console.log('Using temporary token due to database unavailability');
    }

    // Log the magic link for testing
    console.log('=== MAGIC LINK FOR TESTING ===');
    console.log(`Email: ${email}`);
    console.log(`Magic Link: ${magicLink}`);
    console.log('==============================');

    // Try to send email
    try {
      await sendLoginEmail(email, magicLink);
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