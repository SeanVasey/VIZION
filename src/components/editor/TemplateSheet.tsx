"use client";

import { Sheet } from "@/components/ui/Sheet";
import { MODE_LABEL } from "@/lib/constants";
import { PROMPT_TEMPLATES, type PromptTemplate } from "@/lib/enhance/templates";

/**
 * Starter prompts for an empty composer — the answer to the blank page.
 * Offered only when there is no draft to overwrite, so picking one can never
 * destroy work. Each seeds the editor AND the mode that suits it.
 */
export function TemplateSheet({
  open,
  onClose,
  onPick,
}: {
  open: boolean;
  onClose: () => void;
  onPick: (template: PromptTemplate) => void;
}) {
  return (
    <Sheet open={open} onClose={onClose} title="Start from a template">
      <div className="flex flex-col gap-2">
        {PROMPT_TEMPLATES.map((t) => (
          <button
            key={t.id}
            type="button"
            onClick={() => {
              onPick(t);
              onClose();
            }}
            className="glass hover-hair flex min-h-[44px] flex-col items-start gap-0.5 rounded-xl px-4 py-3 text-left transition-colors"
          >
            <span className="font-body flex w-full items-center justify-between gap-2 text-sm text-text">
              {t.title}
              <span className="shrink-0 text-xs text-accent">{MODE_LABEL[t.mode]}</span>
            </span>
            <span className="font-body text-xs text-silver">{t.hint}</span>
          </button>
        ))}
      </div>
    </Sheet>
  );
}
