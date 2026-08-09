import { savePromptAction } from "@/lib/library/actions";
import { enqueueOutbox } from "@/lib/pwa/outbox";

type SavePayload = Parameters<typeof savePromptAction>[0];
type SaveActionResult = Awaited<ReturnType<typeof savePromptAction>>;
type DuplicateRef = NonNullable<SaveActionResult["duplicate"]>;

export type SaveWithOutboxResult =
  /** The server accepted the save. */
  | { status: "saved"; promptId: string }
  /** This exact content already exists — the caller decides what that means
   *  (TransformationDiff offers resolution; GenerateSheet links the card). */
  | { status: "duplicate"; duplicate: DuplicateRef }
  /** Offline, and the outbox write landed under a real owner. */
  | { status: "queued" }
  /** Offline, but the queue could NOT be promised (no owner yet, or the
   *  IndexedDB write failed) — the caller must tell the user to copy. */
  | { status: "queue-failed" }
  /** Online failure — an error to report, never a queue to promise. `source`
   *  keeps the surfaces' fallback copy exact: "action" is a structured
   *  refusal (message carries the action's own error, when it sent one);
   *  "network" is a throw. */
  | { status: "error"; source: "action" | "network"; message?: string };

/**
 * The ONE save-with-outbox control flow (audit 04 redun-05). Incident-hardened
 * (SW-001/SW-002): "queued" is claimed only when the outbox write actually
 * landed AND had an owner to land under — a rejecting IndexedDB put or a
 * pre-hydration save must fail honestly instead of promising a sync that
 * cannot come. An ONLINE server failure is an error, not a queue; the offline
 * re-check inside the catch covers a connection dropping mid-save.
 *
 * Two surfaces consume this (TransformationDiff, GenerateSheet) and map the
 * result onto their own state + copy. The branches used to be copy-pasted
 * between them, which is how SW-001/SW-002 had to be fixed twice; every branch
 * is pinned by tests/unit/save-outbox.test.tsx across both surfaces.
 */
export async function savePromptWithOutbox(
  userId: string | null,
  payload: SavePayload,
): Promise<SaveWithOutboxResult> {
  if (typeof navigator !== "undefined" && navigator.onLine === false) {
    if (userId && (await enqueueOutbox(userId, "save-prompt", payload))) {
      return { status: "queued" };
    }
    return { status: "queue-failed" };
  }
  try {
    const res = await savePromptAction(payload);
    if (res.ok && res.promptId) return { status: "saved", promptId: res.promptId };
    if (res.duplicate) return { status: "duplicate", duplicate: res.duplicate };
    return {
      status: "error",
      source: "action",
      ...(res.error ? { message: res.error } : {}),
    };
  } catch {
    if (
      typeof navigator !== "undefined" &&
      navigator.onLine === false &&
      userId &&
      (await enqueueOutbox(userId, "save-prompt", payload))
    ) {
      return { status: "queued" };
    }
    return { status: "error", source: "network" };
  }
}
