import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';

export function middleware(req: NextRequest) {
  const loggedIn = req.cookies.get('intelliwatt_user')?.value;

  const publicPaths = ['/', '/login', '/api', '/_next', '/favicon.ico'];

  const isPublic = publicPaths.some((path) => req.nextUrl.pathname.startsWith(path));

  if (isPublic || loggedIn) {
    return NextResponse.next();
  }

  // Not logged in and visiting a protected route
  return NextResponse.redirect(new URL('/login', req.url));
}

export const config = {
  matcher: ['/dashboard/:path*', '/account/:path*'],
}; 