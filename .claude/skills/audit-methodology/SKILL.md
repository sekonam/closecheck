---
name: audit-methodology
description: "Add or change a checklist item, a Tier A/B/C classification, or a business-type Template's content in CloseCheck's audit methodology (docs/spec.md §4-5). Triggers on: checklist item, tier A/B/C, template content, new audit item, severity, what should this check, business-type template, restaurant/salon/franchise/ecommerce checklist."
---

# audit-methodology

Owns the actual diligence content: which checklist items exist, which tier they belong to, how
they're scored, and how they differ per business-type Template (`docs/spec.md` §4–5). This is the
product's core IP — the thing consultants are actually paying for is a well-evidenced, repeatable
checklist, not the software shell around it. Treat changes here with the same evidentiary bar as
`docs/idea.md` was built with; this is not routine feature work.

## Before adding or changing a checklist item

1. **Ask where the evidence comes from.** `idea.md` and the source research
   (`~/dev/webdevprofit/research/bizbuysell-main-street-tech-audit/build.md`, referenced in `idea.md`)
   are the origin of the current tier structure. A new item needs an equivalent basis: a real
   diligence gap a design partner has hit, a documented failure mode in this deal-size band, or an
   explicit analogy to an existing evidenced item. "This seems like it'd be useful to check" is not
   sufficient justification on its own — say so if that's all you have, and flag it as unvalidated
   rather than adding it silently.
2. **Classify the tier correctly, using the tier *definition*, not convenience.** Per `spec.md` §4:
   - Tier A: must be checkable with **zero** seller/broker cooperation, from public information only.
   - Tier B: requires a **document** the seller/broker hands over.
   - Tier C: requires **live login/access** to a seller-controlled system.
   If an item doesn't cleanly fit one of these, it's not ready to add — don't force it into the
   nearest tier.
3. **Decide method and severity.** State whether the item is `automated` or `manual` (`spec.md` §4),
   and whether it fits the Green/Yellow/Red model cleanly. If severity is genuinely deal-dependent
   (e.g., materiality varies a lot by deal size), note that explicitly rather than picking an arbitrary
   default.

## Template-specific content

When adding a business-type-specific item (`spec.md` §5), check it's genuinely differentiating for
that business type and not something that belongs in the base tier structure instead — e.g., "domain
ownership" is base/universal; "third-party delivery platform account ownership" is
restaurant-specific. Putting a universal item into one template's list means every other template
silently lacks it.

Respect the MVP sequencing in `roadmap.md` Phase 2: the Restaurant/online-ordering template is the
only fully-built one; Salon, Franchise, and general e-commerce are sequenced by *actual observed deal
flow* from design partners, not a fixed order chosen in advance. If asked to build out a template
that isn't next in that evidence-based sequence, flag the mismatch rather than building silently.

## Versioning discipline

Per `spec.md` §5, an in-progress Audit is pinned to the Template version it started on. **Never**
describe a checklist-content change as an in-place edit to a template version that might have
Audits already running against it — it's always a new version. This is also a `release-planning`
concern (`releases.md` §3) — if the change is significant enough to ship, coordinate with that skill
on the version bump and changelog entry.

## Output

Checklist/template content lives in `docs/spec.md` §4–5 today (no separate methodology directory
exists yet — if the checklist content grows large enough to warrant its own `docs/methodology/` tree,
that's a structural change to propose explicitly, not do unilaterally as a side effect of a content
edit). Keep the existing table format per tier/template. Cross-check `spec.md` §12 (open questions) —
resolving a methodology open question (e.g., whether trademark scanning gets automated) belongs there.
