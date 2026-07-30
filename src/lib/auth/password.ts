/**
 * The account password rule — one definition for the server action, both forms,
 * and the copy that tells the user what is expected.
 *
 * WHY THIS MODULE EXISTS. The rule was the literal `8` in four places: a
 * `MIN_PASSWORD` const in `(auth)/actions.ts` and three `minLength={8}`
 * attributes across `SetPasswordForm` and `SettingsPanel`. Raising it meant
 * finding all four, and a miss would show up as a form that accepts a password
 * the server then rejects — or worse, an input that quietly permits less than
 * the server requires.
 *
 * WHY IT IS NOT DIY AUTH (§6). Supabase Auth still owns the credential: it
 * hashes and stores the password and issues the session. This is input
 * validation in front of `supabase.auth.updateUser` — the same category as
 * checking that the two fields match.
 *
 * WHY LENGTH *AND* CLASSES. Length does the real work; the classes are here
 * because the project cannot use Supabase's leaked-password check, which is the
 * defence that actually matters against credential stuffing and is gated behind
 * the Pro plan (org is on Free, 2026-07-30). Worth knowing that NIST SP 800-63B
 * §5.1.1.2 recommends against mandatory composition rules and for a breach-list
 * check instead — so if this project moves to Pro, enabling
 * "Prevent the use of leaked passwords" in Auth → Providers → Email is a
 * strictly better control than CLASS_CHECKS, and these can be relaxed.
 *
 * This governs SETTING or CHANGING a password. Existing passwords are untouched
 * and keep working; nobody is locked out by a rule change.
 */

/** Minimum length. Anything under 8 is explicitly not recommended by Supabase;
 *  12 is the owner's choice (2026-07-30) given no breach-list check available. */
export const MIN_PASSWORD_LENGTH = 12;

/**
 * Required character classes. Symbols are deliberately NOT required — they are
 * the class most likely to push someone into a predictable `Password1!` shape,
 * and this trio already matches Supabase's "digits, lowercase and uppercase"
 * tier. Symbols are of course allowed and count toward length.
 */
const CLASS_CHECKS: { test: RegExp; label: string }[] = [
  { test: /[a-z]/, label: "a lowercase letter" },
  { test: /[A-Z]/, label: "an uppercase letter" },
  { test: /[0-9]/, label: "a number" },
];

/** The rule as one sentence, for helper text under the inputs. */
export const PASSWORD_RULE_TEXT =
  `At least ${MIN_PASSWORD_LENGTH} characters, including a lowercase letter, ` +
  `an uppercase letter and a number.`;

/**
 * `null` when acceptable, otherwise a sentence to show the user.
 *
 * Length is reported before classes: telling someone their 6-character password
 * needs an uppercase letter buries the thing they have to fix. Missing classes
 * are reported together for the same reason — one round trip, not three.
 *
 * NOT trimmed. Leading and trailing spaces are legitimate password characters
 * and Supabase stores them verbatim; trimming here would accept a password the
 * user cannot then type back.
 */
export function validatePassword(password: string): string | null {
  if (password.length < MIN_PASSWORD_LENGTH) {
    return `Use at least ${MIN_PASSWORD_LENGTH} characters.`;
  }
  const missing = CLASS_CHECKS.filter((c) => !c.test.test(password)).map((c) => c.label);
  if (missing.length === 0) return null;
  const list =
    missing.length === 1
      ? missing[0]
      : `${missing.slice(0, -1).join(", ")} and ${missing[missing.length - 1]}`;
  return `Add ${list}.`;
}
