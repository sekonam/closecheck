import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  __resetRdapBootstrapCacheForTests,
  lookupRdap,
  parseRdapDomain,
  type RdapDomainResponse,
} from "./rdap";

const registryFixture: RdapDomainResponse = {
  events: [
    { eventAction: "registration", eventDate: "1997-09-15T04:00:00Z" },
    { eventAction: "expiration", eventDate: "2028-09-14T04:00:00Z" },
    { eventAction: "last changed", eventDate: "2019-09-09T15:39:04Z" },
  ],
  entities: [
    {
      roles: ["registrar"],
      vcardArray: ["vcard", [["fn", {}, "text", "MarkMonitor Inc."]]],
    },
    {
      roles: ["registrant"],
      vcardArray: [
        "vcard",
        [
          ["fn", {}, "text", "Example Registrant"],
          ["org", {}, "text", "Example LLC"],
        ],
      ],
    },
  ],
};

describe("parseRdapDomain", () => {
  it("extracts registrar, dates, and registrant org from a registry response", () => {
    expect(parseRdapDomain(registryFixture)).toEqual({
      registrar: "MarkMonitor Inc.",
      createdDate: "1997-09-15T04:00:00Z",
      expiryDate: "2028-09-14T04:00:00Z",
      registrantOrg: "Example LLC",
      lastTransferDate: null,
      lastChangedDate: "2019-09-09T15:39:04Z",
      statuses: [],
    });
  });

  it("finds a registrar nested inside another entity", () => {
    const nested: RdapDomainResponse = {
      entities: [
        {
          roles: ["technical"],
          entities: [{ roles: ["registrar"], vcardArray: ["vcard", [["fn", {}, "text", "Nested Registrar"]]] }],
        },
      ],
    };
    expect(parseRdapDomain(nested).registrar).toBe("Nested Registrar");
  });

  it("falls back to registrant fn when org is absent, and null when redacted", () => {
    const fnOnly: RdapDomainResponse = {
      entities: [{ roles: ["registrant"], vcardArray: ["vcard", [["fn", {}, "text", "Jane Owner"]]] }],
    };
    expect(parseRdapDomain(fnOnly).registrantOrg).toBe("Jane Owner");

    const redacted: RdapDomainResponse = {
      entities: [{ roles: ["registrant"], vcardArray: ["vcard", []] }],
    };
    expect(parseRdapDomain(redacted).registrantOrg).toBeNull();
  });

  it("returns all-null fields for an empty response rather than throwing", () => {
    expect(parseRdapDomain({})).toEqual({
      registrar: null,
      createdDate: null,
      expiryDate: null,
      registrantOrg: null,
      lastTransferDate: null,
      lastChangedDate: null,
      statuses: [],
    });
  });
});

describe("lookupRdap", () => {
  const bootstrapFixture = {
    services: [
      [["com", "net"], ["https://rdap.verisign.example/v1/"]],
      [["dev"], ["http://insecure.example/", "https://rdap.google.example/"]],
    ],
  };

  beforeEach(() => {
    __resetRdapBootstrapCacheForTests();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  function stubFetchSequence(responses: Array<{ ok: boolean; status?: number; body?: unknown }>) {
    let call = 0;
    const urls: string[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string) => {
        urls.push(String(url));
        const next = responses[Math.min(call++, responses.length - 1)];
        return {
          ok: next.ok,
          status: next.status ?? 200,
          json: async () => next.body,
        };
      }),
    );
    return urls;
  }

  it("resolves the TLD via the IANA bootstrap file and queries that server", async () => {
    const urls = stubFetchSequence([
      { ok: true, body: bootstrapFixture },
      { ok: true, body: registryFixture },
    ]);

    const result = await lookupRdap(" example.com".trim());
    expect(urls[0]).toBe("https://data.iana.org/rdap/dns.json");
    expect(urls[1]).toBe("https://rdap.verisign.example/v1/domain/example.com");
    expect(result.error).toBeNull();
    expect(result.registrar).toBe("MarkMonitor Inc.");
    expect(result.raw).toContain("MarkMonitor");
  });

  it("prefers an https base URL when the bootstrap lists several", async () => {
    const urls = stubFetchSequence([
      { ok: true, body: bootstrapFixture },
      { ok: true, body: registryFixture },
    ]);
    await lookupRdap("example.dev");
    expect(urls[1]).toBe("https://rdap.google.example/domain/example.dev");
  });

  it("returns an error (not a throw) for a TLD with no RDAP server", async () => {
    stubFetchSequence([{ ok: true, body: bootstrapFixture }]);
    const result = await lookupRdap("example.zz");
    expect(result.error).toContain(".zz");
    expect(result.registrar).toBeNull();
  });

  it("returns an error when the registry answers with an HTTP failure", async () => {
    stubFetchSequence([
      { ok: true, body: bootstrapFixture },
      { ok: false, status: 404 },
    ]);
    const result = await lookupRdap("missing.com");
    expect(result.error).toContain("404");
  });
});

describe("transfer and lifecycle signals", () => {
  it("reads the transfer event and EPP statuses a buyer needs", () => {
    // ICANN's Transfer Policy locks a domain for 60 days after a change of registrant, so when it
    // last changed hands decides whether it can move again before the close.
    const parsed = parseRdapDomain({
      events: [
        { eventAction: "registration", eventDate: "2019-01-02T00:00:00Z" },
        { eventAction: "expiration", eventDate: "2027-01-02T00:00:00Z" },
        { eventAction: "transfer", eventDate: "2026-09-01T00:00:00Z" },
        { eventAction: "last changed", eventDate: "2026-09-10T00:00:00Z" },
      ],
      status: ["client transfer prohibited", "server hold"],
    });
    expect(parsed.lastTransferDate).toBe("2026-09-01T00:00:00Z");
    expect(parsed.lastChangedDate).toBe("2026-09-10T00:00:00Z");
    expect(parsed.statuses).toEqual(["client transfer prohibited", "server hold"]);
  });

  it("keeps a transfer distinct from any other modification", () => {
    // Conflating the two would turn a routine contact-detail edit into a false transfer-lock
    // warning, which is worse than no warning: it trains a consultant to ignore the signal.
    const parsed = parseRdapDomain({
      events: [{ eventAction: "last changed", eventDate: "2026-09-10T00:00:00Z" }],
    });
    expect(parsed.lastTransferDate).toBeNull();
    expect(parsed.lastChangedDate).toBe("2026-09-10T00:00:00Z");
  });
});
