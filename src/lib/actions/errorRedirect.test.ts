import { describe, expect, it } from "vitest";
import { GENERIC_ERROR_MESSAGE, userFacingMessage } from "./errorRedirect";

/**
 * What a consultant may read after a failed action. Found during the E2E plan: under load a Prisma
 * transaction timeout was forwarded verbatim into ?error= and rendered, absolute filesystem paths
 * and all. Only messages this application wrote on purpose reach the page.
 */
describe("userFacingMessage", () => {
  it("passes through a message this application wrote", () => {
    expect(userFacingMessage(new Error("A Red finding needs a note."))).toBe("A Red finding needs a note.");
  });

  it("replaces anything that is not a plain Error", () => {
    class PrismaClientKnownRequestError extends Error {}
    expect(userFacingMessage(new PrismaClientKnownRequestError("Transaction API error: Transaction already closed"))).toBe(GENERIC_ERROR_MESSAGE);
    expect(userFacingMessage(new TypeError("Cannot read properties of undefined"))).toBe(GENERIC_ERROR_MESSAGE);
    expect(userFacingMessage("a string")).toBe(GENERIC_ERROR_MESSAGE);
    expect(userFacingMessage(undefined)).toBe(GENERIC_ERROR_MESSAGE);
  });

  it("replaces a plain Error whose text is engineering, not consultant-facing", () => {
    expect(userFacingMessage(new Error("ENOENT: /Users/someone/dev/closecheck/.next/server/chunk.js"))).toBe(GENERIC_ERROR_MESSAGE);
    expect(userFacingMessage(new Error("Transaction API error: expired"))).toBe(GENERIC_ERROR_MESSAGE);
    expect(userFacingMessage(new Error("    at handler (src/x.ts:12:3)"))).toBe(GENERIC_ERROR_MESSAGE);
    expect(userFacingMessage(new Error(""))).toBe(GENERIC_ERROR_MESSAGE);
  });
});
