import { NextResponse, type NextRequest } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { postAuthRedirect } from "@/lib/auth/onboarding";
import { rateLimit } from "@/lib/security/rate-limit";

/**
 * OAuth + PKCE callback. Supabase redirects here with a `code` after a GitHub /
 * Google consent (or a PKCE magic link). We exchange it for a session, then
 * route the user to onboarding or the studio.
 */
export async function GET(request: NextRequest) {
  const { searchParams, origin } = request.nextUrl;
  // Unauthenticated code-exchange endpoint — burst-guarded by IP (SEC-002;
  // advisory in-memory layer, same posture as the model routes' front guard).
  const ip = request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ?? "local";
  if (!rateLimit("auth-callback:" + ip, 30, 60_000).allowed) {
    return NextResponse.redirect(`${origin}/sign-in?error=rate_limited`);
  }
  const code = searchParams.get("code");
  const error = searchParams.get("error_description") ?? searchParams.get("error");

  if (error) {
    return NextResponse.redirect(`${origin}/sign-in?error=${encodeURIComponent(error)}`);
  }

  if (!code) {
    return NextResponse.redirect(`${origin}/sign-in?error=missing_code`);
  }

  const supabase = await createClient();
  const { error: exchangeError } = await supabase.auth.exchangeCodeForSession(code);

  if (exchangeError) {
    return NextResponse.redirect(
      `${origin}/sign-in?error=${encodeURIComponent(exchangeError.message)}`,
    );
  }

  return NextResponse.redirect(`${origin}${await postAuthRedirect(supabase)}`);
}
