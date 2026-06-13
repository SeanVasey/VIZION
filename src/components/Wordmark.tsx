/**
 * The VIZ(IO)N wordmark — the (IO) aperture (product-spec §1.1).
 * V Z N in Chalk; the brackets a thin Silver aperture ring; I O in Laser,
 * the I an input bar, the O an output ring, with a hairline lime caret between.
 */
export function Wordmark({ className = "" }: { className?: string }) {
  return (
    <span
      className={`font-display tracking-wide ${className}`}
      aria-label="VIZ(IO)N"
      role="img"
    >
      <span className="text-text">VIZ</span>
      <span className="text-silver" aria-hidden="true">
        (
      </span>
      <span className="text-laser">I</span>
      <span className="text-laser opacity-80" aria-hidden="true">
        ›
      </span>
      <span className="text-laser">O</span>
      <span className="text-silver" aria-hidden="true">
        )
      </span>
      <span className="text-text">N</span>
    </span>
  );
}
