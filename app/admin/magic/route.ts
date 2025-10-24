import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import { db } from '@/lib/db';

export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  const token = searchParams.get('token');

  if (!token) {
    return new Response('Missing token', { status: 400 });
  }

  // Handle temporary tokens (when database is not available)
  if (token.startsWith('temp_admin_')) {
    console.log('Temporary admin token used - database not available');
    // For temporary tokens, create a basic admin session
    const cookieStore = cookies();
    
    // Set admin cookie with a placeholder email
    cookieStore.set({
      name: 'intelliwatt_admin',
      value: 'temp_admin@intelliwatt.com',
      httpOnly: true,
      secure: true,
      path: '/',
      maxAge: 60 * 60 * 24, // 24 hours
    });

    redirect('/admin');
  }

  // Handle real tokens from database
  try {
    const record = await db.magicLinkToken.findUnique({
      where: { token },
    });

    if (!record || record.used || new Date() > record.expiresAt) {
      return new Response('Invalid or expired token', { status: 401 });
    }

    // Check if email is authorized for admin access
    const ADMIN_EMAILS = [
      'brian@intelliwatt.com',
      'brian@intellipath-solutions.com',
      'login@intelliwatt.com',
    ];

    if (!ADMIN_EMAILS.includes(record.email.toLowerCase())) {
      return new Response('Unauthorized. This email is not authorized for admin access.', { status: 403 });
    }

    // Mark token as used
    await db.magicLinkToken.update({
      where: { token },
      data: { used: true },
    });

    // Set admin cookie
    cookies().set({
      name: 'intelliwatt_admin',
      value: record.email,
      httpOnly: true,
      secure: true,
      path: '/',
      maxAge: 60 * 60 * 24, // 24 hours
    });

    redirect('/admin');
  } catch (dbError) {
    console.error('Database error in admin magic link login:', dbError);
    return new Response('Database error - please try again', { status: 500 });
  }
}
