import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

const PUBLIC_PATHS = ["/login", "/register", "/setup"];

export function proxy(request: NextRequest) {
  const { pathname } = request.nextUrl;

  // /api/* is proxied via next.config.ts rewrites (no middleware needed — avoids
  // Vercel's FUNCTION_PAYLOAD_TOO_LARGE limit on large file uploads)
  if (pathname.startsWith("/api/")) {
    return NextResponse.next();
  }

  // Allow public page routes without auth
  if (PUBLIC_PATHS.some((p) => pathname.startsWith(p))) {
    return NextResponse.next();
  }

  // Check for auth cookie on protected page routes
  const token = request.cookies.get("spine_auth");
  if (!token) {
    const loginUrl = new URL("/login", request.url);
    loginUrl.searchParams.set("from", pathname);
    return NextResponse.redirect(loginUrl);
  }

  return NextResponse.next();
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"],
};
