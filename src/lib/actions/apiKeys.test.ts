import { describe, expect, it, vi } from "vitest";

const set = vi.fn();
vi.mock("next/headers", () => ({ cookies: async () => ({ set }) }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/lib/auth/session", () => ({ requireOrgSession: async () => ({ orgId: "o", userId: "u" }) }));
vi.mock("@/lib/db/scoped", () => ({ withOrgScope: vi.fn() }));

describe("consumeSecretReveals", () => {
  it("expires both one-time reveal cookies on the settings path", async () => {
    const { consumeSecretReveals } = await import("./apiKeys");
    await consumeSecretReveals();
    const expired = set.mock.calls.map(([name, value, opts]) => ({ name, value, maxAge: opts.maxAge, path: opts.path }));
    expect(expired).toEqual([
      { name: "closecheck_new_api_key", value: "", maxAge: 0, path: "/settings" },
      { name: "closecheck_new_webhook_secret", value: "", maxAge: 0, path: "/settings" },
    ]);
  });
});
