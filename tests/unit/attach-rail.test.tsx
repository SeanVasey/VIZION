import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { ToastProvider } from "@/components/ui/Toast";
import { useUIStore } from "@/stores/ui";

/**
 * The attach rail's hierarchy.
 *
 * The capability blurb ("images are analyzed; video contributes its first
 * frame…") used to sit permanently under the rail as a two-line paragraph, and
 * paying for it squeezed the attach control down to a 12px text link — the one
 * thing in the tray that has to read as "upload a file". The words now live
 * behind the rail's `?`, and the button gets its size back.
 */
vi.mock("@/lib/supabase/client", () => ({
  createClient: () => ({
    from: () => ({ select: async () => ({ data: [], error: null }) }),
  }),
}));

import { AttachmentTray } from "@/components/media/AttachmentTray";

const BLURB = /Images are analyzed/;
const helpToggle = () =>
  screen.getByRole("button", { name: "What happens to attached media?" });
const attachButton = () => screen.getByRole("button", { name: /Attach media/ });

function renderTray() {
  return render(
    <ToastProvider>
      <AttachmentTray />
    </ToastProvider>,
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  useUIStore.setState({ mediaStoreByDefault: true, targetModel: "opus_5" });
});

describe("attach rail", () => {
  it("keeps the capability blurb behind the ? until it is asked for", () => {
    renderTray();
    expect(screen.queryByText(BLURB)).toBeNull();
    expect(helpToggle()).toHaveAttribute("aria-expanded", "false");

    fireEvent.click(helpToggle());
    expect(screen.getByText(BLURB)).toBeInTheDocument();
    expect(helpToggle()).toHaveAttribute("aria-expanded", "true");

    fireEvent.click(helpToggle());
    expect(screen.queryByText(BLURB)).toBeNull();
  });

  it("points aria-controls at the panel it actually opens", () => {
    renderTray();
    fireEvent.click(helpToggle());
    expect(screen.getByText(BLURB).id).toBe(helpToggle().getAttribute("aria-controls"));
  });

  it("closes the panel on Escape from the button that opened it", () => {
    renderTray();
    fireEvent.click(helpToggle());
    fireEvent.keyDown(helpToggle(), { key: "Escape" });
    expect(screen.queryByText(BLURB)).toBeNull();
  });

  it("gives the attach control the size of a real button, not a text link", () => {
    renderTray();
    const cls = attachButton().className;
    expect(cls).toContain("text-sm"); // was text-xs
    expect(cls).toContain("min-h-[44px]");
    expect(cls).toContain("pill");
    expect(cls).not.toContain("text-xs");
  });

  it("keeps the originals dial, quieter than the action beside it", () => {
    renderTray();
    const dial = screen.getByRole("button", { name: /Originals/ });
    expect(dial).toHaveAttribute("aria-pressed", "true");
    expect(dial).toHaveTextContent("stored");
    // Smaller than the attach button, and small enough to need the 44pt
    // hit-area extender rather than intrinsic size.
    expect(dial.className).toContain("text-[0.625rem]");
    expect(dial.className).toContain("tap-44");

    fireEvent.click(dial);
    expect(useUIStore.getState().mediaStoreByDefault).toBe(false);
    expect(screen.getByRole("button", { name: /Originals/ })).toHaveTextContent(
      "not kept",
    );
  });
});
