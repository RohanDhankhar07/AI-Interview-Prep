import { NextResponse, type NextRequest } from 'next/server';

/**
 * Cheap edge gate: a request with no session cookie never reaches a protected
 * page or API route. It is a redirect, not the authorisation itself — every
 * handler still calls requireUser() and scopes its query by user id.
 */
export function middleware(request: NextRequest) {
  const hasSession = request.cookies.has('ipk_session');
  if (hasSession) return NextResponse.next();

  const { pathname, search } = request.nextUrl;

  if (pathname.startsWith('/api/')) {
    return NextResponse.json(
      { error: { code: 'UNAUTHORIZED', message: 'Sign in to continue.' } },
      { status: 401 },
    );
  }

  const url = request.nextUrl.clone();
  url.pathname = '/login';
  url.search = `?next=${encodeURIComponent(pathname + search)}`;
  return NextResponse.redirect(url);
}

export const config = {
  matcher: ['/kits/:path*', '/api/kits/:path*'],
};
