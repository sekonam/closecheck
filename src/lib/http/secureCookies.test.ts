import { afterEach, describe, expect, it, vi } from "vitest";
import { secureCookies } from "./secureCookies";

describe("secureCookies", () => {
  afterEach(() => { vi.unstubAllEnvs(); });

  it("is secure for an https public URL, whatever NODE_ENV says", () => {
    vi.stubEnv("NEXTAUTH_URL", "https://app.closecheck.io"); vi.stubEnv("NODE_ENV", "development");
    expect(secureCookies()).toBe(true);
  });

  it("is not secure for an http public URL, even in production — the browser would drop the cookie", () => {
    vi.stubEnv("NEXTAUTH_URL", "http://localhost:3000"); vi.stubEnv("NODE_ENV", "production");
    expect(secureCookies()).toBe(false);
  });

  it("falls back to secure in production when no public URL is configured", () => {
    vi.stubEnv("NEXTAUTH_URL", ""); vi.stubEnv("AUTH_URL", ""); vi.stubEnv("NODE_ENV", "production");
    expect(secureCookies()).toBe(true);
  });

  it("honours AUTH_URL when NEXTAUTH_URL is absent", () => {
    vi.stubEnv("NEXTAUTH_URL", ""); vi.stubEnv("AUTH_URL", "https://app.closecheck.io");
    expect(secureCookies()).toBe(true);
  });
});
