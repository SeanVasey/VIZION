"use client";

import { useEffect } from "react";

/**
 * Keeps the Home-Screen tile matched to the CURRENT appearance.
 *
 * WHY THIS EXISTS — what iOS actually reads, measured on device 2026-08-12.
 * ------------------------------------------------------------------------
 * The owner's two installs, photographed side by side in both appearances,
 * settled three questions this repo had been hedging across (the old note in
 * docs/runbooks/ios-verification.md called them unverifiable, and the hedge it
 * shipped guessed wrong on the one that mattered):
 *
 *   1. iOS DOES read `<link rel="apple-touch-icon">` from the head at "Add to
 *      Home Screen" — one install carried the light colorway, which exists in
 *      no other asset. Whether it ALSO consults the manifest, and at what
 *      precedence, is NOT established: the second install rendered identically
 *      whether it came from the dark tile or from a transparent manifest glyph
 *      composited on black. This component therefore owns the channel iOS is
 *      known to read; it does not claim to own the only one.
 *   2. `media` does NOT select icons. It works on `apple-touch-startup-image`
 *      — which is why the splash links in layout.tsx do resolve per device —
 *      but for `apple-touch-icon` iOS falls back to Apple's documented "last
 *      one wins". The complementary-query pair could not have worked: its dark
 *      half was unreachable, and its media-blind default was the LIGHT tile.
 *   3. iOS auto-darkens whatever single tile it captured when the system moves
 *      to dark appearance. Applied to the light tile — Void ink on a Laser
 *      plate — that pulls the plate down to near-black and leaves the mark as
 *      an invisible emboss. That is the bug the owner reported, and it is the
 *      same failure lessons.md recorded once already.
 *
 * WHAT THIS DOES. Appends a single `apple-touch-icon` link and keeps it last in
 * the head, with the href matching `prefers-color-scheme` right now — so the
 * tile iOS captures is the artwork for the appearance the user is actually in.
 * Re-appending on every change keeps it last even if React inserts more links
 * later; last is what "last one wins" needs.
 *
 * This is the only technique reported working on device by developers on the
 * Apple forums (thread 761615) and it is what Apple's own dark-icon model
 * implies: the dark variant is a separate asset, not a derivation.
 *
 * WHAT IT CANNOT DO, and no configuration can. iOS resolves the tile ONCE, at
 * capture, and freezes it — there is no re-resolution when the appearance later
 * changes. So an install made in light mode keeps the Laser plate, and iOS
 * darkens it if the phone moves to dark; re-adding to the Home Screen is the
 * only refresh. The static pair in layout.tsx covers the pre-hydration and
 * no-JS captures, and is ordered so THAT case lands on the dark tile — the one
 * colorway legible under every appearance. Worst case is legible, best case is
 * matched.
 */

const LIGHT = "/icons/apple-touch-icon.png";
const DARK = "/icons/apple-touch-icon-dark.png";

export function AppleTouchIcon() {
  useEffect(() => {
    const query = window.matchMedia("(prefers-color-scheme: dark)");
    const link = document.createElement("link");
    link.setAttribute("rel", "apple-touch-icon");
    link.setAttribute("sizes", "180x180");
    // Marks the element as this component's, so the e2e assertion can tell the
    // matched link apart from the two static ones it is layered over.
    link.setAttribute("data-appearance-matched", "");

    const apply = () => {
      link.setAttribute("href", query.matches ? DARK : LIGHT);
      // append() MOVES an already-parented node, which is the point: the link
      // has to stay last for Apple's "last one wins" to resolve to it.
      document.head.append(link);
    };

    apply();
    query.addEventListener("change", apply);
    return () => {
      query.removeEventListener("change", apply);
      link.remove();
    };
  }, []);

  return null;
}
