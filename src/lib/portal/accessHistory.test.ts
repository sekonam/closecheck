import { describe, expect, it } from "vitest";

import {
  collapseEmbeddedFetches,
  describeAccessSummary,
  labelOrigins,
  summarizeAccess,
  type AccessEntry,
} from "./accessHistory";

function entry(id: string, iso: string, ipHash: string | null): AccessEntry {
  return { id, viewedAt: new Date(iso), ipHash };
}

describe("labelOrigins", () => {
  it("labels distinct origins in first-seen order, regardless of input order", () => {
    // The page renders newest-first, so the input arrives reverse-chronological. "Viewer A" must
    // still mean the first person who opened the link, not the most recent.
    const labels = labelOrigins([
      entry("3", "2026-09-20T10:00:00Z", "hash-second"),
      entry("2", "2026-09-19T10:00:00Z", "hash-first"),
      entry("1", "2026-09-18T10:00:00Z", "hash-first"),
    ]);
    expect(labels.get("hash-first")).toBe("Viewer A");
    expect(labels.get("hash-second")).toBe("Viewer B");
  });

  it("gives repeat visits from one origin a single label", () => {
    // This is the question a consultant actually asks — did they come back, or was it a new person.
    const labels = labelOrigins([
      entry("1", "2026-09-18T10:00:00Z", "same"),
      entry("2", "2026-09-18T11:00:00Z", "same"),
      entry("3", "2026-09-19T09:00:00Z", "same"),
    ]);
    expect(labels.size).toBe(1);
  });

  it("skips entries with no recorded origin rather than grouping them together", () => {
    // Two views that both arrived without a forwarded address are not evidence of the same viewer.
    const labels = labelOrigins([
      entry("1", "2026-09-18T10:00:00Z", null),
      entry("2", "2026-09-18T11:00:00Z", null),
      entry("3", "2026-09-18T12:00:00Z", "real"),
    ]);
    expect(labels.size).toBe(1);
    expect(labels.get("real")).toBe("Viewer A");
  });

  it("handles an empty log", () => {
    expect(labelOrigins([]).size).toBe(0);
  });

  it("does not mutate the array it is given", () => {
    const entries = [
      entry("1", "2026-09-20T10:00:00Z", "b"),
      entry("2", "2026-09-19T10:00:00Z", "a"),
    ];
    labelOrigins(entries);
    expect(entries.map((e) => e.id)).toEqual(["1", "2"]);
  });

  it("keeps labelling past the first letter", () => {
    const entries = Array.from({ length: 4 }, (_, index) =>
      entry(`${index}`, `2026-09-1${index}T10:00:00Z`, `hash-${index}`),
    );
    const labels = labelOrigins(entries);
    expect([...labels.values()]).toEqual(["Viewer A", "Viewer B", "Viewer C", "Viewer D"]);
  });
});

describe("labelling past the alphabet", () => {
  it("rolls over to AA rather than running off the end", () => {
    // String.fromCharCode(65 + n) labels the 27th origin "Viewer [" — the kind of thing nobody
    // notices until a widely forwarded report produces it in front of a client.
    const entries = Array.from({ length: 28 }, (_, index) =>
      entry(`${index}`, new Date(Date.UTC(2026, 0, 1, 0, index)).toISOString(), `hash-${index}`),
    );
    const labels = [...labelOrigins(entries).values()];
    expect(labels[25]).toBe("Viewer Z");
    expect(labels[26]).toBe("Viewer AA");
    expect(labels[27]).toBe("Viewer AB");
  });
});

describe("summary line", () => {
  it("counts views, origins and unattributed views separately", () => {
    // The bug this guards: distinctOrigins skips null-hash entries, so 2 hashed + 3 unattributed
    // views rendered "viewed 5 times from 2 origins" — on the one line a consultant is most likely
    // to repeat to a client.
    const summary = summarizeAccess([
      entry("1", "2026-09-18T10:00:00Z", "a"),
      entry("2", "2026-09-18T11:00:00Z", "b"),
      entry("3", "2026-09-18T12:00:00Z", null),
      entry("4", "2026-09-18T13:00:00Z", null),
      entry("5", "2026-09-18T14:00:00Z", null),
    ]);
    expect(summary).toEqual({ totalViews: 5, distinctOrigins: 2, unattributedViews: 3 });
    expect(describeAccessSummary(summary)).toBe(
      "viewed 5 times — 2 origins, 3 without a recorded origin",
    );
  });

  it("stays quiet when there is nothing to qualify", () => {
    const summary = summarizeAccess([entry("1", "2026-09-18T10:00:00Z", "a")]);
    expect(describeAccessSummary(summary)).toBe("viewed 1 time");
  });

  it("says never viewed for an empty log", () => {
    expect(describeAccessSummary(summarizeAccess([]))).toBe("never viewed");
  });
});

describe("collapsing the page's own embedded viewer", () => {
  function at(id: string, secondsFromStart: number, kind: "PAGE" | "DOCUMENT", ipHash: string | null = "a") {
    return { id, viewedAt: new Date(Date.UTC(2026, 8, 22, 12, 0, secondsFromStart)), ipHash, kind };
  }

  it("counts a page view and its own viewer's fetch as one access", () => {
    const collapsed = collapseEmbeddedFetches([at("page", 0, "PAGE"), at("embed", 1, "DOCUMENT")]);
    expect(collapsed.map((e) => e.id)).toEqual(["page"]);
  });

  it("keeps a download that is not a page's own viewer", () => {
    // The forgeable-header version treated this as the embedded viewer and wrote no row at all:
    // ten complete downloads left the trail reading "never viewed".
    const collapsed = collapseEmbeddedFetches([at("direct", 0, "DOCUMENT")]);
    expect(collapsed.map((e) => e.id)).toEqual(["direct"]);
  });

  it("absorbs only ONE fetch per page view", () => {
    // A viewer fetches the report once. A second fetch in the same window is somebody downloading
    // it, and must survive into the trail.
    const collapsed = collapseEmbeddedFetches([
      at("page", 0, "PAGE"),
      at("embed", 1, "DOCUMENT"),
      at("download", 2, "DOCUMENT"),
    ]);
    expect(collapsed.map((e) => e.id)).toEqual(["page", "download"]);
  });

  it("does not absorb a fetch from a different origin", () => {
    // A forwarded link opened elsewhere at the same moment is a separate viewer, not this page's.
    const collapsed = collapseEmbeddedFetches([
      at("page", 0, "PAGE", "a"),
      at("elsewhere", 1, "DOCUMENT", "b"),
    ]);
    expect(collapsed.map((e) => e.id)).toEqual(["page", "elsewhere"]);
  });

  it("does not absorb a fetch well after the page view", () => {
    const collapsed = collapseEmbeddedFetches([at("page", 0, "PAGE"), at("later", 30, "DOCUMENT")]);
    expect(collapsed.map((e) => e.id)).toEqual(["page", "later"]);
  });

  it("does not absorb a fetch that preceded the page view", () => {
    const collapsed = collapseEmbeddedFetches([at("before", 0, "DOCUMENT"), at("page", 1, "PAGE")]);
    expect(collapsed.map((e) => e.id)).toEqual(["before", "page"]);
  });

  it("pairs each page view with its own fetch when several visits arrive together", () => {
    const collapsed = collapseEmbeddedFetches([
      at("page1", 0, "PAGE"),
      at("embed1", 1, "DOCUMENT"),
      at("page2", 2, "PAGE"),
      at("embed2", 3, "DOCUMENT"),
    ]);
    expect(collapsed.map((e) => e.id)).toEqual(["page1", "page2"]);
  });

  it("leaves entries with no kind alone", () => {
    // Rows written before the discriminator existed default to PAGE and must not be absorbed.
    const collapsed = collapseEmbeddedFetches([
      { id: "legacy", viewedAt: new Date("2026-05-01T00:00:00Z"), ipHash: "a" },
    ]);
    expect(collapsed.map((e) => e.id)).toEqual(["legacy"]);
  });
});
