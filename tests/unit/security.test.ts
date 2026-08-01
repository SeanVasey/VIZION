import { describe, it, expect } from "vitest";
import { rateLimit } from "@/lib/security/rate-limit";
import { MAX_OUTBOX_ATTEMPTS, flushOutbox, type OutboxItem, type OutboxStore } from "@/lib/pwa/outbox";

describe("rateLimit", () => {
  it("allows up to the limit, then blocks within the window", () => {
    const store = new Map();
    const now = 1000;
    expect(rateLimit("k", 2, 1000, now, store).allowed).toBe(true);
    expect(rateLimit("k", 2, 1000, now, store).allowed).toBe(true);
    const blocked = rateLimit("k", 2, 1000, now, store);
    expect(blocked.allowed).toBe(false);
    expect(blocked.remaining).toBe(0);
  });

  it("resets after the window elapses", () => {
    const store = new Map();
    rateLimit("k", 1, 1000, 0, store);
    expect(rateLimit("k", 1, 1000, 500, store).allowed).toBe(false);
    expect(rateLimit("k", 1, 1000, 1000, store).allowed).toBe(true);
  });

  it("keys are independent", () => {
    const store = new Map();
    rateLimit("a", 1, 1000, 0, store);
    expect(rateLimit("b", 1, 1000, 0, store).allowed).toBe(true);
  });
});

function fakeStore(initial: OutboxItem[] = []): OutboxStore {
  let items = [...initial];
  return {
    all: async () => [...items],
    // Upsert by id — IndexedDB `put` semantics (keyPath "id"). An appending
    // fake would double items the flush re-puts with an attempts counter.
    put: async (item) => {
      items = [...items.filter((i) => i.id !== item.id), item];
    },
    remove: async (id) => {
      items = items.filter((i) => i.id !== id);
    },
  };
}

const OWNER = "user-a";

describe("flushOutbox", () => {
  it("removes items whose handler succeeds, oldest first", async () => {
    const order: string[] = [];
    const store = fakeStore([
      { id: "2", kind: "save", payload: "b", createdAt: 2, userId: OWNER },
      { id: "1", kind: "save", payload: "a", createdAt: 1, userId: OWNER },
    ]);
    const res = await flushOutbox(
      OWNER,
      {
        save: async (p: unknown) => {
          order.push(p as string);
          return "done" as const;
        },
      },
      store,
    );
    expect(order).toEqual(["a", "b"]); // sorted by createdAt
    expect(res.flushed).toBe(2);
    expect(res.remaining).toBe(0);
  });

  it("keeps an item whose handler reports transient (still offline)", async () => {
    const store = fakeStore([
      { id: "1", kind: "save", payload: "x", createdAt: 1, userId: OWNER },
    ]);
    const res = await flushOutbox(
      OWNER,
      { save: async () => "transient" as const },
      store,
    );
    expect(res.flushed).toBe(0);
    expect(res.remaining).toBe(1);
    expect(res.parked).toBe(0);
  });

  it("parks an item after MAX_OUTBOX_ATTEMPTS confirmed rejections (SW-007)", async () => {
    // A payload the server keeps rejecting must not fire one server action per
    // foreground event for the life of the origin storage. Three confirmed
    // rejections park it: kept (never deleted), skipped by later flushes,
    // surfaced once via the parked count.
    let calls = 0;
    const store = fakeStore([
      { id: "1", kind: "save", payload: "poison-ish", createdAt: 1, userId: OWNER },
    ]);
    const handlers = {
      save: async () => {
        calls += 1;
        return "failed" as const;
      },
    };
    const first = await flushOutbox(OWNER, handlers, store);
    const second = await flushOutbox(OWNER, handlers, store);
    const third = await flushOutbox(OWNER, handlers, store);
    expect(calls).toBe(MAX_OUTBOX_ATTEMPTS);
    expect(first.parked + second.parked + third.parked).toBe(1);
    // Parked, not deleted — and never retried again.
    const fourth = await flushOutbox(OWNER, handlers, store);
    expect(calls).toBe(MAX_OUTBOX_ATTEMPTS);
    expect(fourth.parked).toBe(0);
    expect(fourth.remaining).toBe(1);
  });

  it("parks a poison item immediately without retrying (Q10)", async () => {
    // A malformed persisted payload (an older build's shape) can never
    // succeed on any flush — retrying it is pure waste.
    let calls = 0;
    const store = fakeStore([
      { id: "1", kind: "save", payload: {}, createdAt: 1, userId: OWNER },
    ]);
    const res = await flushOutbox(
      OWNER,
      {
        save: async () => {
          calls += 1;
          return "poison" as const;
        },
      },
      store,
    );
    expect(calls).toBe(1);
    expect(res.parked).toBe(1);
    expect(res.remaining).toBe(1);
    const again = await flushOutbox(
      OWNER,
      {
        save: async () => {
          calls += 1;
          return "poison" as const;
        },
      },
      store,
    );
    expect(calls).toBe(1); // parked items are never re-attempted
    expect(again.parked).toBe(0);
  });

  it("keeps an item whose handler throws", async () => {
    const store = fakeStore([
      { id: "1", kind: "save", payload: "x", createdAt: 1, userId: OWNER },
    ]);
    const res = await flushOutbox(
      OWNER,
      {
        save: async () => {
          throw new Error("network");
        },
      },
      store,
    );
    expect(res.remaining).toBe(1);
  });

  it("leaves items with an unknown kind untouched", async () => {
    const store = fakeStore([
      { id: "1", kind: "other", payload: "x", createdAt: 1, userId: OWNER },
    ]);
    const res = await flushOutbox(
      OWNER,
      { save: async () => "done" as const },
      store,
    );
    expect(res.remaining).toBe(1);
  });

  it("never replays another account's queued work", async () => {
    // The failure this guards: IndexedDB is scoped to the ORIGIN, so on a
    // shared device user A's queued draft was replayed under whoever signed in
    // next — and savePromptAction takes the owner from the CURRENT session, so
    // it landed in B's library with B's authorship in the activity feed.
    const handled: string[] = [];
    const store = fakeStore([
      { id: "1", kind: "save", payload: "private-a", createdAt: 1, userId: "user-a" },
      { id: "2", kind: "save", payload: "private-b", createdAt: 2, userId: "user-b" },
    ]);
    const res = await flushOutbox(
      "user-b",
      {
        save: async (p: unknown) => {
          handled.push(p as string);
          return "done" as const;
        },
      },
      store,
    );
    expect(handled).toEqual(["private-b"]);
    expect(res.flushed).toBe(1);
    // A's item is left in place, not deleted: they may sign back in here, and
    // destroying unsaved work to tidy a queue is the worse failure.
    expect(res.remaining).toBe(1);
  });

  it("never replays an item queued before owners were recorded", async () => {
    // Items written by an earlier build have no userId. Replaying them would
    // be the same cross-account write, so they are skipped and kept.
    const handled: string[] = [];
    const store = fakeStore([{ id: "1", kind: "save", payload: "legacy", createdAt: 1 }]);
    const res = await flushOutbox(
      "user-b",
      {
        save: async (p: unknown) => {
          handled.push(p as string);
          return "done" as const;
        },
      },
      store,
    );
    expect(handled).toEqual([]);
    expect(res.remaining).toBe(1);
  });
});
