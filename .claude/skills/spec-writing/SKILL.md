---
name: spec-writing
description: "Write or update CloseCheck's product specification (docs/spec.md) — new feature specs, resolving an open question, changing a data-model or tier decision. Triggers on: spec, specification, define requirements, feature spec, update the spec, what should this feature do."
---

# spec-writing

Maintains `docs/spec.md`, the single source of truth for what CloseCheck *is*. This skill is about
product decisions and their rationale, not implementation detail — architecture lives in `spec.md`
§10 only at the level needed to size the roadmap, not as a design doc.

## Before writing anything

Read, in order:

1. `docs/idea.md` — the origin story and the evidence base. Any new feature or decision must trace
   back to something in here, or explicitly extend it with a stated reason. Do not add scope that
   isn't grounded in the original evidence (buyer-side referral-network blockage, the DueDilio/Rapid
   Diligence provider-side signal) without flagging that it's a new, unvalidated assumption.
2. `docs/spec.md` §2 (product principles) and §12 (open questions) — check whether what you're about
   to write contradicts a principle or silently resolves an open question without saying so.
3. `docs/roadmap.md` — a spec change that isn't reflected in the roadmap's phase sequencing is
   incomplete. If the change affects scope of an unstarted phase, that phase's deliverables need a
   matching edit (hand off to the `roadmap-planning` skill, don't do it inline unless it's a one-line
   consistency fix).

## Writing conventions

- **Consultant-facing framing, always.** Every feature description should be legible in terms of "what
  does the consultant do / get," per `spec.md` §2 principle 1. If a sentence describes the acquisition
  buyer's experience as the primary framing, rewrite it — the buyer is the end-reader, not the
  customer (see `spec.md` §1).
- **Tier boundaries are not negotiable inline.** Any change that would let a Tier A item require
  seller cooperation, or a Tier C item skip live access, is a tier-model change, not a checklist edit —
  flag it explicitly rather than slipping it into an item's description. Coordinate with the
  `audit-methodology` skill for checklist-content-level changes; this skill owns the tier *model*,
  that skill owns tier *content*.
- **Decisions get a rationale, not just an answer.** When resolving an open question from §12, write
  it the way §7 (client portal) and §9 (pricing) are written: state the decision, then the reasoning,
  then move the resolved item out of §12. A decision without a "why" is not usable later when it needs
  revisiting.
- **New open questions get added to §12**, not left implicit in prose elsewhere.
- **Data model changes (§3) are the highest-blast-radius edits** — anything that changes what an
  Engagement, Audit, Finding, or Report *is* affects the architecture (§10), the report structure (§6),
  and potentially data retention (§8). Check all three sections before finalizing a §3 edit.

## When a spec change has security/trust implications

`spec.md` §8 exists because this product's core risk is reputational (see the section's own framing).
Any change touching document upload, credential handling, cross-tenant access, or retention must
update §8 explicitly, and should be flagged for the `domain-code-review` skill's checklist once
implementation starts — don't let a spec change silently widen what the security section promises.

## Output

Edit `docs/spec.md` directly (it's a living document, not a changelog of proposals). For a
substantial addition (a new §, not a line edit), keep the numbered-section structure and slot the new
section in logically rather than appending at the end. Cross-reference other docs (`idea.md`,
`roadmap.md`, `releases.md`) by relative link, as the existing sections do.
