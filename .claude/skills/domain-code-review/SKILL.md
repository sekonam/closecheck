---
name: domain-code-review
description: "Review CloseCheck code changes against this project's specific risk areas — multi-tenant data isolation, document/credential handling, severity roll-up correctness, template versioning — on top of the general code-review pass. Triggers on: review this, code review, before I merge, is this safe, tenant isolation, does this leak data."
---

# domain-code-review

Runs *before or alongside* the general-purpose `code-review` skill/command, not instead of it. That
skill catches correctness/simplification/efficiency bugs generically; this skill is the CloseCheck-
specific checklist for the failure modes that matter most for this product, per `spec.md` §8's framing
that the core risk here is reputational (one leaked seller's data), not just availability.

Use both: run `/code-review` for general correctness, and walk this checklist for anything the diff
touches from the list below.

**If a checklist item can be expressed as a check, the checklist version is a placeholder for it.**
Written correctly and specifically, in this file, the `in`-operator rule below still bound only the
code somebody thought to point it at: nine violations existed across two sessions' work, two were
found by accident, and seven would not have been found by anyone. One ESLint selector
(`eslint.config.mjs`) reduced that to a rule that cannot be forgotten. So when reviewing, notice
which line you are applying by hand and ask whether it could be a lint rule, a type, or an assertion
in the suite — and when it can, converting it is worth more than any single finding it would have
caught. A selector with false positives is worse than none, because the first one earns a disable
comment and the rule stops being read; the `in` rule works because requiring a non-literal left
operand has none in this codebase. Report domain findings the same way (`ReportFindings`, when in a review
flow) — don't fold them into general findings if a review flow is already using structured output;
otherwise report directly to the user as plain findings with file/line and concrete failure scenario.

## Checklist — apply the relevant sections only, based on what the diff touches

**Any change touching a database query, especially Engagement/Audit/Finding/Report reads or writes**
(`spec.md` §3, §8):
- Does every query scope by `consultant_org_id` (or equivalent tenant key)? A missing scope on a
  single query is a cross-tenant data leak, not a minor bug — treat any suspected instance as
  high-severity regardless of how unlikely the code path looks.
- If row-level security is in place (`spec.md` §10), does the change rely on it correctly, or does it
  bypass it via a raw/admin connection without an explicit, logged reason?
- Any new admin/support/impersonation code path: is access scoped and logged per-org (`spec.md` §8),
  never a blanket cross-org view?

**Any change touching document upload/storage (Tier B contracts/statements)** (`spec.md` §4, §8):
- **Evidence outlives the person who uploaded it.** `Evidence.uploadedById` is `ON DELETE SET
  NULL` deliberately: `removeMember` hard-deletes the User row, so a cascade would take every
  Tier B contract that teammate attached with it — silently, at exactly the moment a firm
  reorganises. Any new deletion path involving User has to preserve that; the document belongs to
  the engagement, not to the person.
- Is the file encrypted at rest / access-controlled per Engagement, consistent with §8?
- Does retention behavior match the Engagement-lifecycle-tied policy in §8, or does the change
  introduce indefinite retention by omission (e.g., a new upload path that forgets to attach the
  retention/deletion job the others have)?
- Are uploaded documents or their extracted content ever logged, cached, or sent to a third party
  (e.g. an external processing API) without that being an explicit, reviewed decision? Flag it even if
  the immediate change seems harmless — this is exactly the kind of thing that's fine in isolation and
  bad in aggregate.

**Any change touching Vendor Term Profiles** (`spec.md` §3, §8):
- **Nothing may write a recalled value into a Finding.** The panel is reference-only by product
  decision, not by omission: a prefilled value is indistinguishable, in the audit form and then in
  the generated report, from one the consultant read out of *this* deal's contract — so a "use
  this" control would let the previous deal's termination penalty ship to this buyer as a finding
  about their target, with a name and a severity attached. A browser test asserts the panel offers
  no control that writes; a change that adds one is a spec-level decision, not a UI improvement.
- **This is a firm's reading of its clients' confidential documents**, not shared product content
  like a Template — tenant-scoped with the usual two layers, and it cascades from the Engagement so
  a reading cannot outlive the retention of the contract it came from.
- **`vendorKeyFor`'s conservative matching is load-bearing for isolation within an org.** It strips
  corporate suffixes and category words so "Toast, Inc." and "toast pos" match — and a name made
  entirely of those words ("Payments Inc") keeps its unstripped form, because otherwise every such
  vendor shares one profile and a consultant is shown another company's contract terms. Widening
  the normalisation merges vendors; check what a change makes collide.

**Any path that reads two related rows and takes different facts from each**:
- **Does anything check they agree?** `resolvePortalAccess` read the link by token and the report by
  `link.reportId`, returned the org from the LINK and the document from the REPORT, and compared
  them nowhere — so a row where those disagreed served one firm's report resolved against another
  firm's identity, and the portal would have wrapped a seller's report in a different consultancy's
  branding for a buyer. The application layer could not create such a row; it was the only thing
  preventing one.
- "Unreachable through the application" is the argument to distrust most on the anonymous surfaces.
  `spec.md` §8 asks for two independent layers so a bug in *either alone* cannot cross tenants, and
  a check that exists only in the writing path leaves the reading path holding nothing. The same
  reasoning applies to the storage containment guard and for the same reason: the consumer does
  something irreversible — deletes a document, or hands one to an outsider.
- Refuse, do not reconcile. Two rows disagreeing about who owns something is a corrupt row, and
  picking whichever field looks more authoritative serves the document anyway. Return nothing.
- Put the check before any write the request causes. A refused request must not leave a view in an
  access trail a consultant reads.

**Any change touching credentials, live logins, or anything that looks like Tier C automation**
(`spec.md` §4):
- The product decision is **no live credential storage or proxying in v1**. Any code that accepts,
  stores, or forwards a third-party credential (hosting/CMS/POS/booking login) is out of scope by
  spec, not just a security nitpick — flag it as a spec-conformance issue and point at `spec.md` §4,
  don't just review it as if it were an approved feature being implemented imperfectly.

**Any change touching Report generation or severity roll-up** (`spec.md` §6):
- **The appendix lists documents; it does not contain them.** Embedding a seller's executed
  contracts or merchant statements into the PDF would put confidential material inside a file the
  buyer can forward anywhere — a trust decision (`spec.md` §6, §8) rather than a rendering choice,
  and one that looks like a small improvement from inside the renderer. Treat any change that
  inlines document bytes into a report as needing a spec-level decision, not review.
- Does the roll-up logic still correctly implement "any single Red item makes its tier Red regardless
  of surrounding Greens," and "overall rating = worst tier rating"? This is easy to accidentally
  average instead of worst-case — check the actual aggregation, don't trust a variable name like
  `overallRating` to mean what it says.
- If a consultant override to the computed rating exists in the change, is the computed value still
  shown alongside it (never replaced/hidden)? This is a spec-mandated transparency requirement, not a
  UI preference.
- Is disclaimer/liability text ever generated, templated, or altered by this code path in a way that
  wasn't reviewed as a legal-content change (`spec.md` §6)? Flag rather than approve silently.

**Any change touching Template versioning** (`spec.md` §5, `releases.md` §3):
- Does an in-progress Audit stay pinned to the Template version it started on, or could this change
  cause an in-flight Audit to silently pick up a newer template version's items? This has shipped-
  customer-impact, not just a data-modeling nicety.
- Is a checklist-content change shipping as a new version, or as an in-place mutation of a version
  that may already have Audits running against it (`releases.md` §3's explicit rule)?
- **A change to an item's `fieldSchema` is a content change, not a config change.** `Finding.
  structuredData` is stored against the field keys the item declared at the time, so editing a
  published version's schema retroactively changes what every recorded finding *means* — a renamed
  key silently empties a field a consultant filled in, and a changed enum option silently
  invalidates a value they chose. It must ship as a new Template version like any other checklist
  edit. Watch specifically for an edit to the frozen v1/v2 content arrays in
  `src/lib/templates/content.ts`, which look like ordinary data and are not.
- **A template revision layers, it never edits.** v3 and v4 are separate modules applied over the
  frozen content rather than changes to it, and each carries a coverage assertion that fails the
  build when an item is neither revised nor explicitly recorded as unchanged-with-a-reason. A diff
  that edits an existing revision in place, or that adds an item without a decision, defeats both.
- **Does a client-facing string stay client-facing?** `TemplateItem.description` renders verbatim
  into the whitelabeled PDF a consultant hands to a buyer; `guidance` and `severityGuidance` are
  internal and must never reach the report. A methodology note written into the wrong field puts
  this product's internal cross-references into someone else's client deliverable — which has
  already happened once. `assertClientFacingDescriptions` catches the obvious shapes; a reviewer
  should catch the rest.

**Any change to a shared cache, rate limiter, or anything with an eviction policy**:
- Do two things with different lifetimes share one eviction policy? The policy always picks a
  loser. This has already produced a defect and then its own inverse: insertion-order eviction was
  flushing long-lived sign-in buckets, and the fix made those buckets the most privileged entries
  in a shared map — so a flood of them would evict every paying tenant's API budget instead. A
  failed sign-in mints a bucket keyed on any email string, so that flood is free. Partition the
  map; do not tune the policy.
- **A fix that exempts or reprioritises one participant in a shared mechanism has, by
  construction, moved every other participant** — and the finding that prompted it only ever names
  one of them. This has now produced two defects in a day, both invisible to reading and obvious
  the moment the scenario was executed: correcting insertion-order eviction made the long-lived
  buckets the privileged ones, and exempting the unknown-address case from a sign-in budget
  collapsed a two-key budget to per-email, reinstating the victim-lockout weapon the second key
  existed to prevent. Before accepting such a fix, enumerate who else the change moves.
- Does a limiter hard-reject before doing the work it is protecting? Then its degraded state is an
  outage, not a restriction. The same config value that safely over-restricts an API limiter made
  sign-in return null for every user on the deployment.

**Any change touching roles, or any message shown when work is blocked** (`spec.md` §3):
- Firm-scoped actions call `requireOwner`; engagement-scoped ones do not. An action that changes
  what the FIRM is — billing, seats, API keys, webhooks, branding, the disclaimer acknowledgement —
  and does not call it is making a claim that it is engagement-scoped. The line is scope, not
  seniority: a seat that cannot take an audit or issue a report cannot do what the seat is sold for.
- **Does a blocked-work message instruct a reader who cannot act?** This has appeared twice: a
  credit-limit message telling a teammate to choose a plan, and a disclaimer gate telling them to
  accept it — both owner-only. To a member each reads as something they got wrong, with an
  instruction they cannot follow. Name who can resolve it instead of instructing the reader.
- Portal-link attribution (`createdById`) is expected to be present and nullable. Any seat may
  share a report, so the firm must be able to say which seat did — "any seat may do it" and
  "nobody can tell who did" must not both be true.

**Any change that reads the client's network address** (rate limiting, access logging, abuse
controls):
- Never use `in` to test membership of a generated enum or plain object. Prisma's generated enums
  are plain objects with `Object.prototype` on the chain, so `"constructor" in BillingPlan` is
  `true` — verified empirically, not theorised. Use `Object.values(...).includes(...)`, a `Set`, or
  a zod schema.
- Is it parsed with `clientAddressFrom` (`src/lib/api/rateLimit.ts`), or read straight off
  `X-Forwarded-For`? The leftmost hop of that header is supplied by the client under every
  appending proxy, so anything keyed on it is keyed on a value an attacker chooses. This has
  already produced one real defect: a per-(email, address) sign-in budget intended to make lockout
  impossible was defeated by presenting the victim's address and burning their budget.

**Any change that makes an outbound network request from tenant-supplied input** (`spec.md` §8):
- Does it go through `src/lib/net/safeFetch.ts`? Not `hostSafety.ts` — checking the host once and
  then calling `fetch` is exactly the shape that shipped broken: the guard ran on the domain, and
  both Tier A fetchers then followed redirects unchecked, so a public domain answering
  `302 Location: http://169.254.169.254/...` was fetched anyway. The attacker controls hop two.
  `safeFetch` checks every hop before fetching it and never follows automatically; `hostSafety` is
  the predicate underneath it, correct but insufficient on its own. Two paths already take a
  user-controlled host and connect to it — the Tier A check runner (`Engagement.primaryDomain`)
  and webhook delivery — and a third would be a request-forgery primitive by default.
- Refusing redirects outright (`redirect: "error"`, as webhook delivery does) is simpler and
  better than validating them, wherever the caller doesn't genuinely need to follow one.
- Is the *response* reflected back to the user? Tier A persists redirect chains, response headers
  and certificate subjects into a Finding, which turns a request-forgery bug into one with a read
  channel. A new check that echoes response content deserves more scrutiny than one that doesn't.
- Do not accept a hand-rolled private-range regex in place of the shared guard. The addresses that
  matter are reachable in forms a regex misses — decimal and hex IPv4 (`2852039166`,
  `0xA9FEA9FE`), IPv4-mapped and NAT64 IPv6 (`::ffff:169.254.169.254`, `64:ff9b::a9fe:a9fe`) — and
  a guard that disagrees with the resolver about which address a string names is worse than none.

**Any test added in response to a defect**:
- **Has it been shown to FAIL against the bug?** Not reasoned about — run. Reintroduce the defect,
  confirm the new case goes red, restore. A test written against a fix is worth nothing until it
  has done that, and this project has now produced two that passed against the very code they were
  written to catch: a cache-eviction flood test that completed before the prune threshold it was
  probing, and a browser assertion gated on an environment variable that was unset everywhere it
  mattered. Both were written deliberately, by someone who had just been thinking about this exact
  failure.
- When the defect is reintroduced, do the OTHER cases in the file still pass? If they all fail, the
  test is measuring that the code runs at all rather than the property it claims.
- A suite that skips when its dependency is absent reports success having asserted nothing. Fail
  loudly instead: an unavailable browser, server or database is a result, not a non-event.
- **Did a shared fixture's arbitrary default just become a silent assertion?** When production code
  starts reading a field that fixtures have been filling with a throwaway value, every existing
  case begins asserting something about it — and nothing warns you, because those tests did not
  change. `rollup.test.ts`'s helper defaulted to `status: "IN_PROGRESS"`, which was filler until a
  coverage count started reading the status; from then on every case silently claimed "this rating
  is unconfirmed". Harder to spot than a vacuous test, because a vacuous test asserts nothing while
  this one asserts something real and wrong, and still looks like it is doing work. When a field
  gains meaning, re-read what the fixtures have been saying about it.

- **Does the stand-in still do what the real path does?** A fixture or helper that diverges from
  production *toward safety* is invisible: everything passes, and the divergence surfaces only when
  somebody compares the stand-in to the real path — which nobody does, because the stand-in exists
  so they need not. `fieldSchema.test.ts`'s helper read submitted fields from a plain object while
  `updateFinding` materialises them into a `Map`, so a field named `constructor` resolved through
  `Object.prototype` in the test and not in the app: the test was simulating something the product
  does not do. Sibling to the fixture-default rule above and the opposite direction — that one is an
  arbitrary default becoming a silent assertion, this is a stand-in drifting from what it stands
  for. Both end with the test lying.

**Anything a consultant reads next to something the product computed**:
- **Do the rubric and the runner state the same rule?** For an item rated automatically, the
  template's `severityGuidance` and the Tier A runner are two statements of one rule, kept in two
  places, in two languages. When they disagree the consultant follows the rubric and overrides a
  correct rating — the product correcting itself towards the wrong answer. Template v4 told
  consultants to rate certificates on proportion of lifetime while the runner applied the shorter
  of a proportion and a day cap, and put Yellow at 132 days on a real certificate the runner rated
  Green (`spec.md` §5, template v5).
- A rubric may legitimately describe a judgement the runner cannot make — but it has to SAY so.
  v4's domain-expiry threshold was written relative to an expected close date that does not exist
  in the data model, so the runner measured from the audit date instead and said nothing. Stating
  the gap is a valid answer; silence is not.
- Check this whenever either side changes. A threshold edited in code and not in the template, or
  in the template and not in code, is the same defect from either direction.

## Output

Findings from this checklist should name the specific `spec.md`/`releases.md` section the code
conflicts with, not just describe the code smell — that's what lets the person fixing it verify
against the actual requirement rather than re-deriving intent from the review comment alone.
