import { describe, expect, it } from "vitest";

import {
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
