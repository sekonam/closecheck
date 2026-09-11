---
name: consultant-ux-design
description: "Design or mock up any CloseCheck-facing surface — the audit-taking workflow, the generated PDF report, or the Phase 3 client portal. Triggers on: design, mockup, wireframe, UI, report layout, portal design, what should this screen look like, brand kit, whitelabel."
---

# consultant-ux-design

Domain design principles for CloseCheck, layered on top of the general-purpose `design` skill (which
handles the actual canvas/mockup mechanics). Load `design` for producing the artifact; use this skill
first to decide what's right to design, specifically for this product's two very different audiences.

## The two audiences are not symmetric

- **The consultant** is the paying, daily user of the audit-taking workflow. They are a professional
  doing repeatable, billable work under time pressure during a live deal. Optimize for speed and
  trustworthiness of data entry, not delight — this is a working tool, not a marketing surface.
- **The buyer** (and their advisory team) only ever sees the **output** — the Report (`spec.md` §6),
  and, from Phase 3 on, the Client Portal (`spec.md` §7). They never use the audit-taking workflow.
  Any design work on the Report or Portal is designing *for a stranger reading something under the
  consultant's name*, not for a CloseCheck user — the consultant's professional credibility is on the
  line in that surface, which makes it higher-stakes than it looks.

Before starting any design task, be explicit about which of these two you're designing for — the
bar and the constraints are different.

## Designing the audit-taking workflow (consultant-facing)

- Tier structure (A/B/C) should be visually load-bearing, not a subtle label — a consultant working a
  live deal needs to instantly see what's blocked on seller cooperation vs. runnable right now
  (`spec.md` §4 principle 3 in `spec.md` §2).
  Findings entry should default to fast (status + optional note) with evidence attachment as a
  secondary, not a blocking, step — matching `spec.md` §4's tier item structure.
- Never design a flow that implies the product performs a live credential-based check (`spec.md` §4's
  explicit decision against that for Tier C) — Tier C UI should read as "record what you observed,"
  not "log in here."

## Designing the Report (both audiences, but ships under the consultant's brand)

- **Whitelabel is not optional trim** — the consultant's logo/name/color is the primary brand
  treatment on every page; CloseCheck's own branding is minimal-to-absent on paid-plan exports
  (`spec.md` §6). Never design a report layout that visually competes with or overshadows the
  consultant's own brand kit.
- **Severity must be scannable in seconds** — the traffic-light executive summary (`spec.md` §6) is
  the thing a time-pressured buyer's advisory team actually reads first; the tiered detail section is
  for follow-up, not first-pass reading. Design the summary as if it's the only page some readers will
  look at.
- **Overrides must stay visible, never silently replace the computed rating** (`spec.md` §6) — if
  designing the override UI/display, both values need to be shown together, not toggled.
- **Liability/disclaimer language is legal content, not a design element to reflow casually** —
  placement and prominence can be designed, but the text itself is a `spec-writing`-skill /
  legal-review concern (`spec.md` §6), not something to paraphrase while designing a layout.
- For chart/color-coding work specifically (the traffic-light system, any severity visualization),
  load the `dataviz` skill for the color/accessibility methodology rather than picking colors ad hoc —
  a green/yellow/red system used in a financial deliverable needs to be colorblind-legible, not just
  conventionally colored.

## Designing the Client Portal (Phase 3+, buyer-facing)

Per `spec.md` §7: magic-link, no account, read-only, scoped to one Report version. Design constraints
that follow directly from that decision:
- No sign-up/login UI at all for the buyer — any design that introduces buyer authentication
  contradicts the explicit product decision; flag it rather than designing it.
- The portal is a read-only rendering of the same Finding data as the PDF (`spec.md` §7) — it should
  not become a second, divergent representation with its own content decisions. Layout can differ from
  the PDF; the underlying findings/severity model must not.
- This surface doesn't exist yet (`roadmap.md` Phase 3, conditional) — don't produce polished,
  final-feeling mockups for it outside of Phase 0/3 validation work; premature fidelity here risks
  the same "built before validated" risk `roadmap.md` Phase 3 explicitly warns about.

## Output

Use the `design` skill to actually produce canvas artboards/mockups once the above framing is settled.
For quick internal review (not a client-facing canvas), a lower-fidelity wireframe description or
rough layout is fine — match fidelity to the audience and validation stage per `roadmap.md`, not to a
default "make it look finished" instinct.
