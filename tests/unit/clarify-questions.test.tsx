import { beforeEach, describe, expect, it, vi } from "vitest";
import { act, fireEvent, render, screen } from "@testing-library/react";
import { ToastProvider } from "@/components/ui/Toast";
import { useUIStore } from "@/stores/ui";
import { useEnhanceViewStore } from "@/stores/enhance-view";
import {
  buildSystemPrompt,
  parseEnhancePayload,
  refineUserBlock,
} from "@/lib/providers/formatters";
import { MODES } from "@/lib/constants";
import type { EnhanceRequest } from "@/lib/enhance/use-enhance";

const mockMutation = {
  isPending: false,
  isError: false as boolean,
  error: null as unknown,
  stream: {
    active: false,
    step: "waiting",
    partialOutput: "",
    tokenIn: 0,
    tokenOut: 0,
    costUsd: 0,
  },
  mutate: vi.fn(),
  reset: vi.fn(),
};
vi.mock("@/lib/enhance/use-enhance", () => ({ useEnhance: () => mockMutation }));
vi.mock("@/components/media/AttachmentTray", () => ({ AttachmentTray: () => null }));

import { EnhanceComposer } from "@/components/editor/EnhanceComposer";

const envelope = (extra: Record<string, unknown>) =>
  JSON.stringify({ output: "sharpened", rationale: "why", ...extra });

describe("questions in the envelope", () => {
  it("parses a clean list", () => {
    const p = parseEnhancePayload(envelope({ questions: ["Who for?", "How long?"] }));
    expect(p.questions).toEqual(["Who for?", "How long?"]);
  });

  it("keeps output required — questions never substitute for it", () => {
    // The whole design rests on this: the model answers AND may ask. If a
    // questions field could stand in for output, the contract would become
    // negotiable and a paid run could return nothing usable.
    expect(() => parseEnhancePayload(JSON.stringify({ questions: ["?"] }))).toThrow(
      /missing the expected fields/i,
    );
  });

  it("applies the assumptions tolerance exactly", () => {
    const p = parseEnhancePayload(
      envelope({ questions: ["  spaced  ", "", 42, null, "kept"] }),
    );
    expect(p.questions).toEqual(["spaced", "kept"]);
  });

  it("caps at three — a person has to answer these by hand", () => {
    const p = parseEnhancePayload(
      envelope({ questions: ["a", "b", "c", "d", "e", "f"] }),
    );
    expect(p.questions).toHaveLength(3);
  });

  it("omits the key rather than carrying an empty array", () => {
    expect(parseEnhancePayload(envelope({ questions: [] })).questions).toBeUndefined();
    expect(
      parseEnhancePayload(envelope({ questions: ["", "  "] })).questions,
    ).toBeUndefined();
  });

  it("is never fatal when malformed", () => {
    // A junk questions field must not cost the user an otherwise-valid run.
    for (const junk of ["not an array", 5, {}, null]) {
      const p = parseEnhancePayload(envelope({ questions: junk }));
      expect(p.output).toBe("sharpened");
      expect(p.questions).toBeUndefined();
    }
  });
});

describe("the questions contract in the system prompt", () => {
  it("is offered to clarify", () => {
    const prompt = buildSystemPrompt({ mode: "clarify", target: "opus_5" });
    expect(prompt).toContain('"questions" (optional, array of strings)');
    expect(prompt).toContain('NEVER replaces "output"');
  });

  it.each(MODES.filter((m) => m.id !== "clarify").map((m) => m.id))(
    "is not offered to %s",
    (mode) => {
      // Only Clarify's job is resolving ambiguity; inviting questions from
      // Polish or Condense would be asking for scope the mode can't act on.
      const prompt = buildSystemPrompt({ mode, target: "opus_5" });
      expect(prompt).not.toContain('"questions" (optional');
    },
  );

  it("tells the answered pass it is holding the ORIGINAL, not an output", () => {
    // Its three siblings all say "the input you receive is an already-enhanced
    // prompt", which is false here — copying that framing would misdescribe
    // what the model is looking at.
    const prompt = buildSystemPrompt({
      mode: "clarify",
      target: "opus_5",
      refine: { kind: "answers", baseInput: "Q: a\nA: b" },
    });
    expect(prompt).toContain("author's ORIGINAL request");
    expect(prompt).not.toContain(
      "ANSWERED PASS: The input you receive is an already-enhanced prompt",
    );
    // The Q&A rides the USER message now (SEC-003), fenced there — not the
    // privileged system role.
    const block = refineUserBlock({ kind: "answers", baseInput: "Q: a\nA: b" });
    expect(block).toContain("<answers>");
    expect(block).toContain("Q: a\nA: b");
    expect(prompt).not.toContain("Q: a\nA: b");
  });

  it("forbids a second round of questions on the answered pass", () => {
    const prompt = buildSystemPrompt({
      mode: "clarify",
      target: "opus_5",
      refine: { kind: "answers", baseInput: "Q: a\nA: b" },
    });
    expect(prompt).toContain("do not return a `questions` field");
  });
});

// --- The card and its re-run -------------------------------------------------

function renderComposer() {
  return render(
    <ToastProvider>
      <EnhanceComposer />
    </ToastProvider>,
  );
}

const BASE_RESULT = {
  output: "sharpened output",
  rationale: "why",
  diff: [{ op: "equal" as const, text: "sharpened output" }],
  tokenIn: 1,
  tokenOut: 1,
  modelUsed: "claude-opus-5",
  costUsd: 0.001,
  usage: { todayCost: 0.001, capUsd: 5 },
};

function runAndSettle(result: Record<string, unknown>) {
  fireEvent.change(screen.getByLabelText("Prompt input"), {
    target: { value: "make it better somehow" },
  });
  fireEvent.click(screen.getByRole("button", { name: /enhance/i }));
  const opts = mockMutation.mutate.mock.calls.at(-1)![1] as {
    onSuccess: (r: unknown) => void;
  };
  act(() => opts.onSuccess(result));
}

beforeEach(() => {
  vi.clearAllMocks();
  // The view store is a module singleton — a result set by one test must not
  // leak into the next as a pre-mounted result view.
  useEnhanceViewStore.setState({ view: null });
  useUIStore.setState({
    editorDraft: "",
    activeMode: "clarify",
    targetModel: "opus_5",
    autoTarget: false,
    lengthByMode: {},
    reformatFormat: null,
  });
});

describe("the questions card", () => {
  it("is absent when the model asked nothing", () => {
    renderComposer();
    runAndSettle(BASE_RESULT);
    expect(screen.queryByText(/Questions that would sharpen this/i)).toBeNull();
  });

  it("renders one input per question", () => {
    renderComposer();
    runAndSettle({ ...BASE_RESULT, questions: ["Who is it for?", "How long?"] });
    expect(screen.getByText(/Questions that would sharpen this/i)).toBeTruthy();
    expect(screen.getByLabelText(/Who is it for\?/)).toBeTruthy();
    expect(screen.getByLabelText(/How long\?/)).toBeTruthy();
  });

  it("keeps the enhancement — questions are an offer, not a blocker", () => {
    // The model already did the work; the card asks how to do it better.
    renderComposer();
    runAndSettle({ ...BASE_RESULT, questions: ["Who for?"] });
    expect(screen.getAllByText(/sharpened output/).length).toBeGreaterThan(0);
  });

  it("adds no second role=status to the result view", () => {
    // result-view.test.tsx queries getByRole("status") SINGULAR; a second one
    // would break a test that has nothing to do with this feature.
    renderComposer();
    runAndSettle({ ...BASE_RESULT, questions: ["Who for?"] });
    expect(screen.queryAllByRole("status").length).toBeLessThanOrEqual(1);
  });

  it("won't re-run until something is answered", () => {
    renderComposer();
    runAndSettle({ ...BASE_RESULT, questions: ["Who for?"] });
    const button = screen.getByRole("button", { name: /answer & re-run/i });
    expect(button.hasAttribute("disabled")).toBe(true);
    expect(screen.getByText(/Answer at least one question/i)).toBeTruthy();
  });

  it("says plainly that re-running costs another run", () => {
    renderComposer();
    runAndSettle({ ...BASE_RESULT, questions: ["Who for?"] });
    fireEvent.change(screen.getByLabelText(/Who for\?/), {
      target: { value: "designers" },
    });
    expect(screen.getByText(/second billed run/i)).toBeTruthy();
  });

  it("re-runs the ORIGINAL request with the Q&A attached", () => {
    renderComposer();
    runAndSettle({ ...BASE_RESULT, questions: ["Who for?", "How long?"] });
    fireEvent.change(screen.getByLabelText(/Who for\?/), {
      target: { value: "designers" },
    });
    fireEvent.click(screen.getByRole("button", { name: /answer & re-run/i }));

    const req = mockMutation.mutate.mock.calls.at(-1)![0] as EnhanceRequest;
    // The author's own text, NOT the previous output — this is a redo of the
    // request, not a pass over the result.
    expect(req.input).toBe("make it better somehow");
    expect(req.refine?.kind).toBe("answers");
    expect(req.refine?.baseInput).toContain("Q: Who for?");
    expect(req.refine?.baseInput).toContain("A: designers");
    // An unanswered question is carried explicitly rather than dropped, so
    // the model knows it was asked and left open.
    expect(req.refine?.baseInput).toContain("(no answer given)");
  });

  it("keeps the diff labelled against the original after answering", () => {
    // The answered pass is not a refinement of an output, so the diff's input
    // side is still the author's text and must not say "previous result".
    renderComposer();
    runAndSettle({ ...BASE_RESULT, questions: ["Who for?"] });
    fireEvent.change(screen.getByLabelText(/Who for\?/), {
      target: { value: "designers" },
    });
    fireEvent.click(screen.getByRole("button", { name: /answer & re-run/i }));
    const opts = mockMutation.mutate.mock.calls.at(-1)![1] as {
      onSuccess: (r: unknown) => void;
    };
    act(() => opts.onSuccess(BASE_RESULT));
    expect(screen.queryByText(/previous result/i)).toBeNull();
  });
});
