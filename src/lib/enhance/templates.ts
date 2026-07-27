import type { ModeId } from "@/lib/constants";

/**
 * Starter prompts for the blank page.
 *
 * Deliberately static: no DB, no network, no personalization. These are
 * seeds a user edits, not finished prompts — each one is deliberately
 * under-specified in the way a real first draft is, so the enhancement has
 * something to actually do. The paired mode is the one that best fits the
 * shape of the seed.
 */
export interface PromptTemplate {
  id: string;
  /** Shown in the picker. */
  title: string;
  /** One line on when to reach for it. */
  hint: string;
  mode: ModeId;
  text: string;
}

export const PROMPT_TEMPLATES: readonly PromptTemplate[] = [
  {
    id: "explain",
    title: "Explain a concept",
    hint: "Teach me something, pitched at a level",
    mode: "expand",
    text: "Explain how database indexes work to someone who writes SQL but has never tuned a query.",
  },
  {
    id: "code-review",
    title: "Review some code",
    hint: "Ask for a critique with priorities",
    mode: "expand",
    text: "Review this function and tell me what's wrong with it.",
  },
  {
    id: "rewrite-tone",
    title: "Rewrite in a different tone",
    hint: "Same content, different register",
    mode: "reformat",
    text: "Rewrite this announcement so it sounds warmer and less corporate.",
  },
  {
    id: "summarize",
    title: "Summarize a long document",
    hint: "Say what kind of summary you want",
    mode: "clarify",
    text: "Summarize this report.",
  },
  {
    id: "brainstorm",
    title: "Brainstorm options",
    hint: "Generate alternatives with constraints",
    mode: "expand",
    text: "Give me some ideas for names for a prompt-engineering app.",
  },
  {
    id: "image",
    title: "Describe an image to generate",
    hint: "Turn a rough visual idea into a prompt",
    mode: "target",
    text: "A lighthouse at dusk, dramatic and moody.",
  },
  {
    id: "extract",
    title: "Extract structured data",
    hint: "Pull fields out of messy text",
    mode: "reformat",
    text: "Pull the names, dates, and amounts out of this text and give me a table.",
  },
  {
    id: "debug",
    title: "Debug an error",
    hint: "Get a diagnosis, not just a guess",
    mode: "clarify",
    text: "My build fails with a module-not-found error. What's wrong?",
  },
] as const;
