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

  if (path.startsWith('/admin') && path !== '/admin/setup' && payload?.role !== 'admin') {
    const loginUrl = new URL('/login', req.url);
    loginUrl.searchParams.set('next', path);
    return NextResponse.redirect(loginUrl);
  }

  if (path.startsWith('/dashboard') && !payload) {
    const loginUrl = new URL('/login', req.url);
    loginUrl.searchParams.set('next', path);
    return NextResponse.redirect(loginUrl);
  }

  return NextResponse.next();
}

export const config = {
  matcher: ['/admin/:path*', '/dashboard/:path*'],
};
