import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';

export function middleware(req: NextRequest) {
  const loggedIn = req.cookies.get('intelliwatt_user')?.value;
  const adminLoggedIn = req.cookies.get('intelliwatt_admin')?.value;

  const publicPaths = ['/', '/login', '/admin-login', '/api', '/_next', '/favicon.ico', '/how-it-works', '/faq', '/privacy-policy', '/rules', '/join', '/quote', '/results'];

  const isPublic = publicPaths.some((path) => req.nextUrl.pathname.startsWith(path));

  // Check if accessing admin routes
  if (req.nextUrl.pathname.startsWith('/admin')) {
    if (adminLoggedIn) {
      return NextResponse.next();
    } else {
      return NextResponse.redirect(new URL('/admin-login', req.url));
    }
  }

  // Check regular protected routes
  if (isPublic || loggedIn) {
    return NextResponse.next();
  }

  // Not logged in and visiting a protected route
  return NextResponse.redirect(new URL('/login', req.url));
}

export const config = {
  matcher: ['/dashboard/:path*', '/account/:path*', '/admin/:path*'],
}; 