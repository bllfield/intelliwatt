import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';

export function middleware(req: NextRequest) {
  const loggedIn = req.cookies.get('intelliwatt_user')?.value;
  const adminLoggedIn = req.cookies.get('intelliwatt_admin')?.value;

  console.log('Middleware check:', {
    path: req.nextUrl.pathname,
    userCookie: loggedIn ? 'present' : 'missing',
    adminCookie: adminLoggedIn ? 'present' : 'missing',
    adminValue: adminLoggedIn
  });

  const publicPaths = ['/', '/login', '/login/magic', '/admin-login', '/admin/magic', '/api', '/_next', '/favicon.ico', '/how-it-works', '/faq', '/privacy-policy', '/rules', '/join', '/quote', '/results'];

  const isPublic = publicPaths.some((path) => req.nextUrl.pathname.startsWith(path));

  // Check if accessing admin routes (but not the magic link handler)
  if (req.nextUrl.pathname.startsWith('/admin') && !req.nextUrl.pathname.startsWith('/admin/magic')) {
    console.log('Admin route access attempt:', {
      path: req.nextUrl.pathname,
      adminCookie: adminLoggedIn ? 'present' : 'missing'
    });
    
    if (adminLoggedIn) {
      console.log('Admin access granted');
      return NextResponse.next();
    } else {
      console.log('Admin access denied - redirecting to admin-login');
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
  matcher: [
    '/dashboard/:path*', 
    '/account/:path*', 
    '/admin/((?!magic).)*'
  ],
}; 