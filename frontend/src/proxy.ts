import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

const PUBLIC_PATHS = ["/login", "/register", "/setup"];

export function proxy(request: NextRequest) {
  const { pathname } = request.nextUrl;

  // Proxy /api/* to FastAPI backend — before any auth check
  if (pathname.startsWith("/api/")) {
    const backendUrl = process.env.BACKEND_URL ?? "http://localhost:8000";
    const destination = new URL(
      pathname + request.nextUrl.search,
      backendUrl
    );
    return NextResponse.rewrite(destination);
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
