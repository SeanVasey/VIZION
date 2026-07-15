import Link from "next/link";
import { ScreenHeader } from "@/components/ScreenHeader";

/**
 * Branded 404 — notFound() (e.g. a mistyped or foreign /library/<id>, which
 * RLS makes look absent) previously fell through to Next's default unstyled
 * screen inside the locked-design shell.
 */
export default function NotFound() {
  return (
    <>
      <ScreenHeader title="Not found" />
      <div className="mx-auto flex max-w-screen-sm flex-col px-4 py-5">
        <div className="glass rounded-2xl p-6 text-center">
          <p className="font-display text-balance text-xl tracking-wide text-text">
            Nothing at this address
          </p>
          <p className="font-body mt-2 text-sm text-muted">
            The page may have been deleted, or the link may be someone
            else&apos;s. Your library and prompts are untouched.
          </p>
          <Link
            href="/enhance"
            className="btn-secondary pill mx-auto mt-5 inline-flex min-h-[44px] items-center justify-center px-5 text-sm"
          >
            Back to Enhance
          </Link>
        </div>
      </div>
    </>
  );
}
