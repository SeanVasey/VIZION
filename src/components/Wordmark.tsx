/**
 * The VIZ(IO)N wordmark (remediation R2.4).
 *
 * Plain "VIZION": V I Z N in --chalk, the "IO" in --laser.  No brackets and no
 * chevron — the brand mark / app icon carry the (I›O) aperture motif, so the
 * wordmark stays clean.  Display face (Bebas Neue).
 */
export function Wordmark({ className = "" }: { className?: string }) {
  return (
    <span
      className={`font-display tracking-wide ${className}`}
      aria-label="VIZION"
      role="img"
    >
      <span className="text-text">VIZ</span>
      <span className="text-accent">IO</span>
      <span className="text-text">N</span>
    </span>
  );
}
