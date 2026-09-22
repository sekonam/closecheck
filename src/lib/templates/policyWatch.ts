/**
 * The dated facts under the checklist, and who is responsible for them.
 *
 * THE PROBLEM THIS SOLVES
 * -----------------------
 * Template versioning protects a consultant from *us* changing a rubric underneath an audit in
 * flight: `Audit.templateId` is a hard FK, so an audit started against v4 stays on v4. It does
 * nothing about the *world* changing underneath a pinned template. Several of v4's thresholds are
 * correct as of a date rather than indefinitely, and the sharpest is ICANN's Transfer Policy: the
 * revision removing the 60-day transfer lock was adopted on 2026-06-07 with no effective date and
 * no published implementation text, so the 60-day lock is right today and will stop being right
 * without warning.
 *
 * v4 handled this by telling the consultant, in template prose, to "RE-VERIFY AT THE AUDIT DATE".
 * That is honest and it is the wrong place to put it: it moves a maintenance burden we created onto
 * the person paying us to remove maintenance burden, which is the opposite of what §2 principle 2
 * sells. docs/spec.md §12 recorded that as an open question and asked for a decision before a
 * second dated threshold moved.
 *
 * THE DECISION: SORT BY WHO CAN ACTUALLY KNOW
 * -------------------------------------------
 * The three kinds of dated fact are not one problem, and lumping them together is what made the
 * answer look like a banner on every item.
 *
 * - **SCHEDULED** — the change and its effective date are both published. Nobody needs to remember
 *   anything and nobody needs to be told: the product holds the schedule and resolves the value at
 *   the audit date. The CA/Browser Forum's certificate-lifetime cap is this — 398 days, 200 from
 *   2026-03-15, 100 from 2027-03-15, 47 from 2029-03-15, all published in one table years ahead.
 *
 * - **ADOPTED_UNDATED** — the change is known and its date is genuinely unknowable, so no schedule
 *   can be written and no amount of diligence on our side produces the answer. This is the only
 *   kind the consultant is told about, because it is the only kind where their judgement at the
 *   audit date is actually load-bearing. ICANN's Transfer Policy revision is this.
 *
 * - **DATED_READING** — no known change at all; a fact read from a primary source on a date, which
 *   could move silently. A vendor help article saying an export retains 48 months is this. Telling
 *   a consultant "this was true in September" on every such item would be noise that trains them to
 *   ignore the notices that matter. So this kind is never surfaced in the app. It is held by a
 *   review date and enforced by the test suite.
 *
 * WHO HOLDS IT, CONCRETELY
 * ------------------------
 * Every entry carries `reviewBy`, and policyWatch.test.ts fails once that date passes. That is the
 * answer to "who re-verifies, and how often": not a person who has to remember, which is the
 * commitment that was silently unowned — the build stops being green, names the entry, says what to
 * re-read and links the primary source. A lapse becomes loud instead of invisible.
 *
 * Deliberately code, not database rows: these are product-owned facts like the templates
 * themselves, they must be reviewable in a diff, and the enforcement is a test.
 */

/** Which kind of dated fact this is — see the module docstring; the kind decides who is told. */
export type WatchKind = "SCHEDULED" | "ADOPTED_UNDATED" | "DATED_READING";

export type ScheduleStep = {
  /** Inclusive: the value applies to audits run on or after this date. */
  effectiveFrom: string;
  value: string;
};

export type PolicyWatch = {
  key: string;
  kind: WatchKind;
  /** What the fact is, in one line, for the person doing the re-reading. */
  title: string;
  /** Exact TemplateItem titles this bears on. Checked against the live template by the test. */
  appliesTo: string[];
  /** Primary source. Not a blog post, not a vendor summary of a standard. */
  source: string;
  /** When this was last read against that source. */
  verifiedOn: string;
  /** When it must be read again. Past this date the suite fails. */
  reviewBy: string;
  /** What to look for on re-reading, written for whoever picks it up cold. */
  whatToCheck: string;
  /** SCHEDULED only: the published timetable, oldest first. */
  schedule?: ScheduleStep[];
  /**
   * ADOPTED_UNDATED only: shown to the consultant at audit time. One or two sentences, naming the
   * specific thing that may have moved and what to do — never a generic "verify this".
   */
  consultantNotice?: string;
};

export const POLICY_WATCHES: PolicyWatch[] = [
  {
    key: "icann-transfer-policy",
    kind: "ADOPTED_UNDATED",
    title: "ICANN Transfer Policy — the 60-day locks",
    appliesTo: ["Domain and registrar ownership, expiration"],
    source: "https://www.icann.org/resources/pages/transfer-policy-2016-06-01-en",
    verifiedOn: "2026-09-22",
    // Short horizon on purpose: this is the fastest-moving fact in the checklist and the one the
    // runner hardcodes a number for (TRANSFER_LOCK_DAYS in src/lib/audit/tierA.ts).
    reviewBy: "2026-12-22",
    whatToCheck:
      "Whether an Implementation Review Team text and an effective date have been published for the " +
      "revision adopted by Resolution 2026.06.07.04 on 2026-06-07. If they have, the 60-day " +
      "Change-of-Registrant lock is removed and the creation and transfer locks become 720-hour " +
      "(30-day) locks — which changes TRANSFER_LOCK_DAYS in src/lib/audit/tierA.ts, the domain " +
      "item's severity rubric, and the binding term ('AuthInfo code' becomes 'Transfer Authorization " +
      "Code'). Registrars asked for an 18-month buffer after implementation concludes, so adoption " +
      "alone is not the trigger.",
    consultantNotice:
      "ICANN adopted a revision to the Transfer Policy on 7 June 2026 that removes the 60-day " +
      "Change-of-Registrant lock and shortens the others to 30 days. It was not in force when this " +
      "item was last verified, and it has no published effective date — so the 60-day windows below " +
      "are the ones to apply unless your registrar tells you otherwise. Confirm with the registrar " +
      "before making a lock window a closing condition.",
  },
  {
    key: "cabforum-certificate-lifetime",
    kind: "SCHEDULED",
    title: "CA/Browser Forum maximum certificate lifetime",
    appliesTo: ["SSL/TLS certificate validity, issuer, expiration"],
    source: "https://cabforum.org/working-groups/server/baseline-requirements/requirements/",
    verifiedOn: "2026-09-22",
    // Not "long, because the timetable is published to 2029" — that was the first answer and the
    // suite rejected it. Resolving the current value needs no review, but confirming the SCHEDULE
    // has not been amended must happen BEFORE the next step lands: if the 100-day step is delayed
    // or revised in early 2027 and nobody looks until September, the product asserts a cap that is
    // not in force for six months, which is the exact silent staleness this mechanism exists to
    // prevent. A month of margin ahead of 2027-03-15.
    reviewBy: "2027-02-15",
    whatToCheck:
      "That Baseline Requirements §1.2.2's 'Relevant Dates' table still carries this timetable. Demand " +
      "the verbatim rows — an automated read of that page returned a wrong schedule on first attempt " +
      "during the v4 research, and Apple's support page 102028 is stale at 398 days.",
    schedule: [
      { effectiveFrom: "2020-09-01", value: "398 days" },
      { effectiveFrom: "2026-03-15", value: "200 days" },
      { effectiveFrom: "2027-03-15", value: "100 days" },
      { effectiveFrom: "2029-03-15", value: "47 days" },
    ],
  },
  {
    key: "visa-vamp-thresholds",
    kind: "DATED_READING",
    title: "Visa VAMP merchant Excessive threshold",
    appliesTo: ["Payment processor account standing"],
    source:
      "https://corporate.visa.com/content/dam/VCOM/corporate/visa-perspectives/security-and-trust/documents/visa-acquirer-monitoring-program-fact-sheet-2025.pdf",
    verifiedOn: "2026-09-22",
    reviewBy: "2027-03-22",
    whatToCheck:
      "The merchant Excessive ratio (150 bps from 2026-04-01) and the 1,500 monthly dispute-event " +
      "floor beneath which a merchant is not enumerated. Visa has revised both mid-year before.",
  },
  {
    key: "platform-export-capabilities",
    kind: "DATED_READING",
    title: "POS and booking platform export, retention and transfer mechanics",
    appliesTo: [
      "Data-export test",
      "Live verification of client record count and booking-platform export",
      "Platform account ownership and transfer mechanics",
      "Booking software contract and client-data export terms",
    ],
    source: "docs/research/audit-thresholds-2026-09.md §3.2",
    verifiedOn: "2026-09-22",
    // The shortest horizon here. These are vendor help articles, which change without notice and
    // without a changelog — there is no announcement to watch for, only re-reading.
    reviewBy: "2027-01-22",
    whatToCheck:
      "Each vendor-documented number in §3.2 against the vendor's own current help article: Toast's " +
      "48-month window, six-month filter, 60-day post-closure access and 72-hour export link; " +
      "Square's non-transferability and masked contact details; Clover's five-year/one-year-per-" +
      "request split and seven-day links; Mindbody's cancellation-only migration; Booksy's absent " +
      "export button and ownership-transfer path; Shopify's 60-day order API default.",
  },
  {
    key: "nice-classification-edition",
    kind: "DATED_READING",
    title: "Nice Classification current edition",
    appliesTo: ["Trademark conflict scan on business name / domain"],
    source:
      "https://www.uspto.gov/trademarks/trademark-updates-and-announcements/nice-agreement-current-edition-version-general-remarks",
    verifiedOn: "2026-09-22",
    // New editions take effect on 1 January; reviewing in February catches the changeover without
    // sitting stale through a filing season.
    reviewBy: "2027-02-01",
    whatToCheck:
      "Whether NCL 13-2026 is still current. A new edition takes effect on 1 January and moves goods " +
      "between classes without reclassifying existing registrations, so the guidance's warning about " +
      "a pre-2026 registration's class not matching a current filing needs its years updated.",
  },
];

/** Parses a YYYY-MM-DD as UTC midnight. Deliberately not `new Date(s)` on a bare date string in a
 * comparison against a local-zone `now` — that mixes zones and makes a review date flip a day early
 * or late depending on where the build runs. */
function utcDate(iso: string): number {
  const parsed = Date.parse(`${iso}T00:00:00.000Z`);
  if (Number.isNaN(parsed)) throw new Error(`Not a YYYY-MM-DD date: ${iso}`);
  return parsed;
}

/** Entries whose review date has passed. The test suite fails on a non-empty result. */
export function overdueWatches(asOf: Date): PolicyWatch[] {
  return POLICY_WATCHES.filter((watch) => utcDate(watch.reviewBy) < asOf.getTime());
}

/**
 * The published value in force on a given date, for a SCHEDULED entry.
 *
 * Returns the LAST step whose effectiveFrom has passed, so the answer stays correct for years
 * without anyone touching it — which is the entire point of separating this kind from the others.
 */
export function scheduledValueAt(key: string, asOf: Date): string | null {
  const watch = POLICY_WATCHES.find((w) => w.key === key);
  if (!watch?.schedule) return null;
  let current: string | null = null;
  for (const step of watch.schedule) {
    if (utcDate(step.effectiveFrom) <= asOf.getTime()) current = step.value;
  }
  return current;
}

/**
 * What the consultant is told about this checklist item, if anything.
 *
 * ADOPTED_UNDATED only, by design. SCHEDULED resolves itself and DATED_READING is a commitment we
 * hold, not one to hand over — surfacing either would put a notice on most of the checklist and
 * teach consultants to scroll past the one that matters.
 */
export function consultantNoticesFor(itemTitle: string): string[] {
  return POLICY_WATCHES.filter(
    (watch) => watch.kind === "ADOPTED_UNDATED" && watch.appliesTo.includes(itemTitle),
  ).map((watch) => watch.consultantNotice!);
}

/** Every `appliesTo` must name a live template item. Renaming an item otherwise orphans its watch
 * silently, and an orphaned watch is worse than none: it keeps passing its review and protects
 * nothing. */
export function assertWatchCoverage(liveItemTitles: Iterable<string>): void {
  const live = new Set(liveItemTitles);
  const orphans = POLICY_WATCHES.flatMap((watch) =>
    watch.appliesTo.filter((title) => !live.has(title)).map((title) => `${watch.key} -> "${title}"`),
  );
  if (orphans.length > 0) {
    throw new Error(
      `Policy watches name template items that do not exist:\n  ${orphans.join("\n  ")}\n` +
        "Either the item was renamed (update appliesTo) or the watch outlived its item (remove it).",
    );
  }
}
