import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { ProviderError } from "@/lib/providers/errors";

/**
 * The /api/media route handler (audit MED-008): the one media path that
 * spends money had zero handler-level tests — auth gate, validation, the
 * reserve/settle/release ladder, the cross-provider fallback contract, and
 * failed-leg billing (MED-004) were all unpinned.
 */
const supabaseMock = vi.hoisted(() => ({
  auth: { getUser: vi.fn(async () => ({ data: { user: { id: "u1" } } })) },
}));
vi.mock("@/lib/supabase/server", () => ({
  createClient: vi.fn(async () => supabaseMock),
}));

const spend = vi.hoisted(() => ({
  reserveSpend: vi.fn(async () => ({ id: "r1", todayCost: 0.5, reservedUsd: 0.1 })),
  settleSpend: vi.fn(async () => ({ error: null })),
  releaseSpend: vi.fn(async () => ({ error: null })),
}));
vi.mock("@/lib/security/spend", () => spend);

vi.mock("@/lib/security/rate-limit", () => ({
  rateLimit: vi.fn(() => ({ allowed: true })),
}));

vi.mock("@/lib/owner/settings", () => ({
  getAppSettings: vi.fn(async () => ({ openAccess: true, ownerUserId: null })),
  isOwnerUser: vi.fn(() => false),
}));

const vision = vi.hoisted(() => ({
  describeImage: vi.fn(),
  isVisionConfigError: vi.fn(),
  supportsVision: vi.fn(() => true),
  visionFallbackTarget: vi.fn(),
}));
vi.mock("@/lib/providers/vision", () => vision);

// The routing policy has its own unit suite (auto-target.test.ts); here it is
// a mock so these tests pin the ROUTE's contract — what gets resolved, what
// gets validated, what 503s — not the ladder economics.
const router = vi.hoisted(() => ({
  resolveAutoVisionTarget: vi.fn(() => "opus_5" as const),
}));
vi.mock("@/lib/enhance/auto-target", () => router);

import { POST } from "@/app/api/media/route";

const PNG_DATA_URL = `data:image/png;base64,${Buffer.from("fake-image").toString("base64")}`;

function request(body: unknown) {
  return new NextRequest("https://app.test/api/media", {
    method: "POST",
    body: typeof body === "string" ? body : JSON.stringify(body),
    headers: { "content-type": "application/json" },
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.spyOn(console, "error").mockImplementation(() => {});
  supabaseMock.auth.getUser.mockResolvedValue({ data: { user: { id: "u1" } } });
  spend.reserveSpend.mockResolvedValue({ id: "r1", todayCost: 0.5, reservedUsd: 0.1 });
  spend.settleSpend.mockResolvedValue({ error: null });
  spend.releaseSpend.mockResolvedValue({ error: null });
  vision.supportsVision.mockReturnValue(true);
  vision.isVisionConfigError.mockReturnValue(false);
  vision.describeImage.mockResolvedValue({
    attrs: { subject: "a beach", source: "proxy" },
    tokenIn: 100,
    tokenOut: 50,
  });
});

describe("POST /api/media", () => {
  it("401s without a session, before any reservation", async () => {
    supabaseMock.auth.getUser.mockResolvedValue({ data: { user: null } } as never);
    const res = await POST(request({ dataUrl: PNG_DATA_URL }));
    expect(res.status).toBe(401);
    expect(spend.reserveSpend).not.toHaveBeenCalled();
  });

  it("400s a missing dataUrl, an unknown target, and an unknown intent", async () => {
    expect((await POST(request({}))).status).toBe(400);
    expect(
      (await POST(request({ dataUrl: PNG_DATA_URL, target: "not-a-model" }))).status,
    ).toBe(400);
    expect(
      (await POST(request({ dataUrl: PNG_DATA_URL, intent: "nonsense" }))).status,
    ).toBe(400);
  });

  it("rejects prototype-chain intents instead of silently defaulting (MED-006)", async () => {
    const res = await POST(request({ dataUrl: PNG_DATA_URL, intent: "toString" }));
    expect(res.status).toBe(400);
    expect(vision.describeImage).not.toHaveBeenCalled();
  });

  it("settles with mode 'extract' and returns the usage block on success", async () => {
    const res = await POST(request({ dataUrl: PNG_DATA_URL, target: "opus_5" }));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(spend.settleSpend).toHaveBeenCalledWith(
      supabaseMock,
      "r1",
      expect.objectContaining({ mode: "extract", tokenIn: 100, tokenOut: 50 }),
    );
    expect(body.usage).toMatchObject({ target: "opus_5", tokenIn: 100, tokenOut: 50 });
    expect(body.fallbackFrom).toBeUndefined();
  });

  it("marks absent provider usage as estimated end-to-end (INV-005)", async () => {
    vision.describeImage.mockResolvedValue({
      attrs: { source: "proxy" },
      tokenIn: 0,
      tokenOut: 0,
      usageEstimated: true,
    });
    const res = await POST(request({ dataUrl: PNG_DATA_URL, target: "opus_5" }));
    const body = await res.json();
    expect(body.usage.estimated).toBe(true);
    expect(spend.settleSpend).toHaveBeenCalledWith(
      supabaseMock,
      "r1",
      expect.objectContaining({ estimated: true }),
    );
  });

  it("releases the hold when the provider fails without reporting usage", async () => {
    vision.describeImage.mockRejectedValue(new ProviderError("anthropic", "boom", 500));
    const res = await POST(request({ dataUrl: PNG_DATA_URL, target: "opus_5" }));
    expect(res.status).toBe(502);
    expect(spend.releaseSpend).toHaveBeenCalledWith(supabaseMock, "r1");
    expect(spend.settleSpend).not.toHaveBeenCalled();
  });

  it("settles (not releases) a failure that reported usage (MED-004)", async () => {
    vision.describeImage.mockRejectedValue(
      new ProviderError("google", "policy stop", 400, { tokenIn: 80, tokenOut: 20 }),
    );
    const res = await POST(
      request({ dataUrl: PNG_DATA_URL, target: "gemini_3_6_flash" }),
    );
    expect(res.status).toBe(502);
    expect(spend.releaseSpend).not.toHaveBeenCalled();
    expect(spend.settleSpend).toHaveBeenCalledWith(
      supabaseMock,
      "r1",
      expect.objectContaining({ tokenIn: 80, tokenOut: 20 }),
    );
  });

  it("retries a config-shaped failure on the fallback and reports fallbackFrom", async () => {
    vision.isVisionConfigError.mockReturnValue(true);
    vision.visionFallbackTarget.mockReturnValue("gpt_5_6_sol");
    vision.describeImage
      .mockRejectedValueOnce(new ProviderError("anthropic", "key rejected", 403))
      .mockResolvedValueOnce({
        attrs: { source: "proxy" },
        tokenIn: 10,
        tokenOut: 5,
      });
    const res = await POST(request({ dataUrl: PNG_DATA_URL, target: "opus_5" }));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.fallbackFrom).toBe("opus_5");
    expect(body.usage.target).toBe("gpt_5_6_sol");
    // One hold covers the retry — settled exactly once.
    expect(spend.settleSpend).toHaveBeenCalledTimes(1);
  });

  it("bills a fallback leg that fails WITH usage to the fallback, not the original (Codex review, PR #75)", async () => {
    // The original config-fails with NO usage (the 401/403 shape), then the
    // fallback runs a model, REPORTS usage, and throws. Its tokens must settle
    // under the fallback's target/model — pricing them at the original's rates
    // and ledgering them under the original model corrupts the daily-cap.
    vision.isVisionConfigError.mockReturnValue(true);
    vision.visionFallbackTarget.mockReturnValue("gpt_5_6_sol");
    vision.describeImage
      .mockRejectedValueOnce(new ProviderError("anthropic", "key rejected", 403))
      .mockRejectedValueOnce(
        new ProviderError("openai", "content stop", 400, { tokenIn: 40, tokenOut: 12 }),
      );
    const res = await POST(request({ dataUrl: PNG_DATA_URL, target: "opus_5" }));
    expect(res.status).toBe(502);
    expect(spend.releaseSpend).not.toHaveBeenCalled();
    expect(spend.settleSpend).toHaveBeenCalledWith(
      supabaseMock,
      "r1",
      expect.objectContaining({ target: "gpt_5_6_sol", tokenIn: 40, tokenOut: 12 }),
    );
  });

  it("routes a text-only flagship to the fallback up front", async () => {
    vision.supportsVision.mockReturnValue(false);
    vision.visionFallbackTarget.mockReturnValue("opus_5");
    const res = await POST(request({ dataUrl: PNG_DATA_URL, target: "deepseek_v4" }));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.fallbackFrom).toBe("deepseek_v4");
  });

  it("503s when no vision-capable provider is configured — before any hold", async () => {
    vision.supportsVision.mockReturnValue(false);
    vision.visionFallbackTarget.mockReturnValue(null);
    const res = await POST(request({ dataUrl: PNG_DATA_URL, target: "deepseek_v4" }));
    expect(res.status).toBe(503);
    expect(spend.reserveSpend).not.toHaveBeenCalled();
  });
});

describe("POST /api/media — auto routing", () => {
  beforeEach(() => {
    // clearAllMocks clears calls, not return values — re-pin the default so a
    // test's mockReturnValue can't leak into its neighbours.
    router.resolveAutoVisionTarget.mockReturnValue("opus_5" as never);
  });
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("400s an invented preference and a non-boolean auto flag", async () => {
    expect(
      (
        await POST(
          request({ dataUrl: PNG_DATA_URL, auto: true, autoPreference: "cheapest" }),
        )
      ).status,
    ).toBe(400);
    expect((await POST(request({ dataUrl: PNG_DATA_URL, auto: "yes" }))).status).toBe(
      400,
    );
    expect(router.resolveAutoVisionTarget).not.toHaveBeenCalled();
  });

  it("a preference without auto is inert, not an error", async () => {
    // The format/length convention: a stale client can't produce a request
    // that argues with itself.
    const res = await POST(
      request({ dataUrl: PNG_DATA_URL, target: "opus_5", autoPreference: "budget" }),
    );
    expect(res.status).toBe(200);
    expect(router.resolveAutoVisionTarget).not.toHaveBeenCalled();
    expect((await res.json()).usage.target).toBe("opus_5");
  });

  it("resolves auto through the vision ladder and does NOT report it as a fallback", async () => {
    vi.stubEnv("GOOGLE_API_KEY", "g-test");
    router.resolveAutoVisionTarget.mockReturnValue("gemini_3_6_flash" as never);
    const res = await POST(
      request({
        dataUrl: PNG_DATA_URL,
        target: "deepseek_v4", // the pinned fallback rides, enhance-wire shape
        auto: true,
        autoPreference: "budget",
      }),
    );
    expect(res.status).toBe(200);
    expect(router.resolveAutoVisionTarget).toHaveBeenCalledWith(
      "budget",
      vision.supportsVision,
    );
    const body = await res.json();
    expect(body.usage.target).toBe("gemini_3_6_flash");
    // Routing is a choice, not a fallback — the client re-labels from
    // usage.target without a fallback banner.
    expect(body.fallbackFrom).toBeUndefined();
  });

  it("defaults an absent preference to balanced", async () => {
    vi.stubEnv("ANTHROPIC_API_KEY", "a-test");
    const res = await POST(
      request({ dataUrl: PNG_DATA_URL, target: "deepseek_v4", auto: true }),
    );
    expect(res.status).toBe(200);
    expect(router.resolveAutoVisionTarget).toHaveBeenCalledWith(
      "balanced",
      vision.supportsVision,
    );
  });

  it("503s before any hold when auto's pick has no key configured", async () => {
    vi.stubEnv("ANTHROPIC_API_KEY", "");
    router.resolveAutoVisionTarget.mockReturnValue("opus_5" as never);
    const res = await POST(request({ dataUrl: PNG_DATA_URL, auto: true }));
    expect(res.status).toBe(503);
    expect(spend.reserveSpend).not.toHaveBeenCalled();
  });

  it("a runtime retry under auto reports fallbackFrom as the RESOLVED target", async () => {
    // Not the client's pinned fallback: the request was aimed at what routing
    // picked, so that is what the retry fell back FROM.
    vi.stubEnv("ANTHROPIC_API_KEY", "a-test");
    router.resolveAutoVisionTarget.mockReturnValue("opus_5" as never);
    vision.isVisionConfigError.mockReturnValue(true);
    vision.visionFallbackTarget.mockReturnValue("gpt_5_6_sol");
    vision.describeImage
      .mockRejectedValueOnce(new ProviderError("anthropic", "key rejected", 403))
      .mockResolvedValueOnce({ attrs: { source: "proxy" }, tokenIn: 10, tokenOut: 5 });
    const res = await POST(
      request({ dataUrl: PNG_DATA_URL, target: "deepseek_v4", auto: true }),
    );
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.fallbackFrom).toBe("opus_5");
    expect(body.usage.target).toBe("gpt_5_6_sol");
  });
});
