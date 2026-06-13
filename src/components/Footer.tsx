import { APP_VERSION } from "@/lib/version";

/**
 * Canonical VASEY/AI universal branded footer (template v1.1).  Shown on every
 * app surface (Enhance · Library · Profile) and the Sign-in gate.  Carries the
 * real VM (Vasey Multimedia) and V/AI monograms, the suite tag, the app/version
 * line, and a dynamic copyright.
 *
 * Implemented with the locked 7-role tokens (no bespoke CSS custom props):
 *   --text-secondary / --text-muted → text-silver
 *   --border-subtle / --border-glow → bg-hair
 *   --accent-deep / --accent-dim / --accent-primary → --laser (text-accent)
 *
 * Monograms render via `currentColor`, so they stay legible (and invert with the
 * role tokens) in both themes — never recoloured or redrawn.
 *
 * `inset` trims the bottom padding for the authed shell so it clears the fixed
 * bottom nav; the default keeps the bottom safe-area for the full-height gate.
 */
export function Footer({ inset = false }: { inset?: boolean }) {
  const year = new Date().getFullYear();

  return (
    <footer
      className={`footer-fade-in mt-14 flex flex-col items-center px-4 pt-8 text-center ${
        inset ? "pb-6" : "pb-safe"
      }`}
    >
      {/* Hairline divider: transparent → laser → transparent */}
      <div
        aria-hidden="true"
        className="mb-7 h-px w-12"
        style={{
          background:
            "linear-gradient(90deg, transparent, var(--laser), transparent)",
        }}
      />

      <div className="mb-5 flex items-center justify-center gap-5">
        {/* Vasey Multimedia — VM monogram */}
        <a
          href="https://vaseymultimedia.com"
          target="_blank"
          rel="noopener noreferrer"
          aria-label="Vasey Multimedia"
          className="inline-flex items-center text-silver opacity-45 transition-opacity hover:opacity-75"
        >
          <svg
            className="h-[31px] w-9"
            viewBox="0 0 688 592"
            xmlns="http://www.w3.org/2000/svg"
            aria-hidden="true"
          >
            <g transform="translate(0,592) scale(0.1,-0.1)" fill="currentColor">
              <path d="M20 3827 l0 -2073 251 -265 c138 -145 281 -299 317 -341 37 -42 70 -76 74 -75 3 1 8 851 10 1889 2 1038 8 1891 12 1895 5 4 11 2 13 -5 3 -7 51 -70 106 -139 144 -178 444 -556 611 -767 77 -98 193 -245 257 -325 64 -80 223 -281 353 -446 130 -165 301 -381 380 -480 78 -99 205 -261 282 -359 76 -99 176 -227 222 -285 46 -58 104 -133 130 -166 323 -418 405 -517 415 -499 13 24 111 152 237 309 83 104 193 244 345 438 22 29 76 97 120 153 44 56 116 148 160 205 44 57 213 270 375 474 162 203 307 386 322 405 15 19 89 112 165 207 76 94 174 218 217 275 44 57 202 258 350 447 317 403 353 448 409 521 l42 55 3 -1903 c1 -1047 6 -1902 10 -1900 4 2 50 50 102 108 52 58 184 197 294 310 110 113 211 221 225 241 l26 35 0 225 c0 123 -1 1053 -2 2067 l-3 1842 -323 0 c-309 0 -323 -1 -332 -19 -6 -11 -57 -79 -115 -151 -126 -158 -178 -226 -377 -486 -83 -109 -191 -249 -240 -311 -48 -61 -166 -212 -262 -335 -197 -251 -337 -430 -522 -663 -70 -88 -146 -186 -170 -217 -120 -155 -371 -476 -528 -673 -96 -121 -198 -249 -226 -285 -28 -36 -111 -140 -184 -232 l-133 -166 -27 31 c-15 18 -49 61 -77 97 -27 36 -103 133 -169 216 -66 82 -164 206 -217 275 -53 68 -170 216 -258 329 -89 113 -276 354 -417 535 -141 182 -289 371 -328 420 -39 50 -128 162 -196 250 -69 88 -181 232 -250 319 -68 87 -221 283 -339 435 -119 152 -271 345 -338 429 -67 84 -129 164 -138 177 l-16 25 -324 0 -324 0 0 -2073z M1209 5883 c5 -10 66 -90 136 -178 69 -88 176 -225 238 -305 61 -80 146 -188 187 -241 41 -52 106 -136 145 -185 38 -49 121 -155 185 -235 63 -80 141 -179 172 -220 62 -79 308 -394 532 -679 213 -272 298 -381 471 -603 88 -114 162 -206 165 -206 3 0 21 21 41 47 19 26 109 141 200 256 90 115 247 315 348 445 236 302 465 594 547 696 102 128 375 474 563 716 96 123 216 276 266 339 50 63 136 171 190 240 l98 125 -374 3 c-292 2 -375 0 -380 -10 -4 -7 -102 -132 -218 -278 -116 -146 -223 -281 -238 -301 -98 -128 -269 -345 -333 -423 -41 -50 -93 -116 -115 -146 -22 -30 -78 -102 -125 -160 -78 -96 -186 -232 -388 -490 -41 -52 -79 -95 -83 -95 -5 0 -46 48 -91 106 -101 129 -455 578 -750 949 -509 643 -621 786 -642 817 l-21 33 -368 0 c-347 0 -367 -1 -358 -17z M1130 2171 l0 -1484 163 -166 c156 -159 343 -353 437 -453 25 -27 48 -48 53 -48 4 0 7 637 7 1415 l0 1415 -33 37 c-19 21 -151 184 -295 363 -144 179 -277 343 -296 365 l-35 40 -1 -1484z M5633 3532 c-50 -64 -193 -245 -317 -401 l-226 -284 0 -1413 c0 -887 4 -1414 10 -1414 5 0 13 6 17 14 10 18 110 125 267 286 66 69 175 181 241 250 l120 125 -3 1478 c-1 812 -5 1477 -10 1476 -4 0 -48 -53 -99 -117z" />
            </g>
          </svg>
        </a>

        <div aria-hidden="true" className="h-6 w-px bg-hair" />

        {/* VASEY/AI — V/AI monogram */}
        <a
          href="https://vasey.ai"
          target="_blank"
          rel="noopener noreferrer"
          aria-label="VASEY/AI"
          className="inline-flex items-center text-silver opacity-45 transition-opacity hover:opacity-75"
        >
          <svg
            className="h-12 w-12"
            viewBox="0 0 1080 1080"
            xmlns="http://www.w3.org/2000/svg"
            aria-hidden="true"
          >
            <g transform="translate(0,1080) scale(0.1,-0.1)" fill="currentColor">
              <path d="M5797 7988 c-15 -12 -38 -53 -162 -283 -26 -49 -75 -139 -108 -200 -58 -107 -233 -435 -334 -625 -84 -157 -278 -521 -311 -580 -16 -30 -127 -239 -247 -465 -119 -225 -233 -439 -252 -475 -20 -36 -76 -141 -125 -235 -50 -93 -105 -197 -123 -230 -18 -33 -73 -136 -123 -230 -49 -93 -99 -187 -111 -209 -12 -21 -62 -114 -111 -206 -49 -92 -97 -183 -108 -201 -10 -19 -42 -78 -72 -131 -29 -54 -59 -98 -66 -98 -17 0 -34 32 -34 61 0 21 63 146 190 379 196 358 240 441 240 454 0 13 -482 978 -500 1001 -5 6 -74 141 -155 300 -81 160 -195 382 -253 495 -58 113 -134 262 -168 332 -35 70 -71 131 -81 136 -20 11 -983 3 -983 -7 0 -3 31 -62 68 -131 37 -69 103 -192 146 -275 44 -82 129 -244 191 -360 62 -115 143 -268 180 -340 37 -71 103 -195 145 -275 43 -80 105 -199 140 -265 35 -66 82 -156 105 -200 24 -44 118 -224 210 -400 92 -176 202 -385 245 -465 42 -80 119 -226 171 -325 51 -99 133 -256 181 -350 49 -93 147 -286 218 -427 115 -227 134 -258 154 -258 20 0 39 29 136 208 62 114 166 304 230 422 175 321 310 571 380 705 35 66 148 280 253 475 104 195 208 391 232 435 23 44 102 193 175 330 73 138 182 342 243 455 61 113 122 225 135 250 67 125 125 232 162 300 22 41 70 134 107 205 36 72 181 346 323 610 141 264 280 524 309 578 29 54 50 105 47 113 -5 12 -73 14 -439 14 -331 0 -437 -3 -450 -12z M8839 6962 c-42 -20 -114 -55 -160 -76 -152 -71 -473 -226 -529 -256 l-55 -29 -9 -318 c-5 -180 -5 -886 0 -1618 l9 -1300 420 0 420 0 0 1814 c0 1201 -3 1815 -10 1817 -5 1 -44 -14 -86 -34z M5983 6518 c-5 -7 -26 -44 -45 -83 -20 -38 -106 -200 -191 -359 -86 -158 -159 -297 -162 -307 -6 -17 98 -224 285 -574 15 -27 57 -109 94 -182 36 -72 74 -141 84 -152 17 -19 29 -20 424 -22 224 -2 410 0 414 4 3 3 -9 34 -29 69 -41 74 -313 594 -447 853 -265 515 -399 765 -410 765 -4 0 -12 -6 -17 -12z M5066 4761 c-19 -7 -101 -146 -281 -474 -76 -139 -105 -201 -97 -209 7 -7 487 -10 1571 -10 859 -1 1564 2 1567 5 4 3 -16 45 -44 94 -27 48 -74 135 -105 193 -130 249 -200 376 -215 393 -14 16 -83 17 -1196 16 -650 0 -1189 -4 -1200 -8z M6450 3977 c0 -8 15 -43 33 -78 19 -35 78 -149 132 -254 54 -104 101 -194 105 -200 9 -12 97 -182 323 -620 206 -401 225 -435 251 -444 12 -4 227 -5 479 -3 l457 4 -86 167 c-124 237 -179 341 -244 461 -31 58 -85 159 -120 225 -34 66 -79 152 -100 190 -21 39 -75 142 -120 230 -46 87 -104 195 -130 240 l-46 80 -49 6 c-28 3 -238 7 -467 8 -355 2 -418 0 -418 -12z" />
            </g>
          </svg>
        </a>
      </div>

      <p className="font-body mb-2 text-xs font-medium uppercase tracking-[0.25em] text-silver">
        A VASEY/AI Production
      </p>
      <p className="font-mono mb-4 text-[11px] text-silver opacity-70">
        VIZ(IO)N v{APP_VERSION} · Multi-Model Prompt Studio
      </p>
      <p className="font-body text-[11px] leading-relaxed text-silver opacity-60">
        © {year}{" "}
        <a
          href="https://vaseymultimedia.com"
          target="_blank"
          rel="noopener noreferrer"
          className="text-accent transition-colors hover:underline"
        >
          VASEY Multimedia
        </a>
        . All rights reserved.
        <br />
        Designed &amp; engineered by{" "}
        <a
          href="https://vasey.ai"
          target="_blank"
          rel="noopener noreferrer"
          className="text-accent transition-colors hover:underline"
        >
          VASEY/AI
        </a>
      </p>
    </footer>
  );
}
