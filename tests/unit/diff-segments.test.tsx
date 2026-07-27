import { describe, expect, it } from "vitest";
import { render } from "@testing-library/react";
import {
  ComparisonSegments,
  InputSegments,
  OutputSegments,
  REMOVED_CLASS,
} from "@/components/diff/segments";
import type { DiffSegment } from "@/lib/enhance/diff";

const SEGMENTS: DiffSegment[] = [
  { op: "equal", text: "write a " },
  { op: "removed", text: "quick " },
  { op: "added", text: "concise " },
  { op: "equal", text: "summary" },
];

describe("removed text reads as removal, everywhere it is shown", () => {
  it("uses Flare + strikethrough — the token that darkens on light themes", () => {
    expect(REMOVED_CLASS).toContain("text-flare");
    expect(REMOVED_CLASS).toContain("line-through");
  });

  it("styles removals in the input side", () => {
    const { container } = render(<InputSegments segments={SEGMENTS} />);
    const removed = container.querySelector(".text-flare");
    expect(removed?.textContent).toBe("quick ");
  });

  it("styles removals in a two-sided comparison", () => {
    const { container } = render(<ComparisonSegments segments={SEGMENTS} />);
    expect(container.querySelector(".text-flare")?.textContent).toBe("quick ");
    expect(container.querySelector(".text-accent")?.textContent).toBe("concise ");
  });
});

describe("ComparisonSegments reconstructs both sides losslessly", () => {
  it("shows every segment — nothing is hidden in a comparison", () => {
    const { container } = render(<ComparisonSegments segments={SEGMENTS} />);
    expect(container.textContent).toBe("write a quick concise summary");
  });

  it("renders equal text unstyled", () => {
    const { container } = render(
      <ComparisonSegments segments={[{ op: "equal", text: "plain" }]} />,
    );
    expect(container.querySelector(".text-flare")).toBeNull();
    expect(container.querySelector(".text-accent")).toBeNull();
  });
});

describe("OutputSegments still hides removals by default", () => {
  it("shows the result, not the proof — that is the Enhanced card's job", () => {
    const { container } = render(<OutputSegments segments={SEGMENTS} />);
    expect(container.textContent).toBe("write a concise summary");
  });

  it("restores removed text when its hunk is rejected", () => {
    const hunkOf = [null, 0, 0, null];
    const { container } = render(
      <OutputSegments segments={SEGMENTS} hunkOf={hunkOf} rejected={new Set([0])} />,
    );
    expect(container.textContent).toBe("write a quick summary");
  });
});
