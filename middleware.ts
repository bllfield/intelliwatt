import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';

const PUBLIC_PATHS = new Set<string>([
  '/',
  '/login',
  '/privacy',
  '/rules',
  '/favicon.ico',
  '/favicon.png',
  '/robots.txt',
  '/sitemap.xml'
]);

export function middleware(req: NextRequest) {
  const url = new URL(req.url);
  const pathname = url.pathname;

  if (
    pathname.startsWith('/_next') ||
    pathname.startsWith('/static') ||
    pathname.startsWith('/api')
  ) {
    return NextResponse.next();
  }

  if (PUBLIC_PATHS.has(pathname)) {
    return NextResponse.next();
  }

  const authed = Boolean(req.cookies.get('auth_token')?.value);
  if (!authed && pathname.startsWith('/dashboard')) {
    url.pathname = '/login';
    return NextResponse.redirect(url);
  }

  return NextResponse.next();
}

export const config = {
  matcher: ['/((?!_next|static).*)']
}; 