---
name: release-planning
description: "Update CloseCheck's release plan (docs/releases.md) — versioning, release channels, changelog entries, launch gates, or go-to-market timing tied to a roadmap phase. Triggers on: release plan, launch, changelog, versioning, go-to-market, GTM, ship it, when do we announce, launch gate."
---

# release-planning

Maintains `docs/releases.md`: versioning scheme, release channels, cadence, GTM timing, and launch
gates. This skill answers "when and how does this actually reach users," never "what is the feature"
(`spec-writing`) or "in what order do we build things" (`roadmap-planning`).

## Before editing

1. Read `docs/releases.md` in full, especially §5 (launch gates) — gates are written as checklists
   with real, falsifiable conditions (a specific design partner's report was used unmodified; a
   specific evidence citation for a distribution decision), not vague readiness statements. Preserve
   that specificity in any edit.
2. Read the relevant `docs/roadmap.md` phase — release channels and GTM timing are keyed to roadmap
   phases by design (§2 and §4). A release-plan change that isn't anchored to a roadmap phase is
   probably premature; check whether the roadmap needs updating first.
3. Check `docs/spec.md` §9 (pricing) and §8 (security) before writing anything about GTM or launch
   gates that touches pricing numbers or data handling — don't restate pricing figures or security
   posture from memory; they're marked as placeholders/decisions in the spec and could have changed.

## Principles specific to this release plan

- **Template changes are a release-process rule, not just a data-model rule** (§3): any edit involving
  how template versioning ships must preserve "new version, never in-place edit to a version already
  in use." This protects in-flight paying customers' recorded findings — don't relax it for
  convenience.
- **GTM channel effort should match the evidence-gated distribution decision**, not spread thin across
  every channel "just in case." §4 explicitly concentrates GTM spend on whichever channel won on
  evidence in Phase 3 — if asked to add GTM activity in an earlier phase or on an undecided channel,
  push back or flag it as speculative rather than adding it as if it were settled.
- **Launch gates are checklists that block, not aspirations.** When adding a new gate (e.g., before a
  new channel opens), write it as a checkable, evidence-based item consistent with the existing gates
  in §5 — "pricing tiers finalized from Phase 0/1 evidence," not "pricing feels right."
- **A leak/isolation incident is sev-1 regardless of blast radius** (§6) — this framing follows
  directly from `spec.md` §8's reputational-risk argument. Don't let a future edit soften this into a
  severity-scored-by-impact model; the whole point is that even a small incident is reputationally
  large for every consultant on the platform.

## Output

Edit `docs/releases.md` directly, preserving its six-section structure (versioning / channels /
cadence / GTM / launch gates / incident posture). Cross-reference `roadmap.md` phases and `spec.md`
sections by name, as the existing content does, so a reader can trace a release decision back to the
product/roadmap fact driving it.
