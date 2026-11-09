import { NextResponse, type NextRequest } from "next/server";

import { SESSION_COOKIE } from "@/lib/session";

// Pages that work without signing in: the sign-in page itself, an expert's personal link from
// Slack (the link says who they are), and the RFP PDFs those pages show beside the items.
const PUBLIC = [/^\/login$/, /^\/r\/[^/]+$/, /^\/rfps\/\d+\/source$/];

/**
 * An optimistic check: no session cookie means straight to sign-in. Pages still verify the
 * cookie's signature (requireActor), because the proxy is not where authorization belongs.
 */
export function proxy(request: NextRequest) {
  const { pathname, search } = request.nextUrl;
  if (PUBLIC.some((p) => p.test(pathname)) || request.cookies.has(SESSION_COOKIE)) return NextResponse.next();
  const login = new URL("/login", request.url);
  if (pathname !== "/") login.searchParams.set("next", pathname + search);
  return NextResponse.redirect(login);
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"],
};
