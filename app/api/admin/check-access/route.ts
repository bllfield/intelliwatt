import { NextRequest, NextResponse } from 'next/server';

export async function GET(request: NextRequest) {
  try {
    // For now, we'll use a simple environment variable check
    // In production, you should implement proper session-based authentication
    const adminEmail = process.env.ADMIN_EMAIL;
    
    if (!adminEmail) {
      return NextResponse.json({ error: 'Admin email not configured' }, { status: 500 });
    }

    return NextResponse.json({ 
      adminEmail,
      isAdmin: true 
    });
  } catch (error) {
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
} 