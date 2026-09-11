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
touches from the list below. Report domain findings the same way (`ReportFindings`, when in a review
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
- Is the file encrypted at rest / access-controlled per Engagement, consistent with §8?
- Does retention behavior match the Engagement-lifecycle-tied policy in §8, or does the change
  introduce indefinite retention by omission (e.g., a new upload path that forgets to attach the
  retention/deletion job the others have)?
- Are uploaded documents or their extracted content ever logged, cached, or sent to a third party
  (e.g. an external processing API) without that being an explicit, reviewed decision? Flag it even if
  the immediate change seems harmless — this is exactly the kind of thing that's fine in isolation and
  bad in aggregate.

**Any change touching credentials, live logins, or anything that looks like Tier C automation**
(`spec.md` §4):
- The product decision is **no live credential storage or proxying in v1**. Any code that accepts,
  stores, or forwards a third-party credential (hosting/CMS/POS/booking login) is out of scope by
  spec, not just a security nitpick — flag it as a spec-conformance issue and point at `spec.md` §4,
  don't just review it as if it were an approved feature being implemented imperfectly.

**Any change touching Report generation or severity roll-up** (`spec.md` §6):
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

## Output

Findings from this checklist should name the specific `spec.md`/`releases.md` section the code
conflicts with, not just describe the code smell — that's what lets the person fixing it verify
against the actual requirement rather than re-deriving intent from the review comment alone.
