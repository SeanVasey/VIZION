/**
 * The "this is the chosen row" mark, shared by every picker sheet.
 *
 * A checkmark, not a filled dot: the row is a choice in a list, and iOS marks
 * the chosen one this way. It lives here rather than inside one picker because
 * the Target and Thinking sheets stack the same kind of list — a mark that
 * drifted between them would read as two different controls.
 */
export function CheckGlyph() {
  return (
    <svg aria-hidden="true" viewBox="0 0 24 24" className="h-5 w-5 shrink-0 text-accent">
      <path
        d="M5 12.5l4.5 4.5L19 7.5"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}
