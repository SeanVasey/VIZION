import { type NextRequest } from "next/server";
import { updateSession } from "@/lib/supabase/middleware";

export async function middleware(request: NextRequest) {
  return updateSession(request);
}

export const config = {
  /**
   * Run on every path except Next internals and static assets. The service
   * worker, manifest, icons, and splash screens must stay publicly reachable so
   * the PWA shell installs and loads before auth.
   */
  matcher: [
    "/((?!_next/static|_next/image|favicon.ico|sw.js|manifest.webmanifest|offline.html|icons/|splash/|.*\\.(?:png|jpg|jpeg|svg|webp|ico)$).*)",
  ],
};
