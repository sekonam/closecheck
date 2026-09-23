# Design partner terms

**What this is.** A plain-language outline of what a CloseCheck design partner gets and gives, for
the conversation that happens after a discovery call goes well. It is not a contract and does not
try to read like one; it exists so both sides can see the same arrangement before anyone commits a
live deal to it.

**Written to be shown to the partner**, not kept internally. Anything here that would embarrass you
to have them read is a sign the arrangement is wrong, not that the document should be edited.

---

## What you get

- **Free use of CloseCheck for the design-partner period.** No subscription, no per-audit fee, no
  card. `spec.md` §9's pricing is explicitly a set of placeholders pending exactly the validation
  these conversations produce, so charging you for the privilege of testing the thing that decides
  the price would be backwards.
- **Direct access to the person who builds it.** Not a support queue. If something is wrong on a live
  engagement, you reach the founder and it gets fixed or you get told honestly that it will not be.
- **Real influence on the checklist.** The templates are the product's core — four business types,
  currently at version 6, each item carrying a verification procedure and a severity rubric with its
  threshold's source named where one exists. If you think an item is wrong, missing, or rated at the
  wrong severity, that is the most valuable thing you can tell us, and the versioning exists so a
  change can ship without rewriting the audit you are in the middle of.
- **Your branding on the output.** The report carries your firm's name, logo and colour. CloseCheck
  is infrastructure and does not appear on the deliverable you hand a client.
- **Grandfathered pricing if you continue.** Whatever the pricing turns out to be, a design partner
  should not end up paying more than someone who waited.

## What you give

- **One real deal.** This is the part that cannot be substituted. A demo on a made-up target teaches
  us almost nothing; the whole point of Phase 0 is to find out what breaks on a live engagement with
  a real seller, a real timeline and a real buyer reading the output.
- **Honest feedback, including the unflattering kind.** Especially "I stopped using it halfway
  through and went back to my spreadsheet," which is more useful than any feature request and is the
  thing people are most reluctant to say.
- **A conversation about pricing.** Which of the two models you would actually buy, and where the
  price stops being obviously worth it. `docs/research/pricing.md` §7 calls this the single number
  every other number depends on.
- **A decision about being named — asked, not assumed.** See below.

## Being quoted or named: an explicit question, with a default of no

You may or may not be willing to be named as a user, quoted, or referenced in a case study. These are
three different permissions and we ask about them separately rather than treating a yes to one as a
yes to all:

1. May we say your firm uses CloseCheck?
2. May we quote something you said, with your name on it?
3. May we describe the engagement in general terms — business type, deal band, what the audit found —
   without naming the target or your client?

**The default for all three is no**, and no is a complete answer that costs you nothing in the
arrangement. Two of these touch your client's confidentiality rather than only your preference, which
is your call to make and not ours to infer from enthusiasm on a call. If you say yes to any of them,
we will show you the exact wording before it is used anywhere.

---

## The awkward parts

A design-partner document that only lists benefits is not worth reading. These are the things you
should weigh before saying yes.

### Your client's seller's confidential documents would be in our system

Tier B of the methodology is built on seller-provided documents — executed POS and booking contracts,
merchant processor statements, platform agreements. Running a real audit means those land in
CloseCheck. They belong to a seller who is not party to this arrangement and did not choose us.

**Read `docs/security-posture.md` before deciding.** It is an honest inventory rather than a
marketing document, it is written to be sent to exactly this question, and it states its own gaps
explicitly — including the ones below. We would rather you read it and decline than take our word for
it.

The three things from it that most bear on this decision:

- **There is no production deployment yet.** You would be the occasion for the first one. That is a
  real risk and it is not one you should carry silently: if a deal's timeline cannot absorb "the tool
  had a problem and the founder is fixing it," this is the wrong deal to volunteer.
- **Document storage is still local disk, not object storage.** The posture document describes this
  as having been its largest gap and now a smaller, differently-shaped one — an S3-compatible backend
  is written but has never stored a real byte, and the sentence saying so stays in that document
  until someone has actually run a document through it. What that means for you, concretely, does not
  depend on how the gap is characterised: encryption at rest is whatever the underlying volume
  provides rather than anything we manage, and there is no redundancy — the volume is a single copy.
- **No third-party credentials are involved, by design.** Tier C live-access checks are performed by
  you, in your own browser, and recorded as your attestation. There is no code path that accepts,
  stores or proxies a seller's hosting, point-of-sale or booking login (`spec.md` §4). This is a
  standing product decision rather than an unbuilt feature, and it removes the largest category of
  risk by design rather than by control. If it makes the tool less useful to you, say so — whether
  that decision blocks anyone real is one of the things Phase 0 is meant to find out.

There is also no SOC 2, no ISO 27001, no third-party audit, and no independent penetration test. The
posture document says so plainly and explains why that is a deliberate gate rather than an oversight.
If any of that is a blocker for you or your client, we would rather hear which one specifically —
that is more useful than a guess about what firms want, and it is exactly the evidence the decision
to pursue certification is gated on.

### What happens to your data if you walk away

You can stop at any point, without notice and without a reason.

- **Documents follow the engagement lifecycle.** Moving a deal to a terminal stage — closed or dead —
  schedules its uploaded documents for deletion 90 days later by default. You can move that date if a
  post-close question needs them for longer.
- **If you leave, say so and we will delete your organisation's data.** Engagements, audits,
  findings, uploaded documents and reports. We will confirm when it is done. The 90-day default is a
  retention policy for ordinary use, not a waiting period we would hold you to on the way out.
- **Reports you have already sent are yours and stay yours.** A generated PDF is a document you
  handed your client; nothing we do afterwards reaches it. Client portal links are separate — those
  are live views you can revoke at any time, and revoking one takes effect immediately.
- **What a firm records about a vendor stays with the engagement it came from.** Deleting an
  engagement deletes those readings with it, so nothing outlives the retention of the contract it was
  read from.

### What we are not promising

- **That it will save you time on the first deal.** It probably will not. A first run of anything
  costs more than the process it replaces, and the value is in the second and third.
- **That it will not break.** It has not been used on a real deal. That is the entire point of the
  arrangement and the thing you are being asked to absorb.
- **That every piece of feedback becomes a feature.** We will tell you what we are not doing and why,
  rather than going quiet on it.
- **A date.** There is no launch date to hold us to, and inventing one for this document would make
  it less honest rather than more reassuring.

---

## In one paragraph

You give us one real engagement and honest feedback, including the feedback that we are not worth
using. You get the product free, the person who builds it on the other end of the line, real
influence over a checklist that is the actual product, and your own brand on the output. The
significant risk you are absorbing is that a live deal runs through software that has never carried
one, holding a seller's confidential documents, on a storage substrate that `docs/security-posture.md`
names as its own largest gap. If that is not a risk this particular deal can take, the right answer
is no, and it is better said now than mid-engagement.
