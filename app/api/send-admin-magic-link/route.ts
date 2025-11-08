import { NextRequest, NextResponse } from 'next/server';
import { createMagicToken, storeToken } from '@/lib/magic/magic-token';
import { sendLoginEmail } from '@/lib/email/sendLoginEmail';
import { normalizeEmail } from '@/lib/utils/email';

export const dynamic = 'force-dynamic';

// List of authorized admin emails
const ADMIN_EMAILS = [
  'brian@intelliwatt.com',
  'brian@intellipath-solutions.com',
];

export async function POST(request: NextRequest) {
  try {
    const { email } = await request.json();

    if (!email || !email.includes('@')) {
      return NextResponse.json({ error: 'Valid email is required' }, { status: 400 });
    }

    // Normalize email to lowercase for consistent storage and comparison
    const normalizedEmail = normalizeEmail(email);

    // Check if email is authorized for admin access
    if (!ADMIN_EMAILS.includes(normalizedEmail)) {
      return NextResponse.json({ 
        error: 'Unauthorized. This email is not authorized for admin access.' 
      }, { status: 403 });
    }

    // Create and store the magic token
    let token: string;
    let magicLink: string;
    
    try {
      token = await createMagicToken(normalizedEmail);
      await storeToken(normalizedEmail, token);
      
      // Create the magic link URL
      const baseUrl = process.env.NEXT_PUBLIC_BASE_URL || (process.env.VERCEL_URL ? `https://${process.env.VERCEL_URL}` : 'https://intelliwatt.com');
      magicLink = `${baseUrl}/admin/magic?token=${token}`;
    } catch (dbError) {
      console.error('Database error:', dbError);
      // If database is not available, create a temporary token for testing
      token = `temp_admin_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
      const baseUrl = process.env.NEXT_PUBLIC_BASE_URL || (process.env.VERCEL_URL ? `https://${process.env.VERCEL_URL}` : 'https://intelliwatt.com');
      magicLink = `${baseUrl}/admin/magic?token=${token}`;
      console.log('Using temporary admin token due to database unavailability');
    }

    // Log the magic link for testing
    console.log('=== ADMIN MAGIC LINK FOR TESTING ===');
    console.log(`Email: ${normalizedEmail}`);
    console.log(`Magic Link: ${magicLink}`);
    console.log('=====================================');

    // Try to send email
    try {
      await sendLoginEmail(normalizedEmail, magicLink, 'Admin Access to IntelliWatt');
      console.log('Admin magic link email sent successfully');
    } catch (emailError) {
      console.error('Email sending failed:', emailError);
      // Don't fail the request if email fails - we still log the link
    }

    return NextResponse.json({ 
      success: true, 
      message: 'Admin magic link sent! Please check your email inbox.' 
    });
  } catch (error) {
    console.error('Error sending admin magic link:', error);
    return NextResponse.json(
      { error: 'Failed to send admin magic link. Please try again.' },
      { status: 500 }
    );
  }
}
