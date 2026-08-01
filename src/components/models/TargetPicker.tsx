"use client";

import { useMemo, useRef, useState } from "react";
import { Sheet } from "@/components/ui/Sheet";
import { CheckGlyph } from "@/components/ui/CheckGlyph";
import { useRovingRadios } from "@/components/models/use-roving-radios";
import { DeveloperIcon } from "@/components/models/DeveloperIcon";
import {
  DEVELOPER_LABEL,
  DEVELOPER_ORDER,
  TARGET_DEVELOPER,
  TARGET_MODELS,
  type Developer,
  type TargetModelId,
} from "@/lib/constants";

/**
 * Model target picker — trigger + grouped sheet.
 *
 * Replaces the native `<select>` on both surfaces that pick a model. A native
 * select can't render the developer marks (an `<option>` takes text only), so
 * sixteen models across twelve developers arrived as one flat alphabet-soup
 * list with the mark stranded outside on the control's edge, describing only
 * whichever row happened to be selected. Grouping is the whole point: the
 * roster is *already* ordered by developer (`DEVELOPER_ORDER`, contiguity
 * test-pinned), so the headers make a structure that was always there visible.
 *
 * Leaving `<select>` also leaves the scope of the iOS 16px rule — it targets
 * `input, select, textarea` — so the trigger can honestly render at `text-sm`
 * without tripping focus-zoom. The Sheet primitive supplies the portal, focus
 * trap, Escape, and scroll lock.
 */

type TargetModel = (typeof TARGET_MODELS)[number];

/** Models grouped under their developer, in roster order. Computed once: the
 *  roster is a frozen literal, so this can never go stale at runtime. A
 *  developer with no models is dropped rather than rendered as an empty
 *  header — DEVELOPER_ORDER is allowed to run ahead of the roster. */
const GROUPS: { developer: Developer; models: TargetModel[] }[] = DEVELOPER_ORDER.map(
  (developer) => ({
    developer,
    models: TARGET_MODELS.filter((m): m is TargetModel => m.developer === developer),
  }),
).filter((g) => g.models.length > 0);

const LABEL_BY_ID = new Map(TARGET_MODELS.map((m) => [m.id, m.label]));

/** Display label for a target id — falls back to the raw id so a legacy or
 *  unknown persisted value still renders as *something* rather than blank. */
export function targetLabel(id: TargetModelId): string {
  return LABEL_BY_ID.get(id) ?? id;
}

export function TargetPicker({
  value,
  onChange,
  label,
  triggerClassName,
  disabled,
  auto,
  onAutoChange,
}: {
  value: TargetModelId;
  onChange: (next: TargetModelId) => void;
  /** Accessible name for the trigger, e.g. "Target model". */
  label: string;
  triggerClassName?: string;
  disabled?: boolean;
  /**
   * Auto routing. Pass BOTH to offer it — omitting them hides the row
   * entirely, which is how Settings keeps `profiles.default_model` a real
   * enum id. "auto" is never a value of `value`; it sits beside it.
   */
  auto?: boolean;
  onAutoChange?: (next: boolean) => void;
}) {
  const [open, setOpen] = useState(false);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const developer = TARGET_DEVELOPER[value];
  const offersAuto = onAutoChange !== undefined;

  return (
    <>
      <button
        ref={triggerRef}
        type="button"
        disabled={disabled}
        aria-haspopup="dialog"
        aria-expanded={open}
        onClick={() => setOpen(true)}
        className={
          triggerClassName ??
          "font-body inline-flex min-h-[44px] items-center gap-2 rounded-full bg-surface py-1.5 pl-3 pr-2.5 text-sm text-text"
        }
      >
        <span className="sr-only">{label}: </span>
        {auto ? (
          <AutoGlyph className="h-4 w-4 text-accent" />
        ) : (
          developer && <DeveloperIcon developer={developer} className="h-4 w-4 text-accent" />
        )}
        {/* `grow` so a full-width trigger (Settings) pushes the chevron to the
            right edge; in a content-width pill (composer) it is a no-op. */}
        <span className="grow truncate text-left">
          {auto ? "Auto" : targetLabel(value)}
        </span>
        <svg aria-hidden="true" viewBox="0 0 24 24" className="h-4 w-4 shrink-0 text-silver">
          <path
            d="M8 10l4 4 4-4"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.75"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </svg>
      </button>
      <TargetPickerSheet
        open={open}
        onClose={() => setOpen(false)}
        title={label}
        value={value}
        auto={offersAuto ? (auto ?? false) : undefined}
        onPickAuto={
          onAutoChange &&
          (() => {
            onAutoChange(true);
            setOpen(false);
          })
        }
        onPick={(next) => {
          // Picking a model explicitly is also how you leave Auto — there is
          // no separate "turn it off", because choosing one IS turning it off.
          onAutoChange?.(false);
          onChange(next);
          setOpen(false);
        }}
      />
    </>
  );
}

function TargetPickerSheet({
  open,
  onClose,
  title,
  value,
  onPick,
  auto,
  onPickAuto,
}: {
  open: boolean;
  onClose: () => void;
  title: string;
  value: TargetModelId;
  onPick: (next: TargetModelId) => void;
  auto?: boolean;
  onPickAuto?: () => void;
}) {
  const selectedRef = useRef<HTMLButtonElement>(null);
  // Open on the current pick rather than the top of a sixteen-row list.
  const initialFocus = useMemo(() => selectedRef, []);
  // The radio roles promise arrow keys (A11Y-002). Picking closes the sheet,
  // so arrows move FOCUS only; Enter/Space activates.
  const flatIds = useMemo(
    () => [
      ...(onPickAuto ? ["__auto__"] : []),
      ...GROUPS.flatMap((g) => g.models.map((m) => m.id)),
    ],
    [onPickAuto],
  );
  const roving = useRovingRadios(
    flatIds.length,
    auto ? 0 : flatIds.indexOf(value),
  );

  return (
    <Sheet open={open} onClose={onClose} title={title} initialFocusRef={initialFocus}>
      <div
        role="radiogroup"
        aria-label={title}
        className="flex flex-col gap-4"
        onKeyDown={roving.onKeyDown}
      >
        {onPickAuto && (
          // Above the developer groups and outside them: Auto is not a model,
          // it is the decision not to pick one. Giving it its own section
          // keeps it out of any developer's list, where it would read as a
          // product they ship.
          <section className="flex flex-col gap-1">
            <div className="glass overflow-hidden rounded-xl">
              <button
                {...roving.radioProps(0, auto ? selectedRef : undefined)}
                type="button"
                role="radio"
                aria-checked={auto ?? false}
                onClick={onPickAuto}
                className="font-body flex min-h-[44px] w-full items-center gap-3 px-4 text-left text-sm text-text transition-colors hover-hair"
              >
                <AutoGlyph className="h-4 w-4 shrink-0 text-accent" />
                <span className="grow">
                  Auto
                  <span className="block text-xs text-silver">
                    Picks a model to suit the mode and length
                  </span>
                </span>
                {auto && <CheckGlyph />}
              </button>
            </div>
          </section>
        )}
        {GROUPS.map((group) => (
          <section key={group.developer} className="flex flex-col gap-1">
            <p className="font-body px-1 text-[0.625rem] uppercase tracking-[0.18em] text-silver">
              {DEVELOPER_LABEL[group.developer]}
            </p>
            <div className="glass flex flex-col divide-y divide-hair overflow-hidden rounded-xl">
              {group.models.map((m) => {
                // Under Auto no model row is the pick — the Auto row is. The
                // fallback id must not render as if the user had chosen it.
                const active = m.id === value && !auto;
                return (
                  <button
                    key={m.id}
                    {...roving.radioProps(
                      flatIds.indexOf(m.id),
                      active ? selectedRef : undefined,
                    )}
                    type="button"
                    role="radio"
                    aria-checked={active}
                    onClick={() => onPick(m.id)}
                    className="font-body flex min-h-[44px] items-center gap-3 px-4 text-left text-sm text-text transition-colors hover-hair"
                  >
                    <DeveloperIcon
                      developer={group.developer}
                      className="h-4 w-4 shrink-0 text-accent"
                    />
                    <span className="grow truncate">{m.label}</span>
                    {active && <CheckGlyph />}
                  </button>
                );
              })}
            </div>
          </section>
        ))}
      </div>
    </Sheet>
  );
}

/** Auto's mark. Deliberately not any developer's glyph — Auto is the decision
 *  not to pick one, so borrowing a vendor mark would misdescribe it. Two
 *  converging paths: several models, one route. */
function AutoGlyph({ className }: { className?: string }) {
  return (
    <svg aria-hidden="true" viewBox="0 0 24 24" className={className}>
      <path
        d="M4 6h4c4 0 4 12 8 12h4M4 18h4c4 0 4-12 8-12h4"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.75"
        strokeLinecap="round"
      />
    </svg>
  );
}
