import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { OwnerSection } from "@/components/settings/OwnerSection";

const updateOwnerSettingsAction = vi.fn(async () => ({ ok: true }));
vi.mock("@/lib/owner/actions", () => ({
  updateOwnerSettingsAction: (...args: unknown[]) =>
    updateOwnerSettingsAction(...(args as [])),
}));

const refresh = vi.fn();
vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh }),
}));

describe("OwnerSection (owner console)", () => {
  beforeEach(() => {
    updateOwnerSettingsAction.mockClear();
    refresh.mockClear();
    document.documentElement.style.removeProperty("--dev-peak-user");
  });

  it("renders the access switch reflecting server state", () => {
    render(<OwnerSection openAccess={false} devAccentStrength={26} />);
    const sw = screen.getByRole("switch", { name: /open access/i });
    expect(sw.getAttribute("aria-checked")).toBe("false");
  });

  it("toggling access writes through the owner action, optimistically", async () => {
    render(<OwnerSection openAccess={true} devAccentStrength={26} />);
    const sw = screen.getByRole("switch", { name: /open access/i });
    fireEvent.click(sw);
    // Optimistic flip is immediate; the server write carries the new value.
    expect(sw.getAttribute("aria-checked")).toBe("false");
    expect(updateOwnerSettingsAction).toHaveBeenCalledWith({ openAccess: false });
  });

  it("slider drag previews the accent variable live and commits on release", () => {
    render(<OwnerSection openAccess={true} devAccentStrength={26} />);
    const slider = screen.getByLabelText(/developer accent/i) as HTMLInputElement;
    fireEvent.change(slider, { target: { value: "34" } });
    expect(
      document.documentElement.style.getPropertyValue("--dev-peak-user"),
    ).toBe("34%");
    // No server write until the gesture ends…
    expect(updateOwnerSettingsAction).not.toHaveBeenCalled();
    fireEvent.pointerUp(slider);
    expect(updateOwnerSettingsAction).toHaveBeenCalledWith({
      devAccentStrength: 34,
    });
  });

  it("does not re-commit an unchanged value on blur", () => {
    render(<OwnerSection openAccess={true} devAccentStrength={26} />);
    const slider = screen.getByLabelText(/developer accent/i);
    fireEvent.blur(slider);
    expect(updateOwnerSettingsAction).not.toHaveBeenCalled();
  });
});
