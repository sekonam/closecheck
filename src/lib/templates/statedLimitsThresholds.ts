/**
 * Template v6 — "an automated Green says what it checked".
 *
 * v5 corrected two rubrics that disagreed with the runner rating the same item. Its scope was set
 * by the two divergences that had been noticed, not by a sweep, and a review of the remaining five
 * automated items found three more of the same shape — worse, because these ended in a confirmed
 * PASS rather than a disagreement:
 *
 * - **DNS provider and hosting.** The rubric reserves Green for accounts "the seller can
 *   demonstrate control of and that are on the asset schedule", and makes DNS held by a party
 *   outside the transaction a Red. The runner identified nameservers and returned PASS/GREEN. A
 *   target whose DNS sat with a web agency that is not party to the sale — the rubric's own Red —
 *   got the same confirmed Green as one where the seller had proved control.
 * - **Mail provider.** Green requires administrative control on an account on the asset schedule.
 *   The runner returned PASS/GREEN from MX records, so a Google Workspace tenant owned personally
 *   by the departing founder was indistinguishable from one being sold. Verified against three live
 *   domains, all PASS/GREEN on MX identification alone.
 * - **HTTPS hygiene.** Green also requires no blockable mixed content and no TLS 1.0/1.1 offered by
 *   choice; the runner checks neither. Its rubric additionally contradicted itself — Green requires
 *   HSTS, while a later sentence says a missing HSTS header "is not on its own a Yellow", leaving
 *   the redirect-without-HSTS case in no band at all. Live on toasttab.com and vagaro.com.
 *
 * WHAT THIS REVISION DOES, AND WHAT THE CODE DOES BESIDE IT
 * --------------------------------------------------------
 * These gaps cannot be closed. Whether a seller can demonstrate control of an account is not
 * observable from public records by any means, and inventing a signal for it would be worse than
 * admitting the limit. So the rubric states what the automated pass covered and what the consultant
 * must still confirm, and the runners now return IN_PROGRESS rather than PASS — which makes these
 * count as awaiting confirmation in the coverage the report prints (spec.md §6) instead of as
 * finished ratings.
 *
 * The severity stays Green. What the runner observed is genuinely unremarkable, and downgrading it
 * would invent a concern rather than state a gap.
 *
 * WHY THE SWEEP IS NOW ENFORCED
 * ----------------------------
 * src/lib/audit/rubricAlignment.ts records, for every automated check, what the runner can
 * determine and what its rubric asks for beyond that — and the test fails if a runner has no
 * judgement recorded, or if an item that admits a gap does not state it in the published rubric.
 * v5's omission was possible because nothing required the comparison to be made for every item;
 * that is the part worth fixing once rather than remembering each revision.
 */

import type { TemplateItemInput } from "./publish";
import { buildRunnerAlignedItems } from "./runnerAlignedThresholds";

export const V6_CHANGE_NOTE =
  "v6 — an automated Green now says what it actually checked. The DNS, mail-provider and " +
  "HTTPS-hygiene rubrics reserve Green for control the seller can demonstrate on accounts on the " +
  "asset schedule, and for the absence of mixed content and legacy TLS; none of that is visible to " +
  "an automated check, which nonetheless returned a confirmed pass. Each rubric now states what the " +
  "automated pass covered and what remains for the consultant, and those runners return a rating " +
  "marked in progress rather than finished. Also resolves the HTTPS rubric contradicting itself on " +
  "whether a missing HSTS header can sit inside Green.";

type Edit = { find: string; replace: string };

const DNS_LIMIT =
  " WHAT THE AUTOMATED CHECK COVERED. It reads the published nameservers and A records and names the " +
  "likely provider. It cannot see any of what Green actually turns on: confirm the seller controls " +
  "the DNS account, that the account is on the asset schedule, and that they can publish a TXT " +
  "record on request. An agency or developer holding the zone looks exactly like the seller holding " +
  "it from public records, and that case is a Red under this rubric — so an automated pass here is " +
  "the starting point for that question, not an answer to it.";

const MAIL_LIMIT =
  " WHAT THE AUTOMATED CHECK COVERED. It reads the MX records and names the likely provider. " +
  "Administrative control is the whole of what Green requires and none of what this observes: a " +
  "Google Workspace or Microsoft 365 tenant owned personally by a departing founder publishes " +
  "exactly the same MX records as one on the asset schedule. Confirm who administers the tenant and " +
  "that it transfers.";

const HTTPS_LIMIT =
  " WHAT THE AUTOMATED CHECK COVERED. It fetches the site once and observes the redirect and the " +
  "HSTS header. It does not load customer-facing pages to look for blockable mixed content, and it " +
  "does not enumerate the TLS versions the server offers — both of which this rubric's Green " +
  "requires and its Yellow turns on. Check those before accepting an automated pass.";

const HSTS_CLARIFICATION =
  "A missing strict-transport-security header is worth noting and is not on its own a Yellow: it " +
  "belongs in the finding as an observation, and the automated check reports it either way. Green " +
  "with HSTS absent is therefore available and is what the automated check returns, but only once " +
  "the mixed-content and TLS-version conditions below have been confirmed by hand.";


const EMAIL_LIMIT =
  " WHAT THE AUTOMATED CHECK COVERED. It reads the SPF and DMARC records as published and derives " +
  "the effective enforcement policy from them, which is most of this item. DKIM it can only guess " +
  "at: selectors are not discoverable from DNS, so the check probes a handful of common ones and " +
  "reports what answers. A domain whose DKIM runs on an unguessable selector is indistinguishable " +
  "here from one with no DKIM at all, and neither key length nor rotation can be measured without " +
  "a real message from the business's own sending system. Get one — a forwarded message with full " +
  "headers — before rating the DKIM half of this item either way.";

const EDITS: Record<string, Edit[]> = {
  "DNS provider and hosting fingerprint": [
    { find: "Green if both resolve to accounts the seller can demonstrate control of and that are on the asset schedule.",
      replace: "Green if both resolve to accounts the seller can demonstrate control of and that are on the asset schedule." + DNS_LIMIT },
  ],
  "Mail provider fingerprint": [
    { find: "Red only where the records show mail is delivered somewhere outside the seller's control.",
      replace: "Red only where the records show mail is delivered somewhere outside the seller's control." + MAIL_LIMIT },
  ],
  "Email authentication posture (SPF / DMARC; DKIM best-effort)": [
    // Found by the alignment registry rather than by reading: the rubric grades DKIM in detail —
    // key length, rotation cadence, RFC 8301 minimums — while the automated check cannot see a
    // selector it did not guess, and cannot measure a key it never retrieved.
    { find: "Cite M3AAWG only for the six-month rotation cadence",
      replace: EMAIL_LIMIT.trimStart() + " Cite M3AAWG only for the six-month rotation cadence" },
  ],
  "HTTPS hygiene": [
    { find: "A missing strict-transport-security header is worth noting but is not on its own a Yellow.",
      replace: HSTS_CLARIFICATION },
    { find: "Red is reserved for plain HTTP on a page that takes credentials, payment or customer data, or a server offering only TLS 1.0/1.1.",
      replace: "Red is reserved for plain HTTP on a page that takes credentials, payment or customer data, or a server offering only TLS 1.0/1.1." + HTTPS_LIMIT },
  ],
};

export function applyEdits(item: TemplateItemInput): TemplateItemInput {
  const edits = EDITS[item.title];
  if (!edits) return item;
  if (!item.severityGuidance) {
    throw new Error(`Template v6 edits "${item.title}", which carries no severity rubric to edit.`);
  }

  let guidance = item.severityGuidance;
  for (const { find, replace } of edits) {
    if (!guidance.includes(find)) {
      throw new Error(
        `Template v6 could not find its anchor in "${item.title}":\n  ${find.slice(0, 120)}…\n` +
          "The upstream text changed underneath this revision. Re-anchor the edit — an edit that " +
          "matches nothing applies nothing, and would publish older content under a v6 change note.",
      );
    }
    guidance = guidance.replace(find, replace);
  }
  return { ...item, severityGuidance: guidance };
}

export function assertEditCoverage(previousTitles: Iterable<string>): void {
  const known = new Set(previousTitles);
  const orphans = Object.keys(EDITS).filter((title) => !known.has(title));
  if (orphans.length > 0) {
    throw new Error(
      `Template v6 edits items that v5 does not produce: ${orphans.join("; ")}. The title changed ` +
        "or the item was retired — an edit keyed to nothing applies to nothing.",
    );
  }
}

/** Builds the full v6 item set for one template slug. */
export function buildStatedLimitsItems(
  slug: string,
  specificItems: TemplateItemInput[],
): TemplateItemInput[] {
  const previous = buildRunnerAlignedItems(slug, specificItems);
  assertEditCoverage(previous.map((item) => item.title));
  return previous.map(applyEdits);
}
