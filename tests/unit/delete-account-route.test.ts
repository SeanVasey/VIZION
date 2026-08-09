import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

/**
 * The delete-account route: session gate, fail-closed when the service-role
 * key is absent, and the privilege-containment invariant — the only
 * identifier reaching any admin call is the verified session's user id.
 */
const supabaseMock = vi.hoisted(() => ({
  auth: {
    getUser: vi.fn(async () => ({ data: { user: { id: "u1" } } })),
    signOut: vi.fn(async () => ({ error: null })),
  },
}));
vi.mock("@/lib/supabase/server", () => ({
  createClient: vi.fn(async () => supabaseMock),
}));

const storeMock = vi.hoisted(() => ({
  list: vi.fn(async () => ({ data: [{ name: "asset.png" }], error: null })),
  remove: vi.fn(async () => ({ error: null })),
}));
const adminMock = vi.hoisted(() => ({
  storage: { from: vi.fn(() => storeMock) },
  auth: { admin: { deleteUser: vi.fn(async () => ({ error: null })) } },
}));
const adminFactory = vi.hoisted(() => ({
  createAdminClient: vi.fn((): unknown => adminMock),
}));
vi.mock("@/lib/supabase/admin", () => adminFactory);

import { POST } from "@/app/auth/delete-account/route";

function request() {
  return new NextRequest("https://app.test/auth/delete-account", { method: "POST" });
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.spyOn(console, "error").mockImplementation(() => {});
  supabaseMock.auth.getUser.mockResolvedValue({ data: { user: { id: "u1" } } });
  adminFactory.createAdminClient.mockReturnValue(adminMock);
  storeMock.list.mockResolvedValue({ data: [{ name: "asset.png" }], error: null });
});

describe("POST /auth/delete-account", () => {
  it("bounces to sign-in without a session — before any admin work", async () => {
    supabaseMock.auth.getUser.mockResolvedValue({
      data: { user: null },
    } as never);
    const res = await POST(request());
    expect(res.status).toBe(303);
    expect(res.headers.get("location")).toBe("https://app.test/sign-in");
    expect(adminFactory.createAdminClient).not.toHaveBeenCalled();
  });

  it("fails closed with a clear redirect when the service-role key is absent", async () => {
    adminFactory.createAdminClient.mockReturnValue(null);
    const res = await POST(request());
    expect(res.status).toBe(303);
    expect(res.headers.get("location")).toBe(
      "https://app.test/profile?delete_error=unconfigured",
    );
    expect(adminMock.auth.admin.deleteUser).not.toHaveBeenCalled();
    expect(storeMock.remove).not.toHaveBeenCalled();
  });

  it("deletes storage then the auth user (cascade), signs out, redirects", async () => {
    const res = await POST(request());
    // Privilege containment: every admin argument is the session user id.
    expect(storeMock.list).toHaveBeenCalledWith("u1", { limit: 100 });
    expect(storeMock.remove).toHaveBeenCalledWith(["u1/asset.png"]);
    expect(storeMock.remove).toHaveBeenCalledWith(["u1/avatar.png"]);
    expect(adminMock.auth.admin.deleteUser).toHaveBeenCalledWith("u1");
    expect(supabaseMock.auth.signOut).toHaveBeenCalled();
    expect(res.status).toBe(303);
    expect(res.headers.get("location")).toBe("https://app.test/sign-in?account=deleted");
  });

  it("reports failure without deleting anything further when an admin call throws", async () => {
    adminMock.auth.admin.deleteUser.mockResolvedValueOnce({
      error: { message: "boom" },
    } as never);
    const res = await POST(request());
    expect(res.status).toBe(303);
    expect(res.headers.get("location")).toBe(
      "https://app.test/profile?delete_error=failed",
    );
    // The session survives a failed deletion — no sign-out.
    expect(supabaseMock.auth.signOut).not.toHaveBeenCalled();
  });
});
