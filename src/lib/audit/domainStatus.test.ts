import { describe, expect, it } from "vitest";

import { __domainStatusInternals } from "./tierA";

const { normalizeStatus, BLOCKING_DOMAIN_STATUSES, TRANSFER_FRICTION_STATUSES } =
  __domainStatusInternals;

describe("EPP status normalisation", () => {
  it("treats every spelling registries actually use as the same status", () => {
    // Verified against live registry responses: RDAP returns "server transfer prohibited" while
    // legacy WHOIS returns "serverTransferProhibited". Matching either literally misses the other,
    // and a status check that quietly matches nothing reads as "checked, nothing found".
    for (const spelling of [
      "server transfer prohibited",
      "serverTransferProhibited",
      "SERVER_TRANSFER_PROHIBITED",
      "server-transfer-prohibited",
    ]) {
      expect(TRANSFER_FRICTION_STATUSES[normalizeStatus(spelling)], spelling).toBeDefined();
    }
  });

  it("recognises the statuses that stop a transfer outright", () => {
    for (const status of ["pending delete", "redemptionPeriod", "server hold", "clientHold"]) {
      expect(BLOCKING_DOMAIN_STATUSES[normalizeStatus(status)], status).toBeDefined();
    }
  });

  it("does not flag the ordinary registrar lock", () => {
    // clientTransferProhibited sits on most domains by default. Flagging it would fire on nearly
    // every audit, which is how a check gets ignored.
    const key = normalizeStatus("client transfer prohibited");
    expect(BLOCKING_DOMAIN_STATUSES[key]).toBeUndefined();
    expect(TRANSFER_FRICTION_STATUSES[key]).toBeUndefined();
  });

  it("does not flag an ordinary healthy domain", () => {
    // These are the exact statuses live lookups returned for example.com and robertos.com.
    for (const status of ["ok", "client delete prohibited", "client update prohibited", "client renew prohibited"]) {
      const key = normalizeStatus(status);
      expect(BLOCKING_DOMAIN_STATUSES[key], status).toBeUndefined();
      expect(TRANSFER_FRICTION_STATUSES[key], status).toBeUndefined();
    }
  });
});

describe("statuses the published rubric rates Red", () => {
  // Template v4's severityGuidance for this item names these explicitly as Red. An adversarial run
  // drove each through the runner and found them rating PASS/GREEN with a note reading as a clean
  // bill of health — a lapsed or mid-recovery registration reported as healthy.
  it("recognises a lapsed or recovering registration", () => {
    for (const status of ["pendingRestore", "autoRenewPeriod", "redemptionPeriod", "pendingDelete"]) {
      expect(BLOCKING_DOMAIN_STATUSES[normalizeStatus(status)], status).toBeDefined();
    }
  });

  it("recognises a registry block on renewal", () => {
    expect(BLOCKING_DOMAIN_STATUSES[normalizeStatus("serverRenewProhibited")]).toBeDefined();
  });

  it("recognises a domain with no nameservers delegated", () => {
    // `inactive` means the domain does not resolve at all — practically identical to serverHold,
    // and it was rating Green.
    expect(BLOCKING_DOMAIN_STATUSES[normalizeStatus("inactive")]).toBeDefined();
  });
});
