import { NextResponse, type NextRequest } from "next/server";
import { SESSION_COOKIE } from "@/lib/session";

/**
 * Next 16 renamed `middleware.ts` to `proxy.ts` (same behaviour, now Node
 * runtime by default).
 *
 * This is an OPTIMISTIC check only — it looks at cookie presence and nothing
 * else, per the Next auth guide, because proxy runs on every request including
 * prefetches. The authoritative HMAC verification happens in `getSession()`,
 * which every protected page and route handler calls.
 */

const PUBLIC_PATHS = ["/login"];

export function proxy(request: NextRequest) {
  const { pathname } = request.nextUrl;
  const hasSessionCookie = Boolean(request.cookies.get(SESSION_COOKIE)?.value);
  const isPublic = PUBLIC_PATHS.some((p) => pathname === p || pathname.startsWith(`${p}/`));

  if (!hasSessionCookie && !isPublic) {
    const url = new URL("/login", request.url);
    if (pathname !== "/") url.searchParams.set("next", pathname);
    return NextResponse.redirect(url);
  }

  // Deliberately NOT bouncing a cookie-bearing request away from /login here.
  // "Has a cookie" is not "is signed in" — an expired or tampered cookie would
  // be sent to /, rejected by the real check, redirected back to /login, and
  // bounced here again, forever. The login page makes that call itself after
  // verifying the signature.
  return NextResponse.next();
}

export const config = {
  // Page routes only. Without a matcher this would also gate CSS and JS.
  //
  // `/api` is excluded deliberately: an API client should get a 401 JSON body,
  // not a 307 to an HTML login page. Route handlers call `getSession()` and
  // return their own 401 instead.
  matcher: ["/((?!api|_next/static|_next/image|favicon.ico|.*\\.svg$).*)"],
};
