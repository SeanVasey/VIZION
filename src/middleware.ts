import { type NextRequest } from "next/server";
import { updateSession } from "@/lib/supabase/middleware";
import { buildCsp, isHttpsOrigin } from "@/lib/security/csp";

/**
 * Base64 nonce from the Web Crypto the Edge runtime provides. 128 bits —
 * the CSP3 recommendation.
 */
function makeNonce(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(16));
  let bin = "";
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin);
}

export async function middleware(request: NextRequest) {
  // Per-request CSP nonce (audit SEC-001): script-src drops 'unsafe-inline'
  // for every document. The policy rides the REQUEST headers too — Next reads
  // the nonce from there and stamps it onto its own inline scripts, and the
  // root layout reads x-nonce for the no-flash theme bootstrap.
  const nonce = makeNonce();
  const csp = buildCsp(process.env.NEXT_PUBLIC_SUPABASE_URL, {
    nonce,
    httpsOrigin: isHttpsOrigin(),
  });
  request.headers.set("x-nonce", nonce);
  request.headers.set("content-security-policy", csp);

  const response = await updateSession(request);
  // Redirects and JSON 401s carry it harmlessly; documents need it.
  response.headers.set("content-security-policy", csp);
  return response;
}

export const config = {
  /**
   * Run on every path except Next internals and static assets. The service
   * worker, manifest, icons, and splash screens must stay publicly reachable so
   * the PWA shell installs and loads before auth. (offline.html and sw.js get
   * a static CSP from next.config.ts instead — they cannot take a nonce.
   * `offline$` is the same document at the URL Vercel's cleanUrls actually
   * serves it from; without the exclusion it picks up the nonce policy here.
   * `offline.js` is that document's recovery script: left matched, a
   * signed-out fetch — including the SW's install-time precache on /sign-in —
   * auth-redirects to HTML, which would poison the precache entry and leave
   * offline recovery dead again. The matcher exclusions are pinned by
   * tests/unit/middleware-gate.test.ts.)
   */
  matcher: [
    "/((?!_next/static|_next/image|favicon.ico|robots.txt|sw.js|manifest.webmanifest|offline.html|offline.js|offline$|icons/|splash/|.*\\.(?:png|jpg|jpeg|svg|webp|ico)$).*)",
  ],
};
