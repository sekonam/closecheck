# Working on CloseCheck

CloseCheck is tech due-diligence audit software sold to M&A/QoE consultants (not to acquisition
buyers directly). Start here, then read in this order before any substantial work:

1. [`docs/idea.md`](docs/idea.md) — where this came from and the evidence base. Every product
   decision should be traceable to this or explicitly flagged as a new assumption.
2. [`docs/spec.md`](docs/spec.md) — what the product is: domain model, the three-tier audit
   methodology, report generation, pricing, security posture, architecture.
3. [`docs/roadmap.md`](docs/roadmap.md) — phased build sequence, gated by exit criteria not dates.
4. [`docs/releases.md`](docs/releases.md) — versioning, release channels, GTM timing, launch gates.
5. [`docs/research/`](docs/research/) — dedicated evidence behind spec decisions (competitor
   landscape, market/population sizing, pricing model). Check here before trusting a `spec.md` number
   that looks like it should have evidence behind it — `spec.md` §9's pricing model was already
   revised once against this research; treat future contradictions between a spec placeholder and
   fresh research the same way (update the spec, keep the superseded reasoning visible, per
   `spec-writing`), rather than picking whichever number is more convenient.

These documents are living, cross-referenced, and deliberately kept consistent with each other. A
change to one very often implies a change to another — see "Cross-document consistency" below.

## The skill roster

Each project activity has a dedicated skill under `.claude/skills/`. Load the relevant one(s) before
doing that kind of work rather than improvising the domain context from scratch each time:

| Skill | Owns | Use it for |
|---|---|---|
| `spec-writing` | `docs/spec.md` | New features, data-model changes, resolving an open question, anything defining *what the product is* |
| `roadmap-planning` | `docs/roadmap.md` | Re-sequencing phases, adjusting deliverables/exit criteria, responding to design-partner evidence |
| `release-planning` | `docs/releases.md` | Versioning, release channels, changelog, GTM timing, launch gates |
| `audit-methodology` | `docs/spec.md` §4–5 (checklist/template content) | Adding/changing a checklist item, tier classification, or business-type template — the product's core IP |
| `consultant-ux-design` | Design decisions for the audit workflow, Report, and Client Portal | Any mockup/wireframe/UI work — layers domain constraints on top of the general `design` skill |
| `domain-code-review` | The CloseCheck-specific risk checklist (tenant isolation, document/credential handling, severity roll-up, template versioning) | Reviewing any code change — runs alongside the general `code-review` skill, not instead of it |

General-purpose skills (`code-review`, `design`, `security-review`, `simplify`, etc.) remain available
and should still be used for their mechanical job — the project skills above add CloseCheck-specific
judgment on top, they don't replace the underlying tooling.

## Working in parallel: how to combine skills

Most real units of work on this project touch more than one of these concerns at once. Default to
identifying the independent streams and running them in parallel via the `Agent` tool (forks for
work that shares this conversation's context and whose output doesn't need to stay in context; fresh
subagents when the work is genuinely independent and self-contained) rather than doing them serially
by default.

**How to decide what's parallel-safe:** two streams can run in parallel only if neither one's output
changes what the other should do. Sequence anything with a real dependency; parallelize the rest.

### Pattern: new feature or product decision

1. **Sequential first step:** `spec-writing` resolves what the feature actually is and updates
   `docs/spec.md`. Nothing downstream should start until this lands — every other skill reads the spec
   as ground truth.
2. **Then, in parallel:**
   - `roadmap-planning` places/sequences the deliverable and updates exit criteria.
   - `release-planning` updates versioning/GTM implications if the feature affects a launch gate or
     channel.
   - `audit-methodology` drafts checklist/template content, if the feature touches tier structure or
     template scope.
   - `consultant-ux-design` drafts the relevant mockups, if the feature has a user-facing surface.
   - Implementation (code) can start once the spec section it depends on is stable, in parallel with
     the above if the design/methodology work isn't itself a hard input to the code (e.g., backend
     data-model work can often proceed while design mockups are still in progress; UI implementation
     usually can't).
3. **Sequential last step:** `domain-code-review` (plus general `code-review`) runs against the actual
   diff once implementation is done — this cannot be parallelized ahead of the code existing.

### Pattern: methodology/content-only change (new checklist item, new template)

`audit-methodology` does the content work; `spec-writing` and `roadmap-planning` can run in parallel
right after to fold the change into `spec.md` and check roadmap sequencing, since neither depends on
the other's output — they both just depend on `audit-methodology`'s decision.

### Pattern: pre-release check

Run in parallel once a phase's deliverables are code-complete: `domain-code-review` (+ `code-review`)
against the accumulated diff, and `release-planning` checking the phase's launch gates in
`docs/releases.md` §5 against actual current state. Both are read/verify operations against the same
finished work, not dependent on each other.

### Don't parallelize these

- `spec-writing` before anything else in the "new feature" pattern — every other skill treats the
  spec as ground truth, so starting them concurrently with an unstable spec produces work that has to
  be redone.
- `domain-code-review` before the code exists.
- Any two skills editing the *same* document section — e.g., don't run `roadmap-planning` and
  `release-planning` in parallel if both would touch the same phase's exit-criteria wording; pick
  one owner for that specific edit (per the ownership table above) and let the other consume the
  result.

## Cross-document consistency

Because the four core docs cross-reference each other, treat these as connected facts, not four
independent files:

- A `docs/spec.md` §12 open question resolved ⇒ check whether `docs/roadmap.md`'s phase gating or
  `docs/releases.md`'s launch gates referenced that open question as a precondition.
- A `docs/roadmap.md` phase's exit criteria ⇒ often restated as a `docs/releases.md` §5 launch gate
  precondition. Keep both in sync rather than letting one drift.
- A `docs/spec.md` §4/§5 tier or checklist change ⇒ almost always a `docs/releases.md` §3 "new
  template version" release event, and may affect `domain-code-review`'s versioning checklist.
- Any `docs/spec.md` §8 (security/trust) change ⇒ flag for `domain-code-review`'s checklist even if no
  code exists yet — so the checklist is current by the time implementation catches up.

## Guardrails (apply regardless of which skill is active)

- **Consultant is the customer, buyer is the end-reader.** Every decision — product, design, GTM —
  should be checked against this framing (`docs/spec.md` §1–2). If work starts optimizing for the
  buyer's experience as primary, that's a signal to stop and re-check against the spec.
- **No Tier C credential handling in v1.** This is a standing product decision (`docs/spec.md` §4),
  not an open question — treat any proposal to store/proxy live credentials as a decision that needs
  explicit spec-level reconsideration (`spec-writing` + a real design-partner-evidenced trigger per
  `docs/releases.md` §5), not something to implement incrementally.
- **Multi-tenant isolation is the one thing that cannot ship broken.** `docs/spec.md` §8's framing —
  this product's core risk is reputational, not competitive — should weight review priority
  accordingly. When in doubt about how deep to review something, go deeper on tenant-isolation-
  adjacent code than on anything else.
- **Don't re-guess validated-away scope.** The original four-template list and the direct-to-buyer
  distribution model were both explicitly cut in `docs/idea.md` and `docs/spec.md` for evidenced
  reasons. Don't quietly reintroduce either without new evidence, even if it seems like an obviously
  good idea in isolation.

## Implementation status

Application code lives at the repo root (Next.js/TypeScript, see `package.json`). See
`docs/roadmap.md` Phase 1 for what's in scope; check git history / open TODOs for current progress
rather than assuming this file is kept in sync with implementation state line-by-line.
