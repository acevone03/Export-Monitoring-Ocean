import { NextResponse, type NextRequest } from "next/server";

// Cheap gate: no session cookie -> login. Real validation happens in requireUser().
// The logo and tab icon are also shown on the login and field-link pages (no session).
const PUBLIC = [/^\/login/, /^\/f\//, /^\/_next\//, /^\/favicon/, /^\/nnr-logo\.png$/, /^\/icon(\.png)?$/];

export function middleware(req: NextRequest) {
  const { pathname } = req.nextUrl;
  if (PUBLIC.some((re) => re.test(pathname))) return NextResponse.next();
  if (!req.cookies.get("nnr_session")) {
    const url = req.nextUrl.clone();
    url.pathname = "/login";
    url.search = "";
    return NextResponse.redirect(url);
  }
  return NextResponse.next();
}

export const config = { matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"] };
