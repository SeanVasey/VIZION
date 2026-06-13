import { NextResponse, type NextRequest } from "next/server";
import { createServerClient } from "@supabase/ssr";
import type { Database } from "@/lib/supabase/database.types";

/** Routes reachable without a session (the auth gate + its callbacks). */
const PUBLIC_PREFIXES = ["/sign-in", "/auth", "/offline"];

function isPublic(pathname: string): boolean {
  return PUBLIC_PREFIXES.some((p) => pathname === p || pathname.startsWith(`${p}/`));
}

/**
 * Refresh the Supabase session on every request and gate protected routes.
 * Must run in middleware so the refreshed auth cookies are written to the
 * response (FINAL_PLAN D7 — JWT ≤7d + rotation).
 */
export async function updateSession(request: NextRequest) {
  let response = NextResponse.next({ request });

  const supabase = createServerClient<Database>(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return request.cookies.getAll();
        },
        setAll(cookiesToSet) {
          for (const { name, value } of cookiesToSet) {
            request.cookies.set(name, value);
          }
          response = NextResponse.next({ request });
          for (const { name, value, options } of cookiesToSet) {
            response.cookies.set(name, value, options);
          }
        },
      },
    },
  );

  // IMPORTANT: getUser() revalidates the token with Supabase Auth; do not gate
  // on getSession() (which trusts the unverified cookie).
  const {
    data: { user },
  } = await supabase.auth.getUser();

  const { pathname } = request.nextUrl;

  // Unauthenticated API calls get a 401 JSON, not an HTML redirect.
  if (!user && pathname.startsWith("/api/")) {
    return NextResponse.json({ error: "Authentication required." }, { status: 401 });
  }

  // Unauthenticated → bounce everything except public routes to the gate.
  if (!user && !isPublic(pathname)) {
    const url = request.nextUrl.clone();
    url.pathname = "/sign-in";
    return NextResponse.redirect(url);
  }

  // Authenticated user on the gate → send them into the studio.
  if (user && pathname === "/sign-in") {
    const url = request.nextUrl.clone();
    url.pathname = "/enhance";
    return NextResponse.redirect(url);
  }

  return response;
}
