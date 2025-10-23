import { NextRequest, NextResponse } from 'next/server';
import { createMagicToken, storeToken } from '@/lib/magic/magic-token';
import { sendLoginEmail } from '@/lib/email/sendLoginEmail';

export async function POST(request: NextRequest) {
  try {
    const { email } = await request.json();

    if (!email || !email.includes('@')) {
      return NextResponse.json({ error: 'Valid email is required' }, { status: 400 });
    }

    // Create and store the magic token
    const token = await createMagicToken(email);
    await storeToken(email, token);
    
    // Create the magic link URL
    const magicLink = `${process.env.NEXT_PUBLIC_BASE_URL || 'http://localhost:3000'}/login/magic?token=${token}`;

    // Log the magic link for testing
    console.log('=== MAGIC LINK FOR TESTING ===');
    console.log(`Email: ${email}`);
    console.log(`Magic Link: ${magicLink}`);
    console.log('==============================');

    // Try to send email (but don't fail if email is not configured)
    try {
      await sendLoginEmail(email, magicLink);
    } catch (emailError) {
      console.log('Email error (continuing for testing):', emailError);
    }

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error('Error sending magic link:', error);
    return NextResponse.json(
      { error: 'Failed to send magic link' },
      { status: 500 }
    );
  }
} 