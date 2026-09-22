import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Drives the real `runDomainWhois` through a mocked lookup.
 *
 * Deliberately not a re-implementation of the rating rules in the test file. An earlier suite here
 * tested a local copy of the thresholds and therefore could not catch a runner-side mistake — it
 * asserted the constants agreed with themselves. These call the shipped runner and read the
 * severity and the sentence it actually produces, because the sentence is what a buyer reads.
 */
vi.mock("@/lib/checks/whois", () => ({ lookupWhois: vi.fn() }));

import { lookupWhois } from "@/lib/checks/whois";
import { runTierACheck } from "./tierA";

const lookupMock = vi.mocked(lookupWhois);

const BASE = {
  registrar: "Registrar Ltd.",
  registrantOrg: "Selling Entity LLC",
  createdDate: "2019-01-02T00:00:00Z",
  lastTransferDate: null,
  lastChangedDate: null,
  statuses: [] as string[],
  raw: null,
  error: null,
};

/** An expiry `days` from now — fractional, because whole-day boundaries are the interesting case. */
function expiringIn(days: number) {
  return new Date(Date.now() + days * 86_400_000).toISOString();
}

async function rate(days: number, statuses: string[] = []) {
  lookupMock.mockResolvedValue({ ...BASE, statuses, expiryDate: expiringIn(days) });
  return runTierACheck("domain_whois", "example.com");
}

beforeEach(() => lookupMock.mockReset());

describe("an expired registration", () => {
  it("is Red and says so in the past tense, within the first day", () => {
    // Math.ceil(-0.2) is -0, and -0 < 0 is false — so a ceil-based day count skipped the expired
    // branch for the whole first 24 hours and printed "expires in 0 day(s)" about a past date,
    // losing the recovery guidance with it.
    return Promise.all(
      [-0.2, -0.95, -5, -400].map(async (days) => {
        const result = await rate(days);
        expect(result.severity, `${days}d`).toBe("RED");
        expect(result.note, `${days}d`).toMatch(/registration expired on/i);
        expect(result.note, `${days}d`).not.toMatch(/expires in/i);
        expect(result.note, `${days}d`).toMatch(/recover/i);
      }),
    );
  });

  it("never prints a negative or zero day count", async () => {
    const result = await rate(-0.2);
    expect(result.note).not.toMatch(/-\d+ day/);
    expect(result.note).not.toMatch(/\b0 day\(s\) ago/);
  });
});

describe("the 30- and 90-day thresholds", () => {
  it("rates just under thirty days as Red", async () => {
    // 29.2 days remaining IS fewer than 30 days remaining. Rounding up printed "30 days" and
    // rated it Yellow, which is the wrong side of the firm's own stated boundary.
    const result = await rate(29.2);
    expect(result.severity).toBe("RED");
    expect(result.note).toContain("29 day(s)");
  });

  it("rates a month or more out as no worse than Yellow", async () => {
    expect((await rate(30.5)).severity).toBe("YELLOW");
    expect((await rate(89.2)).severity).toBe("YELLOW");
  });

  it("rates well clear of the boundary as Green", async () => {
    expect((await rate(200)).severity).toBe("GREEN");
  });

  it("never overstates the time remaining", async () => {
    // The one direction a deadline count must not err in. 89.2 days printed as "90 days out" told
    // a consultant they had more room than they did, next to a closing date.
    for (const days of [29.9, 89.9, 200.9]) {
      const result = await rate(days);
      const printed = Number(/(\d+) day/.exec(result.note)?.[1]);
      expect(printed, `${days}d printed as ${printed}`).toBeLessThanOrEqual(Math.floor(days));
    }
  });
});

describe("the registrant of record", () => {
  it("is named on every rating, not only the clean one", async () => {
    // v4's rubric makes "the registrant is not the selling entity" its strongest Red trigger, and
    // it was reaching only two of the eight branches — missing precisely the ones where transfer
    // is already in question.
    const cases: Array<[string, Awaited<ReturnType<typeof rate>>]> = [
      ["healthy", await rate(400)],
      ["expiring soon", await rate(20)],
      ["expiring within 90", await rate(60)],
      ["expired", await rate(-10)],
      ["blocked status", await rate(400, ["pendingDelete"])],
      ["registry lock", await rate(400, ["serverTransferProhibited"])],
    ];
    for (const [label, result] of cases) {
      expect(result.note, label).toMatch(/registrant of record/i);
    }
  });

  it("says what to do when the registrant is redacted rather than staying silent", async () => {
    lookupMock.mockResolvedValue({ ...BASE, registrantOrg: null, expiryDate: expiringIn(400) });
    const result = await runTierACheck("domain_whois", "example.com");
    expect(result.note).toMatch(/not public/i);
    expect(result.note).toMatch(/evidence control/i);
  });
});
