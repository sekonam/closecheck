# Outreach templates — first-90-days motion

Drafted 2026-09-22 against `docs/research/promotion.md` (channel ranking #1) and
`docs/research/distribution.md`'s free-sample-audit hook. Every variant leads with the same offer:
**a free Tier A audit run on a real live listing** (theirs if they have one, ours if not).

## Personalization slots

Slots match the columns in [`prospects.md`](prospects.md):

| Slot | Source | Example |
|---|---|---|
| `{{first_name}}` | prospects.md contact | `Sarah` |
| `{{firm}}` | prospects.md firm name | `Bedrock QoE` |
| `{{hook}}` | prospects.md hook column — one specific, verifiable observation about *their* practice (a listing they represented, a blog post, a podcast appearance, their stated sector focus) | `your QoE teardown of the HVAC roll-up on Acquisitions Anonymous` |
| `{{listing_type}}` | their sector focus, mapped to a CloseCheck template | `restaurant` / `salon` / `franchise resale` / `e-commerce` |

Rule: no email goes out with an empty or generic `{{hook}}`. A message that could have been sent
to anyone will be read by no one. Honest-traction rule: we have **zero customers** and say so when
asked — the ask is a design-partner conversation, not a purchase.

---

## A. Population 1 — existing tech-DD providers (tool-switch pitch)

They already sell technology diligence; the pitch is "your current deliverable process, faster and
more repeatable." Do not imply their current work is bad — it's their craft; we productize the
repetitive part.

**Subject A1:** `your tech DD checklist, as software`
**Subject A2:** `ran the automated half of a tech audit on a live {{listing_type}} listing`

> {{first_name}} — I saw {{hook}}, so you know exactly how much of a small-deal tech audit is
> repetitive lookup work: domain ownership, DNS, SSL, email auth, platform fingerprinting.
>
> I built CloseCheck to do that half automatically and put the judgment half — contracts, seller
> attestations — into a structured checklist that outputs a whitelabeled PDF under your brand.
> It's built for sub-$2M main-street deals ({{listing_type}} and similar), not enterprise DD.
>
> Offer, no strings: send me any live listing you're looking at and I'll run the automated tier on
> it today — you get the report, keep it, use it. If the output isn't at the bar you'd put your
> name on, tell me why and that's payment enough.
>
> I'm pre-revenue and picking 2–3 design partners who get it free in exchange for candid feedback.
> Worth 20 minutes?
>
> — Sergii, founder, CloseCheck

## B. Population 2 — QoE generalists / IT consultants (new-service-line pitch)

They don't offer tech diligence today. The pitch is a **new billable line item**, not a tool swap —
more consultative, lead with the client's unasked question, not the product.

**Subject B1:** `the diligence question your QoE clients aren't asking yet`
**Subject B2:** `adding a tech-diligence line to a QoE engagement (without hiring anyone)`

> {{first_name}} — {{hook}} is what prompted me to write. A pattern I keep hitting in sub-$2M
> deals: the QoE covers earnings quality, but nobody checks whether the seller actually owns the
> domain, the Google Business Profile, or the booking platform the revenue runs through. Buyers
> find out at handover.
>
> CloseCheck packages that check as a service your firm could sell inside an existing engagement:
> an automated public-records tier (no seller cooperation needed), a document tier for contracts,
> and a findings report that goes out as a whitelabeled PDF under {{firm}}'s brand. No technical
> staff required — the methodology is the product.
>
> To make this concrete rather than a pitch: pick any live business-for-sale listing and I'll run
> the automated tier on it free, today. If the report looks like something a client would pay a
> line item for, let's talk about you being one of 2–3 design partners (free, in exchange for
> feedback on a real deal).
>
> — Sergii, founder, CloseCheck

---

## C. LinkedIn connection notes (≤300 chars)

**C1 (pop 1):** `{{first_name}} — saw {{hook}}. I build software that automates the lookup half of small-deal tech DD (domain/DNS/SSL/email auth → whitelabel PDF). Happy to run it free on any live listing you're eyeing — takes me a day, you keep the report.`

**C2 (pop 2):** `{{first_name}} — {{hook}} caught my eye. Most sub-$2M QoEs never check who owns the domain/GBP/booking stack the revenue runs through. I built a tool that adds that as a billable line. Can I run a free sample on a live listing for you?`

Keep both under 300 characters after slot substitution — check before sending.

---

## D. Follow-up sequence

Spacing: **follow-up 1 at +4 business days, follow-up 2 at +10 business days**, then stop — three
touches total per `distribution.md`'s outreach motion; the list is small, don't burn it.
(`promotion.md` doesn't fix exact spacing; this is our convention — log actuals in prospects.md.)

**Follow-up 1 — add proof, not pressure.**
Subject: `re: {{original subject}}` (thread reply)

> {{first_name}} — attaching the kind of output I meant: a sample Tier A audit on a real
> {{listing_type}} listing [link]. Two findings in there most buyers would miss. If a report at
> this bar under your own brand would earn a line item, the design-partner offer stands.

**Follow-up 2 — the graceful close.**
Subject: thread reply

> Last note from me. If tech diligence isn't a fit for {{firm}}'s engagements right now, no reply
> needed — I'll assume that and stop here. If the timing's just wrong, one line ("ping me in Q1")
> and I will. Either way: {{hook}} — keep doing that, it's the good stuff.

---

## Week-1 A/B protocol (from `distribution.md`, restated here so the templates carry it)

20 LinkedIn notes (C variants) vs 20 cold emails (A/B variants) to matched prospects, same
population mix on each side. Alternate subject variants evenly. Record in prospects.md: channel,
variant, sent date, reply (y/n), reply quality (meeting / info / no). Winner takes weeks 3–8 at
15–20 contacts/week. IBBA directory trigger: reply rate <5% after ~60 contacts.
