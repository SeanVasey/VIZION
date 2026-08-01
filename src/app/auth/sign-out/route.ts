import { NextResponse, type NextRequest } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { crossOriginPost } from "@/lib/security/same-origin";

/** Sign out (POST) and return to the auth gate. */
export async function POST(request: NextRequest) {
  // A cross-site POST can't read the response, but signing someone out IS
  // the attack (SEC-010) — refuse mismatched origins outright.
  if (crossOriginPost(request)) {
    return NextResponse.json({ error: "Cross-origin request refused." }, { status: 403 });
  }
  const supabase = await createClient();
  await supabase.auth.signOut();
  return NextResponse.redirect(new URL("/sign-in", request.nextUrl.origin), {
    status: 303,
  });
}
