---
name: roadmap-planning
description: "Update CloseCheck's phased roadmap (docs/roadmap.md) — re-sequence phases, add/adjust deliverables or exit criteria, respond to a spec change or real-world evidence from design partners. Triggers on: roadmap, what's next, re-prioritize, phase plan, exit criteria, what should we build next, sequencing."
---

# roadmap-planning

Maintains `docs/roadmap.md`: the phase-by-phase build sequence, gated by exit criteria rather than
dates. This skill's job is sequencing and gating — not deciding *what the product is* (that's
`spec-writing`) and not deciding *how a version ships* (that's `release-planning`).

## Before editing

1. Read `docs/roadmap.md` in full — phases are deliberately interdependent (Phase 3's portal is
   explicitly conditional on Phase 1/2 evidence; Phase 4 is explicitly open-ended). A local edit to
   one phase can silently invalidate another phase's stated rationale.
2. Read `docs/spec.md` for whatever feature/decision is prompting the roadmap change — a roadmap
   deliverable must trace to a spec section. If it doesn't, that's a sign the spec needs updating
   first (hand off to `spec-writing`), not that the roadmap should describe a feature the spec doesn't
   define.
3. Check `docs/releases.md` §5 (launch gates) — exit criteria in the roadmap and gates in the release
   plan should stay consistent; a roadmap phase's exit criteria and a release channel's entry gate are
   often the same fact stated twice deliberately (e.g. Phase 1 exit criteria ≈ public-beta gate
   precondition). Don't let them drift apart silently.

## Principles specific to this roadmap

- **Exit criteria over dates.** Every phase in `docs/roadmap.md` is written as "a phase ends when X is
  true," not "a phase ends in N weeks." Preserve this — if you're tempted to add a hard date, ask
  whether it's actually a scheduling constraint (fine to note) or a substitute for a real completion
  signal (not fine — write the signal instead).
- **Conditional deliverables stay conditional.** Phase 3's portal and Phase 4's entire list are
  explicitly evidence-gated, not committed. When updating these phases with real evidence (a design
  partner asked for X), convert the conditional item into a committed one *and say what evidence
  triggered the change* — don't just firm it up silently.
- **Primary risk per phase is a real field, not boilerplate.** When adding or resequencing a phase,
  name the actual risk (as the existing phases do — e.g. Phase 1's risk is Tier B document variability,
  not a generic "might take longer than expected"). A risk statement that could apply to any software
  project is not doing its job.
- **Don't let scope creep back into "the guessed feature list."** `idea.md` and `spec.md` §5 are
  explicit that the original four-template guess was cut to one for MVP specifically to avoid building
  unvalidated scope. Resist re-expanding roadmap scope without the same kind of evidence citation the
  existing phases use.

## Output

Edit `docs/roadmap.md` directly, preserving the Goal / Deliverables / Exit criteria / Primary risk /
Estimate structure per phase. If a change affects `docs/spec.md` or `docs/releases.md` consistency,
either make the matching edit yourself (small, obviously-consistent changes) or flag it explicitly for
the other skill (larger changes, or ones needing product judgment beyond sequencing).
