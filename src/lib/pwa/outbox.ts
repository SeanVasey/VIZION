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
}

export interface OutboxStore {
  all(): Promise<OutboxItem[]>;
  put(item: OutboxItem): Promise<void>;
  remove(id: string): Promise<void>;
}

/** A handler returns true when the item was processed and can be dropped. */
export type OutboxHandler = (payload: unknown) => Promise<boolean>;

/**
 * Replay queued items oldest-first. An item is removed only when its handler
 * confirms success; the first failure for a kind stops that item being dropped
 * (it stays for the next flush). Pure given the store + handlers.
 */
export async function flushOutbox(
  handlers: Record<string, OutboxHandler>,
  store: OutboxStore,
): Promise<{ flushed: number; remaining: number }> {
  const items = (await store.all()).sort((a, b) => a.createdAt - b.createdAt);
  let flushed = 0;
  for (const item of items) {
    const handler = handlers[item.kind];
    if (!handler) continue; // unknown kind — leave for a build that handles it
    try {
      if (await handler(item.payload)) {
        await store.remove(item.id);
        flushed += 1;
      }
    } catch {
      // Still failing (likely still offline) — keep it for the next flush.
    }
  }
  const remaining = (await store.all()).length;
  return { flushed, remaining };
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

/** Enqueue a mutation for later replay (best-effort; never throws). */
export async function enqueueOutbox(
  kind: string,
  payload: unknown,
  store: OutboxStore = idbStore,
): Promise<void> {
  try {
    await store.put({
      id: crypto.randomUUID(),
      kind,
      payload,
      createdAt: Date.now(),
    });
  } catch {
    /* IndexedDB unavailable (e.g. evicted) — nothing more we can do offline. */
  }
}
