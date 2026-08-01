/**
 * Offline mutation outbox (P6 / iOS storage-eviction recovery). Mutations that
 * fail while offline are queued in IndexedDB and replayed on the next
 * `online` / `visibilitychange` (the server stays the source of truth). The
 * flush logic is pure over an injectable store so it is unit-tested; the
 * IndexedDB store is browser-only.
 */

export interface OutboxItem<T = unknown> {
  id: string;
  kind: string;
  payload: T;
  createdAt: number;
  /**
   * The account that queued this. IndexedDB is scoped to the ORIGIN, not to a
   * session, so without this a draft queued by one user on a shared device is
   * replayed under whoever happens to be signed in at flush time — and
   * `savePromptAction` takes the owner from the current session, so it lands in
   * the wrong library with the wrong authorship in the activity feed.
   *
   * Optional so items queued by an earlier build still parse; they are treated
   * as belonging to nobody and are never replayed (see `flushOutbox`).
   */
  userId?: string;
  /** Confirmed non-transient rejections so far (absent = 0). */
  attempts?: number;
  /**
   * Poisoned: the payload can never succeed (failed shape validation, or the
   * server rejected it MAX_OUTBOX_ATTEMPTS times). Parked items are skipped
   * by every flush but KEPT — destroying queued work to tidy a queue is the
   * worse failure; the flusher surfaces them once instead (SW-007 / Q10).
   */
  parked?: boolean;
}

export interface OutboxStore {
  all(): Promise<OutboxItem[]>;
  put(item: OutboxItem): Promise<void>;
  remove(id: string): Promise<void>;
}

/**
 * What a replay attempt concluded about its item:
 * - `done`      — processed (or already processed); drop it.
 * - `transient` — could not reach a verdict (offline, network, 5xx); keep it
 *                 untouched for the next flush. A thrown handler counts too.
 * - `failed`    — the server REJECTED it; counts against MAX_OUTBOX_ATTEMPTS,
 *                 then the item parks.
 * - `poison`    — can never succeed (malformed payload); parks immediately.
 */
export type OutboxOutcome = "done" | "transient" | "failed" | "poison";
export type OutboxHandler = (payload: unknown) => Promise<OutboxOutcome>;

/** Confirmed server rejections before an item stops auto-retrying. Bounded
 *  retries absorb a transiently misbehaving server; the cap stops a poison
 *  item from firing one server action per foreground event forever. */
export const MAX_OUTBOX_ATTEMPTS = 3;

/**
 * Replay THIS ACCOUNT'S queued items oldest-first. An item is removed only when
 * its handler confirms success. Pure given the store + handlers.
 *
 * Items belonging to another account — or to no account, i.e. queued by a build
 * before `userId` existed — are skipped, never replayed and never removed. They
 * are left in place rather than deleted because the owner may sign back in on
 * this device, and destroying someone's unsaved work to tidy a queue is the
 * worse failure. Parked items are likewise kept but never retried; `parked`
 * in the result counts the items that parked DURING this flush so the caller
 * can tell the user once, instead of the queue silently lying forever.
 */
export async function flushOutbox(
  userId: string,
  handlers: Record<string, OutboxHandler>,
  store: OutboxStore,
): Promise<{ flushed: number; remaining: number; parked: number }> {
  const items = (await store.all())
    .filter((item) => item.userId === userId && !item.parked)
    .sort((a, b) => a.createdAt - b.createdAt);
  let flushed = 0;
  let parked = 0;
  for (const item of items) {
    const handler = handlers[item.kind];
    if (!handler) continue; // unknown kind — leave for a build that handles it
    try {
      const outcome = await handler(item.payload);
      if (outcome === "done") {
        await store.remove(item.id);
        flushed += 1;
      } else if (outcome === "poison") {
        await store.put({ ...item, parked: true });
        parked += 1;
      } else if (outcome === "failed") {
        const attempts = (item.attempts ?? 0) + 1;
        if (attempts >= MAX_OUTBOX_ATTEMPTS) {
          await store.put({ ...item, attempts, parked: true });
          parked += 1;
        } else {
          await store.put({ ...item, attempts });
        }
      }
      // `transient` — leave untouched for the next flush.
    } catch {
      // Handler threw (likely still offline) — transient; keep it.
    }
  }
  const remaining = (await store.all()).length;
  return { flushed, remaining, parked };
}

// --- IndexedDB-backed store (browser-only) -----------------------------------

const DB_NAME = "vizion-outbox";
const STORE = "items";

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, 1);
    req.onupgradeneeded = () => {
      req.result.createObjectStore(STORE, { keyPath: "id" });
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

function tx<T>(
  mode: IDBTransactionMode,
  run: (s: IDBObjectStore) => IDBRequest<T>,
): Promise<T> {
  return openDb().then(
    (db) =>
      new Promise<T>((resolve, reject) => {
        const request = run(db.transaction(STORE, mode).objectStore(STORE));
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error);
      }),
  );
}

export const idbStore: OutboxStore = {
  async all() {
    if (typeof indexedDB === "undefined") return [];
    return (
      (await tx<OutboxItem[]>(
        "readonly",
        (s) => s.getAll() as IDBRequest<OutboxItem[]>,
      )) ?? []
    );
  },
  async put(item) {
    if (typeof indexedDB === "undefined") return;
    await tx("readwrite", (s) => s.put(item));
  },
  async remove(id) {
    if (typeof indexedDB === "undefined") return;
    await tx("readwrite", (s) => s.delete(id));
  },
};

/**
 * Enqueue a mutation for later replay. Returns whether the write actually
 * landed (SW-001): a rejecting IndexedDB put (Private Browsing, quota, an
 * evicted origin) used to be swallowed while the UI said "Queued — syncs
 * when online" over a prompt that persisted nowhere. Callers gate their
 * queued state on this result. Refuses to queue without an owner (SW-002):
 * an item stamped "" matches no account at flush time and strands forever.
 */
export async function enqueueOutbox(
  userId: string,
  kind: string,
  payload: unknown,
  store: OutboxStore = idbStore,
): Promise<boolean> {
  if (!userId) return false;
  try {
    await store.put({
      id: crypto.randomUUID(),
      kind,
      payload,
      createdAt: Date.now(),
      userId,
    });
    return true;
  } catch {
    /* IndexedDB unavailable (e.g. evicted) — the caller reports the truth. */
    return false;
  }
}
