import { NextRequest, NextResponse } from 'next/server';
import { verifyAccessToken } from '@/lib/auth';

// Runs on the Edge runtime (default for middleware) — verifyAccessToken uses
// `jose`, which works there, unlike bcryptjs/Prisma used elsewhere. This is
// a UX guard (redirect before rendering a page they can't use), not the
// actual security boundary — every API route still independently calls
// requireUser/requireAdmin server-side, since middleware alone is not
// sufficient authorization for the underlying data.
export async function middleware(req: NextRequest) {
  const token = req.cookies.get('access_token')?.value;
  const payload = token ? await verifyAccessToken(token) : null;

  const path = req.nextUrl.pathname;

  // 1. Admin paths:
  // Non-logged in visitors get redirected to login with next param
  // Logged-in non-admins (regular users) are barred and redirected to /dashboard
  if (path.startsWith('/admin') && path !== '/admin/setup') {
    if (!payload) {
      const loginUrl = new URL('/login', req.url);
      loginUrl.searchParams.set('next', path);
      return NextResponse.redirect(loginUrl);
    }
    if (payload.role !== 'admin') {
      return NextResponse.redirect(new URL('/dashboard', req.url));
    }
  }

  // 2. Member dashboard paths:
  // Non-logged in visitors get redirected to login with next param
  // Logged-in admins are barred and redirected to /admin
  if (path.startsWith('/dashboard')) {
    if (!payload) {
      const loginUrl = new URL('/login', req.url);
      loginUrl.searchParams.set('next', path);
      return NextResponse.redirect(loginUrl);
    }
    if (payload.role === 'admin') {
      return NextResponse.redirect(new URL('/admin', req.url));
    }
  }

  // 3. Auth pages: redirect already logged-in users to their respective home
  if ((path === '/login' || path === '/register') && payload) {
    if (payload.role === 'admin') {
      return NextResponse.redirect(new URL('/admin', req.url));
    }
    return NextResponse.redirect(new URL('/dashboard', req.url));
  }

  return NextResponse.next();
}

export const config = {
  matcher: ['/admin/:path*', '/dashboard/:path*', '/login', '/register'],
};
