import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, within } from "@testing-library/react";

/**
 * The stored-media manager's viewing path: the bytes the quota meter counts
 * are actually SHOWN (a real thumbnail from a signed URL) and actually
 * OPENABLE (a tap mints a fresh URL and puts the file on screen). Rows whose
 * upload never landed advertise no tap, because there is nothing behind it.
 */

const ROWS = [
  {
    id: "img",
    storage_path: "u1/32264e82-d153-46a3-8638-176b11ff0000.png",
    kind: "image",
    size_bytes: 81920,
    created_at: "2026-07-28T11:00:00Z",
    original_name: null,
    mime_type: "image/png",
    status: "ready",
  },
  {
    id: "half",
    storage_path: "u1/aaaa1111-2222-3333-4444-555566667777.png",
    kind: "image",
    size_bytes: 2048,
    created_at: "2026-07-28T10:00:00Z",
    original_name: "half-uploaded.png",
    mime_type: "image/png",
    status: "pending",
  },
];

const supabase = vi.hoisted(() => ({
  createSignedUrls: vi.fn(),
  createSignedUrl: vi.fn(),
  rows: [] as unknown[],
}));

vi.mock("@/lib/supabase/client", () => ({
  createClient: () => ({
    from: () => ({
      select: () => ({
        order: async () => ({ data: supabase.rows, error: null }),
      }),
      delete: () => ({ eq: async () => ({ error: null }) }),
    }),
    storage: {
      from: () => ({
        createSignedUrls: supabase.createSignedUrls,
        createSignedUrl: supabase.createSignedUrl,
        remove: async () => ({ error: null }),
      }),
    },
  }),
}));

import { MediaManager } from "@/components/media/MediaManager";

beforeEach(() => {
  vi.clearAllMocks();
  supabase.rows = ROWS;
  supabase.createSignedUrls.mockResolvedValue({
    data: [{ path: ROWS[0]!.storage_path, signedUrl: "https://cdn.test/thumb?token=a" }],
    error: null,
  });
  supabase.createSignedUrl.mockResolvedValue({
    data: { signedUrl: "https://cdn.test/full?token=fresh" },
    error: null,
  });
});

describe("MediaManager — showing the bytes it counts", () => {
  it("renders a real thumbnail from one batch-signed URL", async () => {
    const { container } = render(<MediaManager />);
    await screen.findByText(/^Image · /);
    const thumb = container.querySelector("img");
    expect(thumb).toHaveAttribute("src", "https://cdn.test/thumb?token=a");
    expect(thumb).toHaveAttribute("loading", "lazy");
    // The ready row only — a pending row has no object to sign.
    expect(supabase.createSignedUrls).toHaveBeenCalledWith(
      [ROWS[0]!.storage_path],
      expect.any(Number),
    );
  });

  it("names a legacy row for a human rather than showing its UUID", async () => {
    render(<MediaManager />);
    expect(await screen.findByText(/^Image · /)).toBeInTheDocument();
    expect(screen.queryByText(/32264e82/)).toBeNull();
  });

  it("opens the file on tap, with a freshly signed URL", async () => {
    render(<MediaManager />);
    fireEvent.click(await screen.findByRole("button", { name: /^Image · / }));

    const dialog = await screen.findByRole("dialog");
    expect(supabase.createSignedUrl).toHaveBeenCalledWith(
      ROWS[0]!.storage_path,
      expect.any(Number),
    );
    const full = await within(dialog).findByAltText(/^Image · /);
    expect(full).toHaveAttribute("src", "https://cdn.test/full?token=fresh");
    expect(within(dialog).getByRole("link", { name: "Open original" })).toHaveAttribute(
      "href",
      "https://cdn.test/full?token=fresh",
    );
  });

  it("explains a file it cannot open instead of showing a dead frame", async () => {
    supabase.createSignedUrl.mockResolvedValue({
      data: null,
      error: { message: "Object not found" },
    });
    render(<MediaManager />);
    fireEvent.click(await screen.findByRole("button", { name: /^Image · / }));
    expect(await screen.findByRole("alert")).toHaveTextContent(
      /Couldn't open this file — Object not found/,
    );
  });

  it("offers no tap on a row whose upload never landed", async () => {
    render(<MediaManager />);
    const incomplete = await screen.findByText(/Incomplete upload/);
    expect(incomplete.closest("button")).toBeNull();
    expect(screen.queryByRole("button", { name: /^half-uploaded/ })).toBeNull();
    // …but it is still removable, which is the point of keeping it visible.
    expect(
      screen.getByRole("button", { name: "Remove half-uploaded.png" }),
    ).toBeInTheDocument();
  });

  it("keeps the list usable when thumbnails can't be signed", async () => {
    supabase.createSignedUrls.mockResolvedValue({
      data: null,
      error: { message: "offline" },
    });
    const { container } = render(<MediaManager />);
    expect(await screen.findByText(/^Image · /)).toBeInTheDocument();
    expect(container.querySelector("img")).toBeNull();
  });
});
