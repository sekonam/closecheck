import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Drives the real `runEmailAuthPosture` through a mocked lookup, the same way domainExpiry.test.ts
 * drives the domain runner — reading the severity and the sentence the shipped code produces rather
 * than re-implementing the rules in the test.
 *
 * Written against a defect found by running the check on a live domain and reading the result
 * beside the rubric: toasttab.com publishes `p=none`, the runner's own note said "monitor-only — no
 * enforcement", and it rated the item GREEN with a status of PASS. Template v4's rubric puts p=none
 * in Yellow explicitly, and the note is the product describing the exact condition it then declined
 * to act on.
 */
vi.mock("@/lib/checks/emailAuth", () => ({ checkEmailAuth: vi.fn() }));

import { checkEmailAuth } from "@/lib/checks/emailAuth";
import { runTierACheck } from "./tierA";

const mock = vi.mocked(checkEmailAuth);

const BASE = {
  hasMx: true,
  nullMx: false,
  spfRecord: "v=spf1 include:_spf.google.com ~all",
  dmarcRecord: "v=DMARC1; p=reject; rua=mailto:d@example.com",
  dmarcPolicy: "reject",
  dkimSelectorsFound: ["google"],
  domainNotFound: false,
  error: null,
};

async function rate(overrides: Partial<import("@/lib/checks/emailAuth").EmailAuthPosture>) {
  mock.mockResolvedValue({ ...BASE, ...overrides });
  return runTierACheck("email_auth_posture", "example.com");
}

beforeEach(() => mock.mockReset());

describe("DMARC enforcement drives the rating", () => {
  it("rates p=none Yellow, not Green", () => {
    // The defect. A monitor-only policy publishes nothing a receiver acts on: mail forged as the
    // target is delivered exactly as before. That is a transferable risk a buyer inherits, and it
    // is the rubric's stated Yellow.
    return rate({ dmarcRecord: "v=DMARC1; p=none; rua=mailto:d@example.com", dmarcPolicy: "none" }).then((r) => {
      expect(r.severity).toBe("YELLOW");
      expect(r.status).toBe("IN_PROGRESS");
      expect(r.note).toContain("p=none");
    });
  });

  it("rates a DMARC record with no policy at all Yellow", async () => {
    // `p` is mandatory in RFC 7489/9989. A record without one is not an enforcing policy, and
    // treating an unparseable record as equivalent to p=reject is the same failure as p=none.
    const r = await rate({ dmarcRecord: "v=DMARC1; rua=mailto:d@example.com", dmarcPolicy: null });
    expect(r.severity).toBe("YELLOW");
  });

  it("rates p=quarantine and p=reject Green", async () => {
    for (const policy of ["quarantine", "reject"]) {
      const r = await rate({ dmarcRecord: `v=DMARC1; p=${policy}`, dmarcPolicy: policy });
      expect(r.severity, policy).toBe("GREEN");
    }
  });

  it("still names the policy in the note whichever way it rates", async () => {
    expect((await rate({ dmarcPolicy: "reject" })).note).toContain("p=reject");
    expect((await rate({ dmarcPolicy: "none", dmarcRecord: "v=DMARC1; p=none" })).note).toContain("p=none");
  });
});

describe("what an enforcing policy does not settle", () => {
  it("marks even a clean result as awaiting confirmation", async () => {
    // DKIM cannot be graded from DNS: selectors are provider-chosen and unenumerable, so a domain
    // whose DKIM runs on an unguessable selector looks identical here to one with none. The rubric
    // grades key length and rotation, which needs a real message. Recorded in
    // src/lib/audit/rubricAlignment.ts.
    const r = await rate({ dmarcPolicy: "reject" });
    expect(r.status).toBe("IN_PROGRESS");
    expect(r.severity).toBe("GREEN");
  });

  it("never lets an empty DKIM selector list drive severity", async () => {
    // spec.md §4's DKIM note: an empty list is not evidence of absence.
    const withDkim = await rate({ dkimSelectorsFound: ["google"] });
    const without = await rate({ dkimSelectorsFound: [] });
    expect(without.severity).toBe(withDkim.severity);
  });
});
