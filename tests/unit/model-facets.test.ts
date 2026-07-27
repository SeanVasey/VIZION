import { describe, expect, it } from "vitest";
import { groupModelFacets } from "@/lib/library/model-facets";
import { DEVELOPER_LABEL, DEVELOPER_ORDER } from "@/lib/constants";

describe("groupModelFacets", () => {
  it("stays flat for an empty library", () => {
    expect(groupModelFacets([])).toBeNull();
  });

  it("stays flat when every prompt comes from one developer", () => {
    // Headers over a single-developer library repeat what the chips already
    // say, so the caller keeps its flat row.
    expect(
      groupModelFacets([
        { id: "opus_5", count: 9 },
        { id: "sonnet_5", count: 4 },
        { id: "fable_5", count: 1 },
      ]),
    ).toBeNull();
  });

  it("groups once a second developer appears", () => {
    const groups = groupModelFacets([
      { id: "opus_5", count: 9 },
      { id: "grok_4_5", count: 2 },
    ]);
    expect(groups).not.toBeNull();
    expect(groups!.map((g) => g.label)).toEqual([
      DEVELOPER_LABEL.anthropic,
      DEVELOPER_LABEL.xai,
    ]);
  });

  it("orders groups by DEVELOPER_ORDER, not by count", () => {
    // xAI has the bigger count but Anthropic is earlier in the locked order —
    // the picker and the chips must agree on developer order.
    const groups = groupModelFacets([
      { id: "grok_4_5", count: 40 },
      { id: "opus_5", count: 1 },
    ])!;
    const positions = groups.map((g) =>
      DEVELOPER_ORDER.indexOf(g.developer as (typeof DEVELOPER_ORDER)[number]),
    );
    expect(positions).toEqual([...positions].sort((a, b) => a - b));
  });

  it("keeps the query's count-descending order WITHIN a group", () => {
    const groups = groupModelFacets([
      { id: "opus_5", count: 9 },
      { id: "sonnet_5", count: 4 },
      { id: "fable_5", count: 1 },
      { id: "grok_4_5", count: 2 },
    ])!;
    const anthropic = groups.find((g) => g.developer === "anthropic")!;
    expect(anthropic.models.map((m) => m.id)).toEqual([
      "opus_5",
      "sonnet_5",
      "fable_5",
    ]);
  });

  it("carries the label and developer each chip needs", () => {
    const groups = groupModelFacets([
      { id: "opus_5", count: 2 },
      { id: "kimi_k3", count: 1 },
    ])!;
    const all = groups.flatMap((g) => g.models);
    expect(all.find((m) => m.id === "opus_5")).toMatchObject({
      label: "Opus 5",
      developer: "anthropic",
      count: 2,
    });
  });

  it("keeps a retired model filterable, under Other, last", () => {
    // A renamed-away id leaves real saved prompts behind. Dropping its facet
    // would make those prompts unreachable by the model filter.
    const groups = groupModelFacets([
      { id: "opus_5", count: 3 },
      { id: "gpt_5_5", count: 2 },
    ])!;
    expect(groups[groups.length - 1]).toMatchObject({
      developer: null,
      label: "Other",
    });
    expect(groups[groups.length - 1]!.models.map((m) => m.id)).toEqual(["gpt_5_5"]);
  });

  it("labels an unknown id with the raw id rather than nothing", () => {
    const groups = groupModelFacets([
      { id: "opus_5", count: 1 },
      { id: "some_retired_model", count: 1 },
    ])!;
    const other = groups.find((g) => g.developer === null)!;
    expect(other.models[0]!.label).toBe("some_retired_model");
  });

  it("never drops or duplicates a facet", () => {
    const input = [
      { id: "opus_5", count: 3 },
      { id: "grok_4_5", count: 2 },
      { id: "kimi_k3", count: 1 },
      { id: "gpt_5_5", count: 1 },
    ];
    const flat = groupModelFacets(input)!.flatMap((g) => g.models);
    expect(flat.map((m) => m.id).sort()).toEqual(input.map((m) => m.id).sort());
  });
});
