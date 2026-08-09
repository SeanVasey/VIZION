"use client";

import { useState, useTransition } from "react";
import { usePathname, useRouter } from "next/navigation";
import { Sheet } from "@/components/ui/Sheet";
import { useToast } from "@/components/ui/Toast";
import { usePressable } from "@/components/ui/use-pressable";
import { useUIStore } from "@/stores/ui";
import { saveDraftAction } from "@/lib/drafts/actions";
import { showsNewPromptFab } from "./visibility";
import { useKeyboardVisible } from "./use-keyboard-visible";

/**
 * "New prompt" — a floating action button on Library and Settings that takes
 * the user back to an empty composer.
 *
 * It is only on those two surfaces: /enhance already owns this action (the
 * composer's own Clear), and a second control for it there would compete.
 *
 * WHY IT ASKS. The composer draft persists, so "start a new prompt" is
 * destructive whenever there is text in it. Rather than wipe it, or wipe-then-
 * offer-undo (a toast the user may never see on the page they just left), the
 * button offers the choice the situation actually poses: keep this work in the
 * account, or throw it away. With an empty composer there is nothing to lose,
 * so it skips straight to /enhance — no dialog in front of a one-tap action
 * that cannot cost anything.
 *
 * The local draft is cleared ONLY after a save reports ok. A failed save that
 * still cleared would destroy the work the user just asked to keep, which is
 * the worst outcome available here; `unavailable` (drafts migration pending) is
 * treated as exactly that kind of failure.
 *
 * Surface: a frosted Laser lens (`.fab-glass`) rather than a solid fill. It is
 * the only Laser fill that floats OVER content instead of sitting in the flow,
 * so it is the only one that can hide something — 82% over a saturated blur
 * lets the covered card read as tone while the accent stays the loudest thing
 * on the screen. The measurements behind that number are on the CSS rule.
 *
 * Position: the token-driven lane every other floating element uses
 * (`--bottom-nav-h` + the home-indicator inset), so clearance tracks the nav by
 * construction rather than by a duplicated magic number. It shares that lane
 * with Toast, which sits at z-[80] and will cover the button for the few
 * seconds a toast is up — accepted, because in this button's own flow the page
 * has already changed and the FAB is unmounted.
 *
 * Hidden while the software keyboard is up, for the reason BottomNav slides
 * away: iOS anchors fixed chrome to the layout viewport, so it would otherwise
 * float mid-screen over the content being typed into.
 */
export function NewPromptFab() {
  const pathname = usePathname();
  const router = useRouter();
  const { toast } = useToast();
  const keyboardVisible = useKeyboardVisible();
  const { pressed, handlers } = usePressable();

  const editorDraft = useUIStore((s) => s.editorDraft);
  const setEditorDraft = useUIStore((s) => s.setEditorDraft);
  const targetModel = useUIStore((s) => s.targetModel);
  const activeMode = useUIStore((s) => s.activeMode);
  const thinkingLevels = useUIStore((s) => s.thinkingLevels);

  const [askOpen, setAskOpen] = useState(false);
  const [pending, startAction] = useTransition();

  if (!showsNewPromptFab(pathname)) return null;

  const hasDraft = editorDraft.trim() !== "";

  function start() {
    if (hasDraft) {
      setAskOpen(true);
      return;
    }
    router.push("/enhance");
  }

  function saveThenStart() {
    startAction(async () => {
      const res = await saveDraftAction({
        body: editorDraft,
        target: targetModel,
        mode: activeMode,
        thinkingLevel: thinkingLevels[targetModel] ?? null,
      });
      if (!res.ok) {
        // Keep the draft and keep the sheet open — the user asked to preserve
        // this, and clearing it now would destroy exactly what they saved for.
        toast({
          text: res.unavailable
            ? "Drafts aren't set up on the server yet — your draft is untouched."
            : (res.error ?? "Couldn't save that draft."),
          tone: "error",
        });
        return;
      }
      setEditorDraft("");
      setAskOpen(false);
      toast({ text: "Draft saved to your library" });
      router.push("/enhance");
    });
  }

  function discardThenStart() {
    startAction(async () => {
      const discarded = editorDraft;
      setEditorDraft("");
      setAskOpen(false);
      // Undoable: discarding typed work on a one-tap path deserves a way back,
      // and unlike the save path there is no server copy to fall back on.
      toast({
        text: "Draft discarded",
        action: { label: "Undo", onAction: () => setEditorDraft(discarded) },
      });
      router.push("/enhance");
    });
  }

  return (
    <>
      <button
        type="button"
        onClick={start}
        aria-label="New prompt"
        data-pressed={pressed || undefined}
        {...handlers}
        inert={keyboardVisible || undefined}
        className={[
          // btn-laser is --on-laser ink on a Laser fill, never the reverse
          // (§6). rounded-full wins over its 12px radius because utilities
          // layer after components.
          //
          // fab-glass frosts that fill to 82% over a saturated blur, and owns
          // the depth shadow the class list used to carry as a `shadow-[…]`
          // utility. That move is load-bearing, not tidying: a utility-layer
          // box-shadow beat the base-layer :focus-visible ring at equal
          // specificity, so this button had no keyboard focus indicator at
          // all. `.fab-glass:focus-visible` composes the ring back in front
          // of the shadow.
          "pressable btn-laser fab-glass fixed z-40 flex h-14 w-14 items-center justify-center rounded-full",
          "transition-opacity duration-200 motion-reduce:transition-none",
          keyboardVisible ? "pointer-events-none opacity-0" : "opacity-100",
        ].join(" ")}
        style={{
          bottom:
            "calc(var(--bottom-nav-h) + env(safe-area-inset-bottom, 0px) + var(--float-gap))",
          // Anchored to the APP COLUMN's trailing edge, not the viewport
          // corner: every other floating surface (sheets, side pickers) holds
          // the max-w-screen-sm column, and `right-4` left this button 248px
          // into empty canvas at 1280px (audit VAR-14). Below 640px the max()
          // resolves to the original 1rem, so phones are untouched.
          right: "max(1rem, calc((100vw - 640px) / 2 + 1rem))",
        }}
      >
        {/* Plus on a 24px grid, 1.5px stroke, rounded caps (style-guide §1.4). */}
        <svg viewBox="0 0 24 24" fill="none" aria-hidden="true" className="h-7 w-7">
          <path
            d="M12 5v14M5 12h14"
            stroke="currentColor"
            strokeWidth="1.5"
            strokeLinecap="round"
          />
        </svg>
      </button>

      <Sheet
        open={askOpen}
        onClose={() => setAskOpen(false)}
        title="Save this draft?"
        footer={
          <div className="flex flex-col gap-2">
            <button
              type="button"
              onClick={saveThenStart}
              disabled={pending}
              className="btn-laser flex min-h-[44px] w-full items-center justify-center px-5 text-sm"
            >
              {pending ? "Saving…" : "Save draft"}
            </button>
            <button
              type="button"
              onClick={discardThenStart}
              disabled={pending}
              className="btn-secondary flex min-h-[44px] w-full items-center justify-center px-5 text-sm text-flare disabled:opacity-50"
            >
              Discard
            </button>
            <button
              type="button"
              onClick={() => setAskOpen(false)}
              disabled={pending}
              className="tap-44 font-body w-full text-sm text-silver transition-colors hover:text-chalk disabled:opacity-50"
            >
              Cancel
            </button>
          </div>
        }
      >
        <p className="font-body text-sm text-muted">
          Your composer has a prompt in progress. Save it to your library to come back to
          it, or discard it and start fresh.
        </p>
      </Sheet>
    </>
  );
}
