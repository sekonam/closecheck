# Citable audit thresholds & procedures — research pack

**Retrieved 2026-09-22.** Evidence base for checklist-item guidance text in [`spec.md`](../spec.md) §4–5.
Five topics, researched in parallel against primary sources: payment-processor standing (Tier B),
trademark conflict scan (Tier A), data-export/portability test (Tier C), email-authentication posture
(Tier A), TLS/domain posture (Tier A).

**Standing rule for this document:** an uncited threshold is worse than no threshold. Where no
authoritative source exists, that is recorded as a finding — see §6, which is the most important
section in this file for anyone writing checklist copy.

**Confidence convention:** `High` = primary publisher document, or two independent corroborating
sources. `Medium` = one reputable secondary source. `Low` = single blog / undated / unclear
provenance. `Could not verify` = looked for it, did not find it, do not invent it.

---

## 0. Cross-cutting: ten things that changed and are wrong in most circulating copy

Every one of these would have shipped as a defensible-sounding but stale number if we had written
checklist copy from memory.

| # | Commonly repeated | Actually true as of 2026-09-22 | Conf. |
|---|---|---|---|
| 1 | Visa VDMP: 0.9% / 100 disputes | VDMP and VFMP **retired 1 Apr 2025**, replaced by VAMP. Merchant Excessive = **150 bps** (US/CA/EU/AP) from 1 Apr 2026, min **1,500** monthly events | High |
| 2 | Max TLS cert life is 398 days | **200 days** since 2026-03-15. 100 days at 2027-03-15, 47 days at 2029-03-15 | High |
| 3 | Renew certs at 30 days remaining | Obsolete as a fixed rule. Let's Encrypt and Certbot v4.0.0 (Apr 2025) both moved to **1/3 of lifetime**; ARI (RFC 9773) is the current signal | High |
| 4 | DMARC is RFC 7489, Informational | **RFC 9989, May 2026, Standards Track**, obsoletes 7489. `pct=` was **removed** | High |
| 5 | The 60-day ICANN transfer lock after registrant change | Still in force **today**. The revision removing it was **adopted 7 Jun 2026** (Res. 2026.06.07.04) but has **no effective date** | High |
| 6 | TESS is the USPTO search tool | Retired **30 Nov 2023**; replaced by Trademark Search at `tmsearch.uspto.gov` | High |
| 7 | Nice Classification 12th edition | **13th edition, version 2026 (NCL 13-2026)**, in force 1 Jan 2026 | High |
| 8 | Yahoo defines bulk sender as 5,000/day | Yahoo's own page states **no numeric threshold**. 5,000/day is Google's and Microsoft's | High |
| 9 | M3AAWG Sender BCP prescribes `~all` / p=reject | **v4.0 (Aug 2026) contains no such checklist.** Cite M3AAWG only for 6-month DKIM rotation | High |
| 10 | Square transaction CSV is capped at 1 year per export | **Not in any Square help article.** Could not verify — do not ship it | High (as a negative) |

---

## 1. Payment processor / chargeback standing

Maps to `spec.md` §4 Tier B, "Payment processor account standing (chargebacks, holds, reserve)".

### 1.1 Visa — VAMP

Primary source: [Visa Acquirer Monitoring Program Fact Sheet](https://corporate.visa.com/content/dam/VCOM/corporate/visa-perspectives/security-and-trust/documents/visa-acquirer-monitoring-program-fact-sheet-2025.pdf)
(Visa Inc.). Note Visa's Core Rules (18 Apr 2026 ed., §10.4.3.1) deliberately do **not** publish the
numbers — they defer to the non-public VAMP Guide. The fact sheet is the ceiling of public primary
evidence.

Formula, verbatim: `VAMP Ratio = Count of [Fraud (TC40) + Disputes (TC15)] ÷ Count of Settled Transactions (TC05)`

| Threshold | Value | Conf. |
|---|---|---|
| VAMP replaced VDMP + VFMP | 1 Apr 2025 | High |
| Advisory period ended / enforcement began | 1 Oct 2025 | High |
| Acquirer **Above Standard** | ≥ 50 bps | High |
| Acquirer **Excessive** | ≥ 70 bps | High |
| **Merchant Excessive** (US, Canada, EU, AP) | **≥ 150 bps from 1 Apr 2026** (was 220 bps) | High |
| Merchant Excessive (CEMEA) | ≥ 220 bps | High |
| Merchant minimum monthly count | **≥ 1,500** combined TC40 + TC15 | High |
| Enumeration ratio / count | ≥ 2,000 bps / ≥ 300,000 txns | High |
| Merchant "Above Standard" tier | **Does not exist** — merchants have Excessive only | High |
| Fee: Above Standard / Excessive | $4 / $8 per CNP event | **Medium — Visa does not publish this** |
| First-violation grace | 3 months in a rolling 12 | Medium (single source) |

**Four details that are routinely got wrong:**
1. **VAMP is card-not-present only.** A restaurant or salon is substantially outside the ratio.
2. **Numerator combines issuer fraud reports (TC40) with disputes (TC15).** A merchant with near-zero
   chargebacks can still be flagged on TC40s it never sees on a statement.
3. **Two exclusions flatter the ratio:** disputes deflected via RDR / Order Insight / Ethoca, and
   TC40s qualifying for Compelling Evidence 3.0. Remove those post-close and the number rises with
   no change in behaviour.
4. **Merchant thresholds are conditional** on the acquirer not itself being Above Standard/Excessive.

**⚑ Deal-band reality check.** 1,500 combined events/month at 1.5% implies ~100,000 CNP
transactions/month. **No $200k–2M business reaches merchant-level VAMP identification.** VAMP risk in
this band is entirely indirect — the target degrading its *acquirer's* portfolio ratio, which is what
actually triggers repricing, reserves and offboarding. Rate the acquirer relationship, not the ratio.

### 1.2 Mastercard — ECP (ECM / HECM) and EFM

⚠️ **Sourcing caveat to disclose:** Mastercard's SPME manual (4 Aug 2026) returns HTTP 403 to
automated retrieval. All figures rest on acquirer/processor restatements. Best available:
[J.P. Morgan Merchant Services, Mastercard Excessive Chargeback Program Guide](https://www.jpmorgan.com/content/dam/jpm/merchant-services/payment-network-updates/documents/mastercard-excessive-chargeback-program-guide.pdf)
— **document is Rev. 12/2019**; thresholds corroborated by four current sources.

**The CTR denominator lags one month.** Verbatim: *"Divide that number by the number of sales
transactions received from that merchant location in the preceding month."* Independently confirmed by
[Braintree/PayPal docs](https://developer.paypal.com/braintree/articles/risk-and-security/card-brand-monitoring-programs/mastercard-programs/excessive-chargeback-program)
("June chargebacks / May sales"). **Confidence: High.**

| Tier | Chargeback count | CTR | Conf. |
|---|---|---|---|
| **ECM** | 100–299 | 150–299 bps | High |
| **HECM** | ≥ 300 | ≥ 300 bps | High |

Both count **and** ratio must be met. Fines start in month 2 (USD 1,000), escalating to 100,000/200,000
at 19+ months; issuer recovery at USD 5 per chargeback over 300 applies from month 4. Exit requires
**three consecutive months below threshold**.

**EFM** (all criteria in the same month): ≥ 1,000 MC e-commerce sales prior month; ≥ USD 50,000 fraud
chargebacks; ≥ **50 bps** fraud-to-sales; 3DS/DSRP usage < 10% (non-regulated) or < 50% (regulated).
⚠️ One search result claimed 1.5% — **that is wrong**; every document-level source says 50 bps.
EFM assessments supersede ECM where both attach in the same month.

**No Mastercard threshold change identified for 2025 or 2026.** State this as "no announced change
identified," not "confirmed unchanged" — it is a negative finding against a blocked primary source.

**⚑ ECM is the threshold that actually bites in this deal band.** 100 chargebacks/month is reachable
for a small e-commerce or subscription business; VAMP's 1,500 is not. ECM counts **all** Mastercard
chargebacks with **no card-present exclusion**. And the prior-month denominator is a genuine
diligence trap: a seasonal or declining business gets a mechanically inflated ratio (January
chargebacks ÷ December sales). **Always recompute same-month and show the client both.**

### 1.3 Reserves and holds

**Honest finding first: there is no authoritative source publishing "standard" reserve percentages or
durations.** Reserves are a contractual term at acquirer discretion, not a network rule. Anyone
quoting "the standard is 10% for 180 days" as a rule is wrong.

**Mechanism and triggers — regulator-sourced, no numbers.**
[OCC Comptroller's Handbook, *Merchant Processing*, v1.0 Aug 2014](https://www.occ.treas.gov/publications-and-resources/publications/comptrollers-handbook/files/merchant-processing/pub-ch-merchant-processing.pdf)
(amended Mar 2025). Verbatim: acquirers establish reserves against merchants posing *"high risk or
… a history of charge-backs"* and where the product involves *"future/delayed delivery"*; funding is
*"a lump sum or by withholding a portion of each day's proceeds."* **Confidence: High for mechanism
and triggers; the handbook contains no percentages.**

**Contract language — better than any blog, and quotable.**
[Commerce Bank Merchant Processing Agreement, Ver. 10.15.2024](https://www.commercebank.com/merchantagreement):
a reserve may be required *"at any time, in its sole discretion"*, in an amount *"as determined by
Bank in its sole discretion"*; merchant has *"no right to withdraw funds"*; post-termination hold runs
*"for such timeframe as determined by Bank."* **Confidence: High (primary contract text).**

Typical figures are **vendor consensus only, Medium at best**: 5–10% typical (5–15% range, up to 20%
for elevated dispute accounts), held 90–180 days; capped reserves around half of monthly volume
(Low–Medium, single source). The "~0.9–1.0% chargeback ratio triggers a reserve" figure is
Low–Medium and is suspiciously close to the retired VDMP number — possibly an artifact of it.

### 1.4 Evidence of account standing — what to actually request

**⚠️ "Letter of good standing" is not a thing.** No authoritative source establishes it as a defined,
standard processor-issued instrument. It is not a Visa or Mastercard construct. **Do not build a
checklist item that assumes one can be obtained.** Substitute a seller-authorised written inquiry to
the acquirer plus a purchase-agreement representation.

**MATCH / TMF — the highest-value item in the whole topic.** Best source:
[Stripe Documentation, *Terminated merchant files*](https://docs.stripe.com/disputes/match) (Stripe is
a licensed acquirer documenting obligations it is bound by).

| Fact | Finding | Conf. |
|---|---|---|
| Listing duration | **5 years**, then automatic removal | High |
| Who can search | Acquirers and processors only — not merchant-searchable | High |
| Merchant self-check route | Ask the acquirer, or email **matchbusinessowner@mastercard.com** | Medium-High |
| Reporting deadline | Acquirer must add within **1 business day** | High |
| Removal | Only the listing acquirer, and only for error or cured RC 12 | High |
| Survives account closure | Yes — added even if the violation surfaces months after closure | High |
| Survives winning the disputes | Yes — *"Winning or reversing the chargebacks later doesn't alter this status"* | High |
| Data written | Business **and principal owner** name, address, phone, tax ID | High |

**MATCH reason codes with numbers — this is the threshold that matters at this deal size:**
- **Code 04, Excessive Chargebacks:** monthly MC chargebacks exceed **1%** of monthly MC sales **and**
  total **USD 5,000 or more**. Both in the same month. Stripe's worked example: 125 transactions,
  6 chargebacks, $6,250 → 4.8% → qualifies. No minimum chargeback count.
- **Code 05, Excessive Fraud:** fraud-to-sales ≥ **8%**, **≥ 10** fraudulent transactions,
  **≥ USD 5,000**.

Visa's equivalent is **VMSS**, confirmed against Visa Core Rules (18 Apr 2026) §10.17: acquirers must
list terminated merchants, must **notify the merchant in writing**, and must inform them of subject
access rights under applicable data-protection law. VMSS Code 21 (Excessive Fraud) = $250,000 and
180 bps in a month; Code 22 (Excessive Disputes) = 1,000 disputes and 180 bps. VMSS 5-year retention
is **Medium** — it appears in Stripe's docs but **not** in Visa's Core Rules, which are silent.

**⚑ Why this is the top Red-rating candidate in payment diligence at $200k–2M.** MATCH Code 04
triggers at 1% of MC sales and **only $5,000** of chargebacks — trivially reachable for a small
business, and vastly more reachable than VAMP's 1,500-count floor or ECM's 100-chargeback floor. The
consequence is asymmetric and durable: five years, attached to the **principal personally**, surviving
closure and surviving winning the disputes, effectively barring re-underwriting. A buyer acquiring a
business whose principal is MATCH-listed — or who will retain that principal as an operator or
guarantor — may be unable to obtain processing at all.

**Merchant accounts are generally not assignable.** Commerce Bank agreement §37: *"Neither Party shall
sell, assign or transfer this Agreement or any part thereof without the prior written consent of the
other Party"* — while the bank may assign freely. The same agreement makes a change of **more than 25%**
of legal or beneficial ownership an **event of default**, with a 30-day advance notice obligation for
a "Change in Business." **Confidence: High (primary contract text).** Processor-level corroboration:
Stripe requires a new account where the legal entity changes — though ⚠️ **Stripe's own page is
deliberately non-committal**; the flat statement comes from a secondary source (Medium). OCC confirms
a new MID means a fresh MATCH and OFAC screen: *"Such checks are standard industry practice."*

### 1.5 Paste-ready guidance text

> **Chargeback standing (Visa).** Request 13 months of Visa TC40 fraud-report counts and TC15 dispute
> counts alongside settled card-not-present transaction counts, and compute the VAMP ratio as
> (TC40 + TC15) ÷ settled CNP transactions per Visa's published formula. The Excessive merchant
> threshold is 150 bps in the US, Canada, EU and AP effective 1 April 2026 (reduced from 220 bps) and
> requires a minimum of 1,500 combined events in a month — a floor most businesses in this deal band
> will never reach, so treat any ratio above 1.00% as an acquirer-relationship risk (repricing,
> reserve, offboarding) rather than a Visa-enforcement risk. Confirm in writing whether the target
> uses pre-dispute deflection (RDR, Order Insight, Ethoca) or Compelling Evidence 3.0, because Visa
> excludes both from the ratio and their removal post-close will raise the reported number without any
> change in actual dispute behaviour. **Red** if the acquirer has issued any written VAMP or
> risk-program notice in the trailing 12 months; **Yellow** if the computed ratio exceeds 0.70%;
> **Green** below 0.65% with no notices.

> **Chargeback standing (Mastercard).** Obtain 13 months of Mastercard chargeback counts and sales
> counts by MID and recompute the CTR the way Mastercard does: chargebacks in a calendar month divided
> by sales transactions in the **preceding** month. ECM requires 100–299 chargebacks and a CTR of
> 1.50–2.99% in the same month; HECM requires 300+ and ≥3.00%; fines begin in the second consecutive
> violation month and exit requires three consecutive months below threshold. Because the denominator
> lags one month, recompute on a same-month basis as well and flag any target whose seasonality or
> declining volume produces a lagged ratio materially above the same-month ratio — that is a
> mechanical artifact, not deteriorating dispute behaviour, and it should be disclosed rather than
> scored blind. Separately confirm 3D Secure usage on CNP volume, since the Excessive Fraud Merchant
> program can attach at only 0.50% fraud-to-sales with USD 50,000 in fraud chargebacks where 3DS usage
> is below 10% in non-regulated markets.

> **Reserves and holds.** Request the merchant processing agreement in full plus 13 months of
> statements, and locate three things: the reserve clause, any reserve line item on the statements, and
> the post-termination fund-hold provision. Standard-form agreements permit the acquirer to impose a
> reserve at any time, in its sole discretion, in an unspecified amount, with the merchant having no
> right to withdraw the funds — so the absence of a reserve today is not evidence that one cannot be
> imposed tomorrow, and a reserve currently in place is an explicit statement that the acquirer has
> priced this merchant as elevated risk. Where a reserve exists, document the percentage withheld, the
> hold period, whether it is rolling, capped or up-front, and the current accrued balance, then confirm
> whether that balance is included in the assets being purchased or remains with the seller's entity.
> Industry-typical structures of 5–10% of volume held 90–180 days are vendor convention, not a
> published rule — the only binding numbers are the ones in the target's own agreement.

> **Evidence of standing.** Request, under a seller authorisation letter addressed to the acquirer:
> 13 months of statements showing MID, monthly transaction count, gross volume, chargeback count and
> value by card brand, and any reserve or fine line items; the complete processing agreement with all
> addenda; and copies of every written notice from the acquirer or card networks in the trailing 24
> months, including any monitoring-program, reserve, repricing or intent-to-terminate letter. Do not
> rely on a "letter of good standing" — it is not a defined card-network instrument and processors are
> under no obligation to issue one. Require the seller and every principal owner to represent that
> neither the business nor they personally are listed on Mastercard's MATCH database or Visa's VMSS,
> noting that a MATCH listing lasts five years, attaches to principals by name, address and tax ID,
> survives account closure, cannot be cured by later winning the disputes, and can be triggered by as
> little as 1% of Mastercard sales and USD 5,000 of chargebacks in a single month. Where the seller
> does not know their status, direct them to their acquirer or to matchbusinessowner@mastercard.com.
> **Treat unwillingness to make the representation as Red regardless of what the statements show.**

> **Processing continuity at close.** Confirm in the processing agreement that the relationship cannot
> be assigned to the buyer: standard-form agreements bar merchant assignment without written consent
> while permitting the bank to assign freely, and commonly define a change of more than 25% of legal or
> beneficial ownership as an event of default requiring advance notice. Plan on the buyer applying for
> a new merchant account and new MID under the acquiring entity, with full re-underwriting including
> MATCH and OFAC screens of the buyer and its principals, and treat approval timing as a closing
> dependency rather than an administrative afterthought. Quantify the gap risk explicitly — days
> without processing, deposit-hold terms on a newly underwritten account, and any up-front reserve a
> new merchant is likely to be assigned — and confirm who bears chargeback liability on pre-close
> transactions that dispute after close, since those land on the seller's MID and the seller's reserve.
> **Red** where processing continuity is assumed rather than evidenced, where pricing depends on a
> legacy rate card that will not survive re-underwriting, or where an active reserve is unaddressed in
> the purchase agreement.

---

## 2. Trademark conflict scan

Maps to `spec.md` §4 Tier A, "Trademark conflict scan on business name / domain" (manual,
consultant-triggered).

### 2.1 The register and the tooling

- **TESS retired 30 Nov 2023**, replaced by the **Trademark Search** system at
  [tmsearch.uspto.gov](https://tmsearch.uspto.gov/).
  [USPTO announcement](https://www.uspto.gov/subscription-center/2023/retiring-tess-what-know-about-new-trademark-search-system). **High.**
- Coverage: federally registered **and pending** marks, **live and dead**. USPTO: *"Only live trademark
  applications and registrations can prevent your trademark from being registered."*
  [Federal trademark searching](https://www.uspto.gov/trademarks/search/federal-trademark-searching). **High.**
- **Dead ≠ safe.** USPTO, same page: *"While they can't bar your registration, they can present other
  legal problems if they're still being used in commerce… an owner can use their common law rights to
  take legal action against you… even if you have a federal registration and they don't."* **High.**
  This is the single most important sentence in the topic.
- **TSDR** — [tsdr.uspto.gov](https://tsdr.uspto.gov/) — status plus the full electronic file wrapper.
  This is where you verify a mark the seller *claims* is registered actually is, and that §8/§9
  maintenance filings were made. **High.**
- **Trademark ID Manual** — [idm-tmng.uspto.gov](https://idm-tmng.uspto.gov/) — accepted identifications
  of goods/services and their classes. **High.**
- **Assignment Center** — [assignmentcenter.uspto.gov/search/trademark](https://assignmentcenter.uspto.gov/search/trademark)
  — chain of title, mergers, name changes, **security interests**, licences. **The search database shows
  only the last recorded owner, not the chain.** For a $200k–2M deal this is where an undisclosed lien
  against the mark, or a mark still recorded in a predecessor entity, surfaces. **Medium-High.**
- Free international screens: [WIPO Global Brand Database](https://branddb.wipo.int/),
  [Madrid Monitor](https://www3.wipo.int/madrid/monitor/en/), [TMview](https://www.tmdn.org/tmview/),
  [TMOG](https://eog-tmng.uspto.gov/). All named by USPTO. **High.**

### 2.2 USPTO's own position — the consultant's strongest defensive material

All from [Comprehensive clearance search](https://www.uspto.gov/trademarks/search/comprehensive-clearance-search-similar-trademarks)
and [Why search for similar trademarks?](https://www.uspto.gov/trademarks/basics/why-search-similar-trademarks). **All High.**

- *"A comprehensive clearance search typically involves searching our trademark database of federally
  registered and applied-for trademarks, state trademark databases, and the internet."*
- *"[T]he trademark examining attorney assigned to your application will also conduct a search, [but]
  they will only determine whether there are conflicting trademarks in our federal database. **It's your
  responsibility to search state trademark databases and the internet.**"*
- USPTO *"can't give you a clear-cut answer about whether your trademark can be registered"*; recommends
  hiring a private trademark attorney.
- *"Although USPTO trademark examining attorneys can provide information about the federal registration
  process, USPTO employees cannot give you legal advice."*
- Attorney representation is **required** for foreign-domiciled parties.
  [Hiring a U.S.-licensed attorney](https://www.uspto.gov/trademarks/basics/why-hire-private-trademark-attorney), upd. 10 Oct 2024.

⚠️ **Do not quote "USPTO does not conduct searches for the public."** That exact sentence could not be
found on any uspto.gov page. Use the verified quotes above instead.

**⚑ The framing that protects the consultant:** *you are not inventing a methodology, you are executing
the one USPTO publishes.* Cite the comprehensive-clearance page by URL in the workpaper.

### 2.3 Likelihood of confusion and the class trap

Controlling case: *In re E. I. du Pont de Nemours & Co.*, 476 F.2d 1357 (C.C.P.A. 1973). Examiner
guidance: **TMEP §1207.01**, current edition **May 2026**
([tmep.uspto.gov](https://tmep.uspto.gov/RDMS/TMEP/print?version=current&href=TMEP-1200d1e5044.html)). **High.**

⚠️ **The TMEP's own foreword says it "do[es] not have the force and effect of law."** It describes
*examiner* behaviour on *registrability* — not a buyer's litigation exposure. Keep those separate;
conflating them is the most common amateur error in this area.

Two legs, both required: similarity of the marks (appearance, sound, connotation, commercial
impression) **and** relatedness of the goods/services *as identified*. TMEP: *"the goods or services do
not have to be identical or even competitive"*; *"there can be no rule that certain goods or services
are per se related"*; *"There is no litmus rule."*

**The class trap, with an authoritative statement — TMEP §1207.01(d)(v)**
([official URL](https://tmep.uspto.gov/RDMS/TMEP/print?version=current&href=TMEP-1200d1e6073.html)):

> *"The classification of goods and services has no bearing on the question of likelihood of confusion.
> … Rather, it is the manner in which the applicant and/or registrant have identified their goods or
> services that is controlling."*

**Same class ≠ conflict; different class ≠ safe.** Report the class as a fact; never report it as the
finding.

⚠️ **Nice edition correction: it is the 13th, not the 12th.** NCL(13-2026), in force **1 Jan 2026**
([USPTO](https://www.uspto.gov/trademarks/trademark-updates-and-announcements/nice-agreement-current-edition-version-general-remarks),
[WIPO](https://www.wipo.int/en/web/classification-nice)). **High.** Classes move between editions
(corrective glasses and sunglasses moved Class 9 → Class 10), so a pre-2026 registration's class may
not match a 2026 filing for the same goods. Existing registrations are **not** reclassified.

### 2.4 State registers and common-law rights

- State registration confers **statewide rights only, no nationwide presumption**. USPTO: *"[State
  registration] creates rights in that state only."*
  [Why register your trademark?](https://www.uspto.gov/trademarks/basics/why-register-your-trademark). **High.**
  Federal presumption basis: **15 U.S.C. § 1115(a)**.
- Search index: [USPTO state trademark information links](https://www.uspto.gov/trademarks/basics/state-trademark-information-links)
  (50 states + PR). **There is no official consolidated multi-state trademark search.** Consumer tools
  advertising "all 50 states in 60 seconds" search **business-entity** registries, not trademark
  registers — do not cite them. **Medium-High** (searched for one specifically; found none).
  ⚠️ Minor USPTO internal inconsistency on whether D.C. has a register — note the discrepancy rather
  than asserting either way.
- **Common-law rights arise from use, not registration**, and can beat a federal registrant in the prior
  user's geography — **15 U.S.C. § 1115(b)(5)**, which *"shall apply only for the area in which such
  continuous prior use is proved."* **High.** This is the safer cite than Tea Rose–Rectanus pin cites,
  which are secondary-sourced here.
- USPTO's own named common-law search surfaces: the trademark search system, TMOG, state trademark and
  business registries, domain registries, Madrid Monitor, Global Brand Database, EUIPO, TMview, and
  *"multiple search engines."* App stores and social handles are **not** on USPTO's list — mark those as
  supplementary observation.

### 2.5 The non-attorney line

**Federal rules (verified):** 37 C.F.R. § 11.14(b) — *"Individuals who are not attorneys are not
recognized to practice before the Office in trademark and other non-patent matters."* § 11.5(b)(2)
defines practice to include *"consulting with or giving advice to a client in contemplation of filing a
trademark application."* USPTO enforcement page: actions by a precluded non-attorney are invalid from
the start of that representation. **All High** (Cornell LII; eCFR blocked automated fetch — verify
against eCFR before publishing).

⚠️ **Honest gap: no citable authority exists for a non-lawyer due-diligence consultant reporting
trademark search results.** Searched specifically for a state bar ethics opinion or reported case;
none found. The "facts vs. application of law to facts" heuristic appears consistently in secondary
sources but **cannot be footnoted**. Protection comes from (a) staying factual, (b) the disclaimer,
(c) engagement-letter scope, (d) E&O carrier review — a judgment call, not a cited finding.

Structurally: § 11.14 governs *representation before the USPTO*, which a diligence consultant is not
doing. But § 11.5(b)(2)(i) is a useful bright line to adopt voluntarily.

| Safe to report (fact) | Crosses into legal opinion |
|---|---|
| "A live federal registration, Reg. No. X, for mark Y in Class Z, owned by [entity], filed [date], covering [verbatim identification], appears in USPTO Trademark Search as of [date]." | "This registration does not conflict." |
| "Reg. No. X shows status DEAD per TSDR as of [date]." | "Because it's dead, there is no risk." |
| "The identification in Reg. No. X and the target's described business both refer to [overlapping wording]." | "These goods are legally related and confusion is likely." |
| "Assignment Center shows a security interest against Reg. No. X in favour of [lender] on [date]." | "This lien is/isn't enforceable." |
| "Whether any of the above gives rise to likelihood of confusion or infringement is a legal determination outside this engagement's scope." | Any conclusion applying the du Pont factors. |

**Words to avoid in report prose:** *infringe / infringement*, *clear*, *safe to use*, *no conflict*,
*likelihood of confusion* as a conclusion. **Use instead:** *observed*, *appears on the register as*,
*overlaps on its face with*, *warrants review by trademark counsel*.

### 2.6 Paste-ready procedure

> **Trademark conflict scan — field procedure.** Scope: a factual screening of public trademark
> registers and common-law surfaces. This is **not** a comprehensive clearance search and **not** a
> legal opinion. Budget 60–90 minutes per primary mark. Record the date and time of every search and
> save a PDF or screenshot of every result screen; every finding must be reproducible from the
> workpaper file.
>
> 1. **Fix the search subject list.** From the CIM, asset schedule, website, packaging, invoices and
>    signage, enumerate every name the business trades under: legal entity, DBAs, primary brand,
>    sub-brands, product lines, taglines, logos, domains. Record exact spelling and stylisation, whether
>    the seller represents each as registered and at what level, and the states and channels the
>    business actually operates in.
> 2. **Translate the business into goods/services language.** Use the USPTO Trademark ID Manual to find
>    the accepted identification wording and Nice class(es) matching what the target actually sells.
>    Record both. Relatedness is judged on the identification wording, not the class number; the current
>    edition is NCL 13-2026, in force since 1 January 2026, and classes shift between editions, so a
>    pre-2026 registration's class may not match a 2026 filing for the same goods.
> 3. **Federal register search.** In tmsearch.uspto.gov, search each mark for exact wording; phonetic
>    equivalents and common misspellings; the dominant word alone if the mark is a phrase; and
>    singular/plural and hyphenation variants. Run each search twice — live only, then including
>    dead/abandoned. Design marks require specialist searching; flag any material logo as outside this
>    scan's reach. For every hit record: mark as registered, serial no., registration no., status, owner
>    of record, filing date, registration date, class(es), and the **full identification text**.
> 4. **Verify material hits in TSDR and Assignment Center.** Confirm current status, owner of record,
>    prosecution history and whether maintenance filings are current. Then pull chain of title. Look
>    specifically for (i) a mark the seller claims to own that is still recorded in a predecessor or
>    founder's name, and (ii) a recorded security interest. Also check TMOG for marks approved but not
>    yet registered.
> 5. **State register search.** For each state where the target operates, sells or has locations, search
>    that state's register via the USPTO index. There is no consolidated multi-state trademark search;
>    each jurisdiction is searched individually. Record both the jurisdictions searched **and those not
>    searched**.
> 6. **Common-law surfaces.** Per USPTO's published guidance: state business-entity and DBA registries in
>    the operating states, domain registrations, and internet/search-engine sweeps for the mark in
>    connection with the same or adjacent goods. Supplementally, and noted as outside USPTO's published
>    list: app stores, social handles, industry directories. Record name, apparent operator, apparent
>    geography, apparent first-use evidence and date, URL and access date.
> 7. **International screen**, only where the target sells or sources abroad: WIPO Global Brand
>    Database, Madrid Monitor, TMview — all free. If domestic-only, state that this step was
>    deliberately scoped out and why.
> 8. **Build the facts table.** One row per hit: mark | serial/reg. no. | status + date | owner | filing
>    date | class(es) | identification verbatim | source + search date. No adjectives, no conclusions.
> 9. **Apply the rating criteria and write any referral.** Every Red or Yellow gets one sentence naming
>    what counsel should opine on and by when relative to close.
> 10. **Assemble the workpaper file:** search list, timestamped evidence, facts table,
>     jurisdictions-not-searched list, scope limitations, disclaimer.

> **Rating criteria.** These describe observations and the action they warrant. They are not
> determinations of infringement, validity or likelihood of confusion.
>
> **🔴 RED — refer to trademark counsel before close.** Any of: a **live** federal registration or
> pending application, owned by an unaffiliated party, for a mark **identical or near-identical on its
> face** (differing only by spelling, spacing, hyphenation, pluralisation or obvious phonetic
> equivalence) **and** whose identification of goods/services **overlaps in wording** with the target's;
> the target's primary trading name has no federal registration of its own while such a third-party
> registration exists; a mark the seller represents as an acquired asset is not recorded in the seller's
> current legal entity in Assignment Center and no assignment document was produced; a recorded security
> interest against a scheduled mark with no payoff or release; a registration the seller relies on shows
> DEAD / ABANDONED / CANCELLED / EXPIRED or a missed §8/§9 deadline in TSDR; a live third-party
> registration subject to a pending opposition, cancellation or concurrent-use proceeding involving the
> target; documented third-party correspondence (cease-and-desist, opposition, demand letter) concerning
> any scheduled mark.
>
> **🟡 YELLOW — qualified; obtain counsel's view or a seller representation.** Any of: a live
> third-party registration for a mark **similar but not identical** in **adjacent but non-overlapping**
> goods; a live third-party registration for an identical mark in a **different, non-overlapping**
> identification — *class number recorded as a fact only, since per TMEP §1207.01(d)(v) "the
> classification of goods and services has no bearing on the question of likelihood of confusion"*; a
> DEAD or ABANDONED record for an identical mark in overlapping goods **together with** evidence the
> mark is still in use; a state registration held by an unaffiliated party in an operating state; one or
> more unregistered third parties operating under an identical-or-near-identical name in the target's
> category; the target's mark unregistered at every level while material to revenue or goodwill; a
> materially valuable **logo** where design-mark searching was out of scope; international sales with no
> international register searched; or any operating state that could not be searched.
>
> **🟢 GREEN — no conflict facts observed within scope.** Every listed mark searched live and dead on
> recorded dates; no live third-party registration for an identical-or-near-identical mark in
> overlapping **or adjacent** goods; where the target holds registrations, each is LIVE with current
> maintenance filings, owned by the current legal entity, with no unreleased security interest; state
> registers in every operating state searched with no unaffiliated hits; common-law surfaces searched
> with no unaffiliated operator in the target's category; no dead-but-apparently-in-use conflicting
> mark; no scope limitation material to brand value.
>
> **Green means no conflict facts were observed within the stated scope on the stated date. It does not
> mean the mark is clear to use.**

> **Disclaimer (report scope page).** The findings in this section are factual observations recorded
> from public sources on the dates stated. They are not legal conclusions. [Firm] is not a law firm,
> does not practice law, and is not authorised to represent any party before the USPTO in trademark
> matters (37 C.F.R. § 11.14). Nothing here constitutes legal advice, a legal opinion, a clearance
> opinion, or an assessment of whether any mark infringes, is likely to cause confusion with, or is
> registrable over any other mark.
>
> This is not a comprehensive clearance search. The USPTO states that such a search requires the
> federal register, state trademark and business registries, domain registries, international registers
> and the internet, and recommends it be conducted or interpreted by a U.S.-licensed attorney. The
> sources searched — and those **not** searched — are itemised above; findings are limited accordingly.
>
> A search of the federal register alone is incomplete by construction. In the United States trademark
> rights arise from use in commerce, not registration. An unregistered prior user may hold rights
> superior to a federal registrant within the geographic area of that prior use (15 U.S.C.
> § 1115(b)(5)). The absence of a federal registration is not evidence that no conflicting rights
> exist, and a record shown as dead, abandoned or cancelled does not establish the mark is out of use.
>
> Nice classification is recorded as a fact only. It is not a test of conflict: per TMEP § 1207.01(d)(v),
> "The classification of goods and services has no bearing on the question of likelihood of confusion."
>
> Register contents change daily; results are current only as of the recorded search dates. The buyer
> should obtain review by qualified trademark counsel before closing on any Red or Yellow item, and
> should not treat a Green rating as a clearance opinion.

---

## 3. Data-export / portability test

Maps to `spec.md` §4 Tier C, "Data-export test (can the buyer actually get their data out)". Also
directly relevant to §5's Restaurant and Salon templates.

### 3.1 The definitional anchor

**There is no published M&A-specific standard for what an adequate export looks like — that is itself
a finding** (see §6.3). The defensible benchmark is the data-portability body of law, used **as a
yardstick, not as a legal claim**.

- **GDPR Art. 20(1):** data must be provided *"in a structured, commonly used and machine-readable
  format"* and transmissible *"without hindrance."*
  [EUR-Lex CELEX 32016R0679](https://eur-lex.europa.eu/legal-content/EN/TXT/?uri=CELEX%3A32016R0679). **High.**
- **WP242 rev.01** (Art. 29 WP, adopted 13 Dec 2016, rev. 5 Apr 2017, **endorsed by the EDPB 25 May
  2018**) — [PDF](https://ec.europa.eu/newsroom/dae/redirection/document/44099). **High.** The operative
  quotes:
  - *"Documents encoded in a file format that limits automatic processing… should not be considered to
    be in a machine-readable format."* → **PDF fails.**
  - *"data controllers should provide personal data using commonly used open formats (e.g. XML, JSON,
    CSV,…) along with useful metadata at the best possible level of granularity."*
  - **Hindrance** includes *"fees asked for delivering data, lack of interoperability or access to a
    data format or API… excessive delay or complexity to retrieve the full dataset."*
  - **Transaction history is explicitly in scope** as *"observed"* data (fn. 21: *"such as a transaction
    history or access log"*). Derived/inferred data is not.
  - A receiving controller *"may not use the transmitted third party data for his own purposes e.g. to
    propose marketing products and services to those other third party data subjects."*
- **US anchor: Cal. Civ. Code § 1798.130(a)(2)** — *"readily useable format that allows the consumer to
  transmit this information from one entity to another entity without hindrance"*; 12-month lookback,
  extendable *"unless doing so proves impossible or would involve a disproportionate effort"*, for data
  collected on or after 1 Jan 2022. § 1798.130(a)(3)(B)(iii) carries the *"structured, commonly used,
  machine-readable"* phrase. **High.**
  ⚠️ **This language is in § 1798.130, not § 1798.100** — a common miscitation. And it is **statutory
  only**: the phrases do **not** appear in the current CPPA regulations.
- **CPPA reg. § 7024(h)** is excellent anti-handwaving language: a business claiming disproportionate
  effort *"shall provide the consumer a detailed explanation… **shall not simply state that it is
  impossible or would require disproportionate effort.**"* **High.**
- **M&A carve-out: Cal. Civ. Code § 1798.140(ad)** — transferring personal information as an asset in a
  merger or acquisition is **not** a "sale", *"provided that information is used or shared consistently
  with this title"*; a buyer who materially alters use must give prior notice. **High.**

**Two scoping caveats the consultant must not get wrong:**
1. **Art. 20 is a right of the *data subject*, not of the *business*.** A salon owner asking Booksy for
   their client list is not exercising Art. 20. A checklist line saying "GDPR guarantees the seller can
   export their client list" would be **wrong**.
2. **Technical portability and legal transferability are separate failure modes.** The list can be
   extractable and still encumbered. [FTC / Toysmart.com, 21 Jul 2000](https://www.ftc.gov/news-events/news/press-releases/2000/07/ftc-announces-settlement-bankrupt-website-toysmartcom-regarding-alleged-privacy-policy-violations):
   *"Customer data collected under a privacy agreement should not be auctioned off to the highest
   bidder"*; sale permitted only as part of the whole website and only to a "Qualified Buyer" who could
   not change use without opt-in consent. **High** (26 years old, arose in bankruptcy — present as a
   durable principle, not current guidance). And separately: if the customer list is not explicitly
   scheduled in the APA, it may not transfer at all.

### 3.2 Per-platform verification

Documentation-date caveat: Square, Clover and Mindbody help articles carry **no dates**. Toast, Vagaro,
Shopify and Booksy do, and those are given below.

| | Square | Toast | Clover | Shopify | Mindbody | Vagaro | Booksy |
|---|---|---|---|---|---|---|---|
| Customer export | Yes (path Medium) | Yes, CSV | Yes, dashboard only | Yes, CSV | **Partial only** | Yes, **owner-only** | **No — support ticket** |
| Contact fields withheld | **Yes — masked** | No (no address field) | None documented | None documented | No | None documented | **Could not verify** |
| Sales export format | CSV | CSV/XLS | CSV | CSV | Excel/PDF | **Excel/PDF, no CSV** | **Excel only** |
| Item-level export | Separate report | `ItemSelectionDetails.csv` | Separate report | In the order CSV | Sales detail view | Per-line | Mixed |
| Documented range cap | Could not verify | **6 mo/pull, 48 mo total** | **1 yr/pull, 5 yr total** | None (>51 → email) | Could not verify | Could not verify | Could not verify |
| Link/file expiry | — | Guestbook **72h**; SFTP **7d** | **7 days** | — | SDE URL **30d** | — | — |
| **Appointment export** | **✅ Yes** | n/a | **❌ None documented** | n/a | **✅ Best in class** | **❌ No business-wide report** | **❌ Support-ticket favour** |
| API history ceiling | Bookings **31 days**; Orders 500/page | Read-only, **paid RMS per location** | Payments **90 days**; bulk 30-day chunks | Orders **60 days** w/o `read_all_orders` | $0.002/call, approval | **No list/range/txn endpoints** | **None documented** |
| Reviews portable | — | — | — | — | ✅ Excel | ❌ | ❌ platform-owned |
| Account transfers on sale | **❌ "does not support"** | ✅ Care-only, US-only, 7–11d | **Could not verify** | **✅ Self-service** | ⚠️ Manual; merchant acct does **not** | **✅ Self-service** | **❌ None documented** |
| Embedded lending blocks it | Square loan | **Toast Capital** | — | **Shopify Capital/Credit** | — | — | — |
| Post-close window | **None — gone on deactivation** | **60 days** | Not documented | Seller loses access at transfer | **25d to request; 30d to loss** | — | — |

**The verbatim quotes worth keeping:**

- **Square, account transfer:** *"Square does not support transferring an account during the sale of a
  business because the transfer disrupts tax reporting for the new owners."*
  [7675](https://squareup.com/help/us/en/article/7675-transfer-ownership-of-your-square-account). **High.**
- **Square, deactivation:** *"If you choose to deactivate your Square account, you will not be able to
  access any of your payment history or account information."*
  [3819](https://squareup.com/help/us/en/article/3819-deactivate-your-account). **High.**
- **Square, contact masking:** *"…if your email address is johnsmith@gmail.com, a subsequent seller will
  only see a masked version, such as jo\*\*@gm."*
  [6750](https://squareup.com/help/us/en/article/6750-square-profile). API-level:
  instant profiles without public info *"isn't returned in a ListCustomers or SearchCustomers
  response."* [Customers API](https://developer.squareup.com/docs/customers-api/what-it-does). **High.**
  **⚑ A Square customer count materially overstates the contactable list. This is a valuation issue on
  any list-driven business, and it is vendor-confirmed.**
- **Square, appointments — this one works**, contrary to expectation: *"Appointments… Settings > History.
  Click Export to download and save a .CSV file."*
  [5351](https://squareup.com/help/us/en/article/5351-manage-your-square-appointments-account-settings). **High.**
  (Appointments *Reports*, separately, are not exportable.)
- **Toast, the highest-severity finding** ([Can I download a backup of all of my Toast data?](https://support.toasttab.com/en/article/Can-I-download-a-back-up-of-all-of-my-Toast-data), 9 Jul 2026):
  *"You can access data for the last 48 months, and you can filter a report for six months at a time."*
  + *"When you close your Toast account, your data will be accessible for 60 days."*
  + *"At this time, there is no single export of your Toast data."*
  **⚑ 60 days to pull 48 months, six months and one report at a time, with no bulk export. That is a
  pre-close condition, not a post-close task.**
- **Toast, the file-naming trap:** `OrderDetails.csv` is header rows only — item revenue lives in
  `ItemSelectionDetails.csv`. An analyst who pulls the natural-sounding file gets no items. **High.**
- **Toast, guest export caps:** download link expires in **72 hours**; *"If your restaurant management
  group has more than 250,000 guests, the export is limited to guests who have ordered within the past
  six months."* Requires permission **4.13** plus whole-group access.
  [Guestbook](https://support.toasttab.com/en/article/Access-Your-Guest-Data-with-the-Guest-Report), 17 Sep 2026. **High.**
- **Toast, ownership transfer cash-flow exposure:** *"all sales deposits will continue to flow to the
  current bank account on file… We cannot retrieve funds that have already been deposited and re-deposit
  them to another bank account."* 7–11 days, US-only, Toast Capital must be resolved first.
  [How do I transfer ownership](https://support.toasttab.com/en/article/How-do-I-transfer-ownership-of-my-Toast-account), 16 Sep 2026. **High.**
- **Clover, the cleanest documented caps:** *"You can access up to 5 years of data in the dashboard, but
  you can select only one year at a time"*; *"If you don't export the requested report within 7 days,
  run or request the report again"*; >3 months switches to an emailed report request. Customer list
  cannot be exported from a Clover device. **All High.** A 5-year Clover pull is five separate requested
  reports, each expiring in seven days.
- **Clover, appointments:** the entire public Appointments help branch plus the FAQ were walked;
  **no appointment/booking export is documented anywhere.** Documented-absence finding (logged-out help
  tree is a subset). Clover's API is *worse* than the dashboard for history — payments *"will not exceed
  90 days."*
- **Mindbody:** full client migration is **cancellation-only, paid, owner-only**, with a **25-day request
  deadline and 30 days to total loss**; SDE URL expires in 30 days; Client Directory view is capped at
  **1,000 clients, copy-paste only**. *"Legal rights to this merchant account do not transfer"* — the
  new owner must apply within 30 days or cannot accept integrated payments, and *"Transactions processed
  before the new merchant account is active continue to be deposited into the previous owner's bank
  account."* **High.** Appointment history export, by contrast, is **best in class**.
- **Vagaro, the date-range trap** — vendor's own warning: *"values such as how much a customer spent…
  show the totals for that period only"* and *"the report will only show customers you've gotten during
  the date range."* **An analyst who leaves a default date range on receives a truncated customer list
  with understated lifetime spend.** **High.**
- **Vagaro, the appointment gap:** no business-wide per-appointment report exists. "Appointments
  Summary" is a **chart of counts by status**, not rows. Full history requires unioning Transaction
  List + Cancellations & No-Shows + Missed Checkouts (with seams), downloading each customer's tab one
  at a time, or buying the **Data Lake** add-on ($40/mo + $10/location, 24-hour lag, Power BI/Tableau
  only). The API has **no list-all-customers, no date-range appointment query, and no transactions
  endpoint at all**. **High.** Ownership transfer, by contrast, is **self-serve in one session** — the
  cleanest of all seven.
- **Booksy:** the help-center section titled "Data Export" contains exactly one article whose entire
  body is *"please reach out to the Support Team at info.us@booksy.com."*
  [Article](https://support.booksy.com/hc/en-us/articles/16539806017938-How-do-I-obtain-a-copy-of-my-Client-List-from-Booksy), upd. 3 Sep 2026. **High.**
  No appointment export article exists across the full 255-article corpus. No merchant API (`API`
  returns 0 hits; partner docs are HTTP 401). **No ownership-transfer process is documented at all** —
  the Owner role *"is automatically assigned to the person who created the Booksy account"* and no
  documented operation moves it. Reviews are Customer "Content" **licensed to Booksy** (Booksy for
  Customers ToS, 15 Jun 2026, §§1, 3.3–3.4), attached to the Booksy profile, import-only.
  **⚑ Any valuation treating a 4.9★ Booksy profile as transferable goodwill is treating a
  platform-locked, third-party-owned artifact as goodwill.**
  ⚠️ **Unresolved contradiction:** a competitor's migration page (Goldie, 2 Sep 2025) claims a
  "Customers → Export to CSV" button exists, contradicting Booksy's own current article. Jane App agrees
  with Booksy. **Treat as an open question to resolve on-screen during diligence, with Booksy's own doc
  as the presumption.**
- **Booksy, records hollow out:** if a client deletes their Booksy account, *"all the data within Booksy
  will be deleted within 7 days… their name, phone number, email address."* **High.**

**Useful contrasts on reviews:** Google reviews **do** follow the profile on an ownership transfer
([Google](https://support.google.com/business/answer/3415281)). Yelp **may** split the page where new
owners make a significant name change, and does not state what happens to reviews in that case
(**Medium**).

### 3.3 Paste-ready guidance text

> **Data export & portability test.** The customer list, transaction history and (for
> appointment-driven businesses) booking history are usually the most valuable transferred assets in a
> small-business sale, and the ones most often discovered to be non-transferable **after** closing. This
> item does not ask whether the seller believes the data can be exported. It requires the export to be
> produced and reconciled during diligence.
>
> **Benchmark for adequacy.** In the absence of any published M&A standard, use the regulatory
> data-portability benchmark: a *"structured, commonly used and machine-readable format"* (GDPR Art.
> 20(1); Cal. Civ. Code § 1798.130(a)(3)(B)(iii)) — an open format such as CSV, JSON or XML, **not PDF,
> not a printed report, not a screenshot**. WP242 rev.01 (p. 18): *"Documents encoded in a file format
> that limits automatic processing… should not be considered to be in a machine-readable format."*
> Obstacles including *"fees asked for delivering data, lack of interoperability or access to a data
> format or API… excessive delay or complexity to retrieve the full dataset"* are characterised as
> *hindrance* (WP242, p. 15). Transaction history is explicitly in scope as observed data (fn. 21).
> Note for the report: Art. 20 is a right of the individual customer, not of the business — cite it as
> the standard for what an adequate export looks like, not as a right the seller can compel.

> **Verification procedure.**
>
> **0. Ground truth first.** Record independently: reported TTM revenue; business age / earliest
> plausible trading date; **in-app record counts** as the platform displays them (customers, orders,
> appointments — screenshot these); the seller's subscription tier and add-ons (export capability is
> plan-gated on at least four of the seven platforms studied); and whether an embedded loan exists
> (Shopify Capital/Credit, Toast Capital, Square loan), which blocks or gates account transfer on three.
>
> **1. Request the export on a screen-share** — (a) full customer list; (b) full transaction history at
> **line-item** grain; (c) full appointment history where applicable; (d) gift-card, package and
> membership balances; (e) payout/settlement history with per-transaction fees. Record **who** could run
> it (owner-only is a dependency that does not survive the owner leaving), **on what device** (several
> paths are web-only), **how long it took and whether it arrived by email** (which starts a link-expiry
> clock of 72 hours to 30 days), and **whether it required a support ticket** — if so it is not a
> capability, it is a favour, and may not be repeatable post-close.
>
> **2. Check the format.** CSV/JSON/XML passes. XLSX passes but check against Excel's hard ceiling of
> 1,048,576 rows — a file at the ceiling is presumptively truncated. PDF, print-only, screenshots, or
> "copy the on-screen table" **fails the machine-readability benchmark**; cite WP242 directly.
>
> **3. Row count vs reported revenue.** Sum the amount column and compare to reported revenue for the
> same period. Within ~2% with the residual explained (tips, taxes, gift-card redemptions, refunds,
> non-POS revenue) passes. Divide revenue by row count for an implied average ticket; if it is far above
> the business's actual average ticket, rows are missing. **Round-number row counts — 500, 1,000, 5,000,
> 10,000, 50,000 — are export limits, not coincidences.** Confirm you have the right file: on Toast,
> `OrderDetails.csv` is header-only and item revenue lives in `ItemSelectionDetails.csv`; on Vagaro,
> "Appointments Summary" is a chart of counts, not rows.
>
> **4. Earliest transaction date vs business age.** Sort ascending. A date ≈ the business start means
> full history. A date ≈ exactly 12/24/48/60 months ago is a **retention horizon or export cap** — ask
> which. A date ≈ 60 or 90 days ago means you have hit an **API default window** being passed off as
> history (Shopify without `read_all_orders`; Clover payments). Where the platform caps range per pull
> (Clover 1 year, Toast 6 months), confirm every consecutive window was run and that the files join at
> the boundaries without gaps or double-counting.
>
> **5. Field completeness on the customer list.** Compute: total rows vs the in-app count; **non-null
> email and phone counts**, absolute and as a percentage; **masked-value count** (search for `*`, `@`
> with no domain, phone values under 10 digits — on Square this is expected and vendor-documented);
> whether a marketing-consent column exists and is populated; whether address, emergency contact, notes
> and custom fields survived. **The number that matters is not the row count, it is the contactable
> count** — rows with a usable, unmasked email or phone **and** a consent the buyer can lawfully rely on.
> State both. A large gap is a valuation adjustment, not a technical footnote.
>
> **6. Appointment history** (appointment-driven businesses only — the step that most often fails).
> Confirm per-appointment **rows**, not a summary or chart; **all statuses** including cancellations and
> no-shows, not just paid appointments (a transactions-only reconstruction omits exactly the data that
> reveals demand quality); and full-period coverage. Check the permission the export ran under —
> Mindbody's "Own schedule ONLY" silently truncates to one staff member's calendar and will look
> complete. Check the date filter did not rescope lifetime values (Vagaro documents that it does).
>
> **7. Spot-check reconciliation.** Pick three non-adjacent months, at least one in the earliest year
> available, and tie out three ways: export → the platform's own sales summary (should match to the
> cent; if not, one is filtered); platform → processor settlement (allowing for fees, tips, chargebacks,
> last-batch timing); settlement → bank deposits. Then trace ten individual transactions end-to-end
> through all three, including at least one refund and one gift-card redemption — these are where
> cash-vs-accrual and export-scope errors surface.
>
> **8. Transferability, as distinct from exportability.** Require a documented or written answer to
> each: can the **account** transfer (Square documents **no** for a business sale; Shopify and Vagaro are
> self-service; Toast and Mindbody are support-mediated and slow; Clover and Booksy have **no vendor
> documentation** — get it in writing before signing); does the **merchant/payments account** transfer
> (Mindbody documents that it does not, and that pre-cutover transactions keep depositing to the
> seller's bank account — a working-capital item, not an IT item); is there an **embedded loan**; how
> long does data remain accessible after close or cancellation (Toast 60 days, Mindbody 25 days to even
> *ask*, Square gone on deactivation — put this in the closing checklist as a dated seller obligation);
> is the customer list **legally** transferable given the privacy policy as it stood when the data was
> collected; is it **named in the APA**; do reviews and the marketplace profile transfer; and do
> card-on-file payment methods transfer (assume **no** across the board and model attrition).

> **🟢 GREEN.** All of: customer list, line-item transaction history and (where applicable) appointment
> history **all produced during diligence** as actual files in CSV/JSON/XML or XLSX below the row
> ceiling; transaction total ties to reported revenue within ~2% for the sampled months with the
> residual explained; earliest transaction date reaches the business's start, or the shortfall is fully
> explained by a documented platform retention limit the buyer has accepted in writing; contactable rate
> consistent with the business's stated marketing reach, with a populated consent field; appointment
> history per-appointment and including no-shows across the full period; all three tie-outs reconcile in
> all three sampled months and 10/10 traced transactions clear; the account is transferable on a
> documented vendor-published process, or the buyer holds a signed, dated data-delivery obligation
> completing **before** any account closure window opens; no embedded loan blocks the transfer.
>
> **🟡 YELLOW — scope a migration workstream and price it.** Any of: export capped per pull (Clover one
> year, Toast six months) so full history needs multiple sequential requests with **expiring download
> links** (72 hours to 30 days) managed against the closing calendar; email-only delivery above a volume
> threshold, or owner-login-only, or web-only while the operator is mobile-only; appointment history
> obtainable only by stitching partial reports or only via a paid add-on; history reaching a documented
> retention horizon short of the business's age; API the only route to full history and it is plan-gated
> or paid; contactable rate materially below row count for a documented reason (quantify the gap and
> treat the marketable list as the smaller number); account transfer support-mediated with an
> unguaranteed date, or the merchant account not transferring so settlements keep flowing to the seller
> during the gap (price the float, set the cutover as a closing condition); reviews and marketplace
> profile not transferring where bookings are materially marketplace-sourced; loyalty, gift-card or
> package balances exportable but date-range-scoped rather than lifetime.
>
> **🔴 RED — a deal issue, not a task.** Any one of: the seller cannot produce the export during
> diligence at all, or only as PDF / print / screenshots / an on-screen table to copy-paste; transaction
> total does not tie to reported revenue and the discrepancy cannot be explained; earliest transaction
> date is ~60 or ~90 days ago, indicating an API default window passed off as history; appointment
> history cannot be exported at all for an appointment-driven business and no paid add-on or stitched
> reconstruction is being funded; the customer export is a support-ticket favour with no published
> schema, format or SLA and the seller has not obtained the file before the LOI expires; the account
> cannot transfer and no data-migration path is documented, with no dated pre-close export obligation in
> the purchase agreement; the post-close data window will expire before the buyer can extract; an
> embedded loan blocks the transfer and is not scheduled for payoff at or before close; the customer
> list is not named as a purchased asset in the APA, or the privacy policy at time of collection bars
> transfer to a successor, or the buyer's intended use is materially inconsistent with collection-time
> promises without a notice/opt-in plan.
>
> **Red does not necessarily kill the deal. It means the data becomes a priced, dated, contractual
> deliverable — a pre-close seller obligation with files in escrow — rather than something the buyer
> assumes will be there on day one.**

**Two lines worth bolding in the generated report:**
1. **A customer count is not a contactable customer count.** State both numbers.
2. **Extraction is a pre-close task on every platform studied.**

---

## 4. SPF / DKIM / DMARC posture

Maps to `spec.md` §4 Tier A, "Email authentication posture (SPF / DMARC; DKIM best-effort)", added
2026-09-21 per §13.1.

### 4.1 The RFCs — and the one that changed

| Protocol | RFC | Date | Status |
|---|---|---|---|
| SPF | **RFC 7208** | Apr 2014 | Proposed Standard |
| DKIM | **RFC 6376** | Sep 2011 | **Internet Standard — STD 76** |
| DKIM crypto | **RFC 8301** | Jan 2018 | Proposed Standard |
| One-click unsub | **RFC 8058** | Jan 2017 | Proposed Standard |
| DMARC (old) | ~~RFC 7489~~ | Mar 2015 | **OBSOLETE** |
| **DMARC (current)** | **RFC 9989** | **May 2026** | **Proposed Standard (Standards Track)** |
| DMARC aggregate reporting | RFC 9990 | May 2026 | Proposed Standard |
| DMARC failure reporting | RFC 9991 | May 2026 | Proposed Standard |

All verified against RFC Editor info pages. **High.**

⚠️ **DMARCbis landed.** DMARC is now **RFC 9989** and moved from Informational to **Standards Track**.
Any rubric text saying "DMARC is only an informational RFC" is now **wrong**.

⚠️ **`pct=` was removed** by RFC 9989 (App. A.6), replaced by binary `t=` test mode; `rf` and `ri` are
also gone. But `pct=` remains widespread in live DNS and is still honoured by many receivers — so
seeing it is **not** itself a defect, while `p=reject; pct=10` is behaviourally close to `p=none` for
90% of traffic. **Score on effective enforcement, not the literal `p=` value.**

**SPF details worth citing:**
- **10 DNS-lookup limit — RFC 7208 §4.6.4:** implementations *"MUST limit the total number of those
  terms to 10"* (`include`, `a`, `mx`, `ptr`, `exists`, `redirect`); exceeding it *"MUST return
  'permerror'."* Also: `MX` must not query more than 10 address records; void lookups *"SHOULD"* be
  limited to two. **High.**
  **⚑ This is the most common real-world defect on small-business domains** — 6–10 accumulated SaaS
  `include:` entries (Shopify + Mailchimp + Google + CRM + helpdesk). A domain that "has an SPF record"
  can still be unauthenticatable. It makes lookup count an observable, defensible criterion.
- **Why `+all`/`?all` is worthless — RFC 7208 §2.1:** *"it is necessary for them to publish records that
  end in '-all', or redirect to other records that do; otherwise, no definitive determination of
  authorization can be made."* **High.** Be precise: the RFC's strict reading names `-all`.
- `~all` is *"a weak statement… that the host is probably not authorized"* (§2.6.5); `-all` is *"an
  explicit statement that the client is not authorized"* (§2.6.4).
- **Non-sending domains — NIST SP 800-177r1 §4.4:** publish `v=spf1 -all` on domains that don't send
  mail *"to prevent them being used by phishers."* **⚑ Directly relevant to M&A: small businesses
  routinely own 3–15 parked/defensive/legacy domains, none covered by the primary domain's SPF.**

**DKIM key length and rotation:**
- **RFC 8301 §3.2:** signers *"MUST use RSA keys of at least 1024 bits"* and *"SHOULD use… at least 2048
  bits"*; verifiers *"MUST NOT consider signatures using RSA keys of less than 1024 bits as valid"*;
  `rsa-sha1` *"MUST NOT be used."* **High.**
- **NIST SP 800-177r1 Table 4-3** — RSA/SHA-256, **2048 bits**, lifetime **1–2 years**. Cleanest single
  citation for both "2048" and "rotate." **High.**
- ⚠️ **Source disagreement:** M3AAWG's 2019 key-rotation document still calls **1024 bits** "the current
  recommended length" — stale vs RFC 8301 and NIST, and not re-issued since. **Cite RFC 8301 + NIST for
  key length; cite M3AAWG only for the six-month rotation cadence** (*"DKIM keys should be rotated at
  least every six months"*, [M3AAWG, Mar 2019](https://www.m3aawg.org/DKIMKeyRotation)).
- ⚠️ **M3AAWG Sender BCP v4.0 (Aug 2026) does NOT contain the SPF/DKIM/DMARC checklist** widely
  attributed to it. Fetched and text-extracted: no `~all` prescription, no lookup guidance, no key
  length, no p=reject recommendation. **Do not repeat the secondary-source checklist.**
- **NIST SP 800-177r1 Rec. 4-10 — the most audit-relevant DKIM sentence in the corpus:** *"A unique DKIM
  key pair should be used for each third party"*, and *"at the end of contract lifecycle, all DKIM keys
  published by the enterprise must be deleted or modified to have a blank p= field… This prevents the
  third party from continuing to send DKIM validated email."*
  **⚑ A departing owner's ESP, agency or former marketing vendor with a live DKIM key can keep sending
  authenticated mail as the acquired company after close.**

### 4.2 DMARC policy values

From **RFC 9989 §4.7**, verbatim: `p=none` — *"The Domain Owner offers no expression of preference"*;
`p=quarantine` — *"considers such mail to be suspicious… the failure creates a significant concern"*;
`p=reject` — *"considers all such failures to be a clear indication that the use of the domain name is
not valid."* Plus `rua`/`ruf`, `sp`, `np` (non-existent subdomains), `adkim`/`aspf` alignment, `t` test
mode. **High.**

**The key scoring fact, with two national-authority quotes to deploy when a seller pushes back:**
- **NIST SP 800-177r1 §4.6.3:** *"In the early stages… the sending domain should set a DMARC policy of
  p=none, so the ultimate disposition of a message that fails some checks rests wholly on the receiver's
  local policy."*
- **UK NCSC:** *"A policy of 'none' means this DMARC record won't affect the delivery of your email, but
  it will provide you with reports."*
  [NCSC](https://www.ncsc.gov.uk/collection/email-security-and-anti-spoofing/implement-a-dmarc-policy-of-none). **High.**

**`p=none` is telemetry, not a control.**

### 4.3 Mailbox-provider mandates — the dated, citable part

**Google** ([sender guidelines](https://support.google.com/a/answer/81126),
[FAQ](https://support.google.com/a/answer/14229414)) — **all senders** from 1 Feb 2024: SPF **or** DKIM;
valid forward and reverse DNS; TLS; spam rate **below 0.30%** in Postmaster Tools; RFC 5322 formatting.
**Bulk senders** additionally: SPF **and** DKIM; a DMARC record (*"enforcement policy can be set to
none"*); **From-header alignment** with the SPF or DKIM domain; one-click unsubscribe on marketing mail
with a visible link.

- **Bulk sender definition, verbatim:** *"any email sender that sends close to 5,000 messages or more to
  personal Gmail accounts within a 24-hour period."* **⚑ And: *"Senders who meet the above criteria at
  least once are permanently considered bulk senders"* — *"Bulk sender status doesn't have an expiration
  date."*** A single 6,000-recipient announcement permanently classifies the domain. **High.**
- Spam rate: *"keep your user-reported spam rate below 0.1% and should prevent spam rates from ever
  reaching 0.3% or higher."* **High.**
- **Nov 2025 tightening, verbatim:** *"Starting November 2025, Gmail is ramping up its enforcement on
  non-compliant traffic. Messages that fail to meet the email sender requirements will experience
  disruptions, including temporary and permanent rejections."* **High.**
- Unsubscribe: Google says *"within 48 hours, a reasonable timeline"* — a **recommendation**.

**Yahoo** ([senders.yahooinc.com](https://senders.yahooinc.com/best-practices/)) — Feb 2024. All senders:
SPF **or** DKIM, spam rate below 0.3%, valid forward/reverse DNS, RFC 5321/5322. Bulk: SPF **and** DKIM;
*"Publish a valid DMARC policy with at least p=none - DMARC must pass"*; alignment; one-click
unsubscribe honoured **"within 2 days"** — a **requirement**.
⚠️ **Yahoo's page states no numeric bulk-sender threshold.** Do not attribute 5,000/day to Yahoo.

**Microsoft / Outlook** — high-volume = **5,000+/day** to outlook.com/hotmail.com/live.com; requires SPF,
DKIM, and a valid DMARC record (minimum `p=none`) with DMARC **passing** and aligned. **Junk-routing from
5 May 2025** (High); **rejection phase** with `550 5.7.515 Access denied…` reported from **November 2025**
(**Medium — verify the date before printing it**). ⚠️ Microsoft's announcement blog is JS-rendered and
would not yield body text to automated fetch across three attempts; substance corroborated from
Microsoft Learn/Q&A and four independent deliverability vendors. **For a billable report, open
[the techcommunity post](https://techcommunity.microsoft.com/blog/microsoftdefenderforoffice365blog/strengthening-email-ecosystem-outlook%E2%80%99s-new-requirements-for-high%E2%80%90volume-senders/4399730)
in a browser and screenshot it rather than citing a vendor summary.**

**Net effect:** the three largest consumer mailbox providers all now require a published DMARC record
with passing alignment for any domain that has **ever** sent 5,000 messages in a day, and all three now
**reject** rather than filter. A missing DMARC record on such a domain is a live, dated,
vendor-documented deliverability failure — which converts email-auth hygiene from a security nicety
into a **revenue-continuity** finding.

### 4.4 Why "no DMARC" is a transferable business risk

**The loss data — primary, figures read from the FBI's own PDF.**
[FBI IC3 2025 Internet Crime Report](https://www.ic3.gov/AnnualReport/Reports/2025_IC3Report.pdf):
- **BEC losses 2025: $3,046,598,558 across 24,768 complaints** — second-largest loss category by dollar.
  (2024: $2,770,151,146; 2023: $2,946,830,270.)
- **Average reported loss per BEC complaint: >$122,000** — which lands squarely inside a $200k–2M deal's
  working-capital assumptions.
- **86% of BEC losses moved via wire transfer / ACH** — fast and generally unrecoverable.
- Cumulative: [FBI IC3 PSA I-091124-PSA](https://www.ic3.gov/PSA/2024/PSA240911) —
  **$55,499,915,582 across 305,033 incidents, Oct 2013 – Dec 2023.** **High.**

**Spoofing a no-DMARC domain is trivial.** SPF authenticates the envelope sender; DKIM authenticates a
signing domain. **Neither constrains what the recipient sees in the visible `From:` header.** DMARC is
the only one that ties the visible From-domain to an authentication result *and* publishes an
instruction. With no record, every receiver falls back to local policy and the domain owner has
expressed no preference. **High.**

⚠️ **Honest finding: no authoritative source quantifies BEC risk during an M&A ownership transition.**
Searched specifically; the claim appears only in vendor and bank marketing content. What **does** exist
is the FBI's extensively documented **real-estate transaction** analogue — spoofed emails to a party in
a transaction instructing a change of payment destination
([PSA I-060923-PSA](https://www.ic3.gov/PSA/2023/psa230609), ~$446M in 2023;
[PSA180712](https://www.ic3.gov/PSA/2018/PSA180712) on title companies, law firms, agents, buyers and
sellers). **Cite the dollar figure and the real-estate pattern; label the M&A parallel as analyst
inference, not a statistic.**

**Remediation requires DNS control — which is itself the deeper finding.** Fixing this needs TXT records
at the apex, `_dmarc.`, and `<selector>._domainkey.`, which means the registrar account must transfer
(with recovery email/2FA not on the seller's personal address), authoritative DNS hosting must transfer
(often a *different* party), and third-party-held DKIM keys must be inventoried and revoked. **A missing
DMARC record is a symptom; the asset question is whether the buyer can control the domain's DNS on day
one.** A domain whose DNS is administered by a departing owner's cousin, or whose registrar account
recovers to a personal Gmail, is unremediable until that transfers — a legitimate Red on those grounds
alone.

### 4.5 Citable precedent that `p=none` is not adequate

**CISA BOD 18-01** (16 Oct 2017, active) —
[cisa.gov](https://www.cisa.gov/news-events/directives/bod-18-01-enhance-email-and-web-security).
**Within 90 days:** STARTTLS on all internet-facing mail servers, and valid SPF/DMARC with *"at minimum
a DMARC policy of 'p=none' and at least one address defined as a recipient of aggregate and/or failure
reports."* **Within one year:** *"setting a DMARC policy of 'reject' for all second-level domains and
mail-sending hosts."* **Within 120 days:** disable SSLv2, SSLv3, RC4, 3DES. **High.**

**⚑ This is the best precedent available**, because it does exactly what a Red/Yellow/Green rubric needs
to do: treats `p=none` **with reporting** as an acceptable *interim* state on a 90-day clock, and
`p=reject` as the required *end* state on a 365-day clock. That is a published, governmental, dated
basis for "`p=none` is Yellow, not Green" without inventing the standard. ⚠️ Be precise: BOD 18-01
encourages but does **not** mandate DKIM.

**NIST SP 800-177 Rev. 1, *Trustworthy Email*** (Feb 2019) —
[NIST](https://nvlpubs.nist.gov/nistpubs/SpecialPublications/NIST.SP.800-177r1.pdf). Numbered, quotable
recommendations 4-1 (SPF, including `-all` on non-sending domains), 4-3 (approved algorithms/lengths),
4-4 and 4-5 (per-MTA keys and key protection), 4-10 (unique key per third party, revoke at contract
end), 4-11 (publish DMARC). **High.**

**UK NCSC** — ⚠️ **Mail Check was RETIRED 31 March 2026**
([announcement, 6 Nov 2025](https://www.ncsc.gov.uk/blog-post/retiring-mail-check-web-check)). **Do not
cite it as a live tool.** The *guidance* collection remains live and citable — a staged `none` →
`quarantine` → `reject` plan, with *"Implementing a policy of p=reject will instruct recipients to
reject any of the email sample that doesn't pass DMARC checks."* ⚠️ NCSC's worked examples still use
`pct=`, removed by RFC 9989.

**internet.nl** ([test-mail](https://internet.nl/test-mail/)) — Dutch government / Internet Society;
scores an email domain as a **percentage against a published norm**. **Medium-High.** Worth citing as
precedent that a graded, government-backed email-auth rubric is a recognised form.

**Global Cyber Alliance** ([DMARC guide](https://dmarcguide.globalcyberalliance.org/)) — free,
18 languages. Useful as a *remediation* pointer and as evidence that fixing this is cheap. ⚠️ GCA's
$19M–$66M savings figure is **GCA's own modelled estimate** — attribute it explicitly or omit.

### 4.6 Verification procedure and the DKIM trap

```bash
dig +short TXT example.com | grep -i 'v=spf1'     # exactly ONE v=spf1 record
dig +short TXT _dmarc.example.com
dig +short TXT <selector>._domainkey.example.com  # requires knowing the selector
dig +short MX example.com
dig -x <sending-ip> +short                        # then forward-confirm
# Count include/a/mx/ptr/exists/redirect recursively against RFC 7208 §4.6.4's limit of 10
```

Measure DKIM key length from the retrieved record:
```bash
echo "<base64 from p=>" | base64 -d | openssl rsa -pubin -inform DER -noout -text | head -1
# => "Public-Key: (2048 bit)"   — compare against RFC 8301
```

**⚠️ The DKIM selector discovery problem — the biggest methodological trap in this check, and it is
already recognised in `spec.md` §4's DKIM note.** DKIM has no discovery mechanism: you must already
know the selector to query it.
1. **A failed guess proves nothing.** NXDOMAIN on `default._domainkey` does **not** establish DKIM is
   absent. Scoring a domain Red for "no DKIM" on guessed selectors is an indefensible finding and must
   never appear in a $2,500–4,500 report.
2. **The only reliable method is a real message.** Get a genuine message from the target domain, view
   raw source, read the `DKIM-Signature` header's **`s=`** (selector) and **`d=`** (signing domain).
3. **Check alignment on the same message,** and read the receiver's `Authentication-Results` header for
   its own `spf=` / `dkim=` / `dmarc=` verdicts. **This is the single highest-value artifact in the
   whole check** — a receiver-generated verdict on a real message beats any amount of DNS inspection.
4. Common selectors (`selector1`/`selector2`, `google`, `s1`/`s2`, `k1`, `default`, `dkim`) are a hint
   only, never proof of absence. **Medium.**

**⚑ Product implication: "send a test message from the business's primary sending system to an
auditor-controlled mailbox" should be a required evidence step, not optional.** Without it, DKIM cannot
be graded and neither can key length.

**Free checkers** — convenience/cross-check only; reproduce every finding with `dig` before it enters a
billable report, because vendor tools disagree on lookup counting, multiple-record handling and `pct=`
interpretation. [dmarcian](https://dmarcian.com/domain-checker/) (verified directly, **High**),
[MXToolbox](https://mxtoolbox.com/), [Red Sift Investigate](https://redsift.com/tools/investigate)
(notably tests against a real sent message — maps well onto the evidence step above),
[EasyDMARC](https://easydmarc.com/tools), [internet.nl](https://internet.nl/test-mail/).

### 4.7 Paste-ready rubric

> **Evidence required:** (1) `dig` output for apex TXT, `_dmarc.<domain>`, and
> `<selector>._domainkey.<domain>`; (2) one genuine message sent from the business's primary sending
> system, raw headers retained, showing `DKIM-Signature` (`d=`, `s=`) and `Authentication-Results`;
> (3) a list of **all** domains the business owns, each checked — not just the primary.
>
> **🟢 GREEN — all of:** exactly one `v=spf1` record at the apex, terminating in `-all` or `~all`,
> evaluating **within the 10-DNS-lookup limit** (no `permerror`), with no `+all` or `?all` anywhere in
> the record or its include chain. A DKIM signature **verified on a real message** (not inferred from a
> guessed selector), key **≥2048-bit RSA** (or ed25519), `rsa-sha256`, with `d=` **aligned** to the
> visible From-domain. A valid `_dmarc` record with **`p=quarantine` or `p=reject`**, a **monitored
> `rua=`**, and `pct=100` if `pct=` is present. `Authentication-Results` on the test message shows
> `dmarc=pass`. Non-sending and parked domains publish `v=spf1 -all` and `p=reject`. **DNS control
> transfers with the deal** — registrar and authoritative-DNS accounts are business-owned, on the asset
> schedule, and do not recover to a departing individual's personal email or phone.
>
> **🟡 YELLOW — any of:** DMARC exists but is not enforcing — `p=none`, or an enforcing policy neutered
> by `pct=` below 100, or `t=y`, or no `rua=` (a policy with no reporting cannot be safely advanced or
> verified). SPF present and terminal but fragile — `~all` where the sending estate is stable enough to
> justify `-all`, or a lookup count of 8–10 (one SaaS vendor away from `permerror`), or more than two
> void lookups. DKIM verified but **1024-bit** (meets RFC 8301's MUST, fails its SHOULD and NIST's
> recommendation), or no evidence of rotation in 24 months. Shared or vendor-held DKIM keys, or a former
> vendor's selector still live in DNS. Primary domain clean but owned parked/legacy domains unprotected.
> DNS controlled by a third party (agency, former IT contractor, departing owner) whose cooperation at
> close is unconfirmed but obtainable.
>
> **🔴 RED — any of:** **no DMARC record** for a domain used to send business email. **No SPF record**, or
> SPF ending in `+all` or `?all`, or SPF returning **`permerror`** for exceeding the 10-lookup limit, or
> multiple conflicting `v=spf1` records at the apex. **No DKIM signature on a real outbound message**, or
> a key **<1024 bits**, or `rsa-sha1` signing. **The domain has ever sent ≥5,000 messages/day to consumer
> mailboxes and lacks SPF + DKIM + a passing, aligned DMARC record** — a live, dated compliance failure
> against Google (Feb 2024, enforcement ramped Nov 2025), Yahoo (Feb 2024) and Microsoft (5 May 2025,
> rejections from late 2025); mail is being or will be **rejected**, not filtered, and Gmail bulk-sender
> status is permanent. **DNS control does not transfer**, or the registrar/DNS account recovers to an
> individual leaving at close, or the business cannot demonstrate it can publish a TXT record on
> request — nothing above is remediable until that is fixed, so it **caps the item at Red regardless of
> the DNS findings**.

> **Buyer-facing guidance text.** Email authentication (SPF, DKIM and DMARC) is a set of public DNS
> records telling the world's mail systems which servers may send email using this company's domain
> name, and what to do with messages that fail. Without an enforcing DMARC record, anyone can send email
> that appears — to a customer, a supplier, or a bookkeeper — to come from this business, and the
> receiving system has been given no instruction to stop it. That matters commercially because invoice
> and wire-redirection fraud runs on exactly this technique: the FBI's Internet Crime Complaint Center
> recorded **$3.05 billion in reported business email compromise losses in 2025 across 24,768 complaints
> — an average above $122,000 per incident — with 86% of those funds moving by wire transfer or ACH**,
> which is fast and rarely recovered. A single incident at that average is material against this deal's
> purchase price.
>
> There is a second, more immediate cost. Since February 2024 Google and Yahoo, and since May 2025
> Microsoft, have required these records from any domain sending bulk email to consumer inboxes, and
> during late 2025 all three moved from quietly filtering non-compliant mail to **rejecting it
> outright**. A gap here therefore threatens delivery of order confirmations, password resets,
> appointment reminders and invoices — revenue-critical mail, not just marketing.
>
> Remediation is inexpensive: these are DNS text records, and free implementation guides exist from the
> Global Cyber Alliance and the UK's National Cyber Security Centre. The real diligence question is not
> cost but **control** — fixing this requires authority over the domain's registrar and DNS hosting, so
> confirm those accounts are owned by the business, listed on the asset schedule, and do not recover to
> a departing owner's personal email or phone. A domain whose DNS the buyer cannot administer on day one
> is the finding behind the finding.
>
> Finally, the ownership transition itself is the wrong moment to be spoofable. The FBI's public
> advisories document the same attack pattern repeatedly in real-estate closings — a spoofed email to a
> party in the transaction instructing a change of payment account, timed to a large, one-off,
> time-pressured wire between counterparties who have not transacted before. An acquisition closing and
> its first weeks of vendor and payroll re-onboarding present structurally identical conditions.
> *(This parallel is our assessment based on the FBI's documented real-estate BEC pattern; we are not
> aware of published statistics measuring BEC rates specifically during business acquisitions.)*

---

## 5. TLS/SSL and domain expiry

Maps to `spec.md` §4 Tier A: "Domain/registrar ownership and expiration", "SSL/TLS certificate
validity, issuer, expiration", "HTTPS hygiene".

### 5.1 Certificate lifetime — the cap is 200 days, not 398 and not 47

**Verified against [CA/Browser Forum Baseline Requirements v2.3.0 (7 Sep 2026), §1.2.2](https://cabforum.org/working-groups/server/baseline-requirements/requirements/)
"Relevant Dates" table.** **High** (independently fetched twice from two renderings).

| Issued on/after | Max validity |
|---|---|
| 2020-09-01 | 398 days |
| **2026-03-15** | **200 days ← CURRENT** |
| 2027-03-15 | 100 days |
| 2029-03-15 | 47 days |

Ballot **SC-081v3** passed 11 Apr 2025 (25 CIs yes / 0 no; all 4 Certificate Consumers yes) —
[cabforum.org](https://cabforum.org/2025/04/11/ballot-sc081v3-introduce-schedule-of-reducing-validity-and-data-reuse-periods/). **High.**
DCV data reuse follows the same schedule (398 → 200 → 100 → **10** days at 2029-03-15); Subject Identity
Information reuse dropped 825 → 398 days at 2026-03-15.

⚠️ **Apple's support page 102028 still says 398 days and is stale.** Cite the BRs, not Apple.
⚠️ **An automated read of the cabforum page returned a wrong schedule on first attempt.** Anyone
re-verifying must demand the verbatim §1.2.2 rows.
⚠️ **Do not quote the SHOULD tier (199/99/46)** without checking §6.3.2 directly — **Medium**.

**Practical consequence for an audit run today:** a certificate issued on, say, 2026-03-10 could
legitimately carry a 398-day life and not expire until April 2027. **A long-dated certificate seen in
September 2026 is not evidence of misissuance. Don't flag it.**

Separate and slower: Let's Encrypt's own schedule — 45 days (tlsserver profile, opt-in) from 2026-05-13;
64 days (classic) from 2027-02-10; 45 days (classic) from 2028-02-16
([LE, 2 Dec 2025](https://letsencrypt.org/2025/12/02/from-90-to-45)). **Do not conflate** "the industry
goes to 47 days" (2029) with "Let's Encrypt goes to 45 days" (2028).

### 5.2 Days-to-expiry — there is no standard, and a fixed day count is the wrong shape

**State this explicitly: no standards body publishes a days-to-expiry risk threshold.** What exists is
one government recommendation, disagreeing vendor defaults, and a documented **industry move away from
fixed day counts**.

**The norm is now proportional:**
- Let's Encrypt: *"We recommend renewing 90 day certificates every 60 days and six day certificates
  every three days"*; primary guidance is renewal *"when they have a third of their total lifetime
  left"* ([FAQ](https://letsencrypt.org/docs/faq/),
  [integration guide](https://letsencrypt.org/docs/integration-guide/)). **High.**
- **Certbot changed its default:** *"As of Certbot 4.0.0, a certificate is considered ready for renewal
  when less than 1/3rd of its lifetime remains… **Prior to Certbot 4.0.0 the threshold was a fixed 30
  days.**"* ([EFF/Certbot docs](https://eff-certbot.readthedocs.io/en/stable/using.html), v4.0.0 released
  8 Apr 2025). **High.**
- **ARI = RFC 9773** (Proposed Standard, June 2025) returns a `suggestedWindow`; LE recommends polling
  twice a day. It *"removes the need for inflexible hard-coded expiry thresholds."* **High.**
- **Let's Encrypt now issues 6-day certificates** (opt-in). **⚑ This breaks naive thresholds outright: a
  6-day certificate with 2 days remaining is healthy and normal.** A tool flagging "<7 days = Red" would
  flag a correctly-operating modern deployment as critical.

**The only non-vendor published tier** — NIST SP 1800-16B §5.1.15: *"Notifications should be
automatically sent to certificate contacts <90, 60, and 30> days prior to expiration. If a certificate
is not successfully renewed and replaced <30> days prior to expiration, then escalation notifications
should be sent…"* And for certificates shorter than 60 days: renew before *"<80 percent> of the total
validity period has elapsed."* NIST explicitly brackets these as **suggestions**.
[NIST SP 1800-16](https://nvlpubs.nist.gov/nistpubs/SpecialPublications/NIST.SP.1800-16.pdf), final
16 Jun 2020. **High.**
⚠️ **Flag the tension:** NIST's fixed 30-day rule and the ACME ecosystem's 1/3-of-lifetime rule now
**disagree** for any certificate shorter than 90 days. Name the conflict rather than picking one
silently.

**Published vendor defaults do not agree** and trend shorter than the folk-wisdom 30/14/7:
DigiCert 90/60/30/7/3 · UptimeRobot 30/14/7/0 · Datadog 14/7 · Zabbix 7 · Nagios no default · Pingdom
*"by default, you will be notified on the day your certificate expires."*

> **Defensible phrasing:** *"30/14/7-day tiering is a widely used convention, not a standard. The nearest
> non-vendor published basis is NIST SP 1800-16B §5.1.15 (90/60/30 with escalation at 30, explicitly
> marked as suggestions). Published vendor defaults range from 90/60/30/7/3 to day-of-expiry."*
> **Not defensible:** *"Industry standard is to alert at 30, 14 and 7 days."*

**⚑ Material, dated, checkable finding: Let's Encrypt stopped sending expiry emails.** Announced
[22 Jan 2025](https://letsencrypt.org/2025/01/22/ending-expiration-emails/); *"This service ended on
**June 4, 2025**"* ([26 Jun 2025](https://letsencrypt.org/2025/06/26/expiration-notification-service-has-ended)).
**High. Any target whose only expiry safety net was Let's Encrypt's emails has had no safety net since
4 June 2025.** This is the strongest single TLS diligence question in the topic.

### 5.3 What else to check on a certificate

- **Hostname coverage — cite RFC 9525 (Nov 2023), which obsoletes RFC 6125.** §6.3: *"The wildcard
  character appears only as the complete content of the left-most label"*; *"a wildcard in a presented
  identifier can only match one label."* So `*.example.com` covers **neither** the apex **nor**
  `a.b.example.com`. **High.** Citing RFC 6125 in a 2026 deliverable is a small but real credibility
  cost.
- **TLS versions — RFC 8996 (BCP 195, Mar 2021):** *"TLS 1.0 MUST NOT be used… TLS 1.1 MUST NOT be
  used."* For the **TLS 1.2 minimum, cite RFC 9325 §3.1.1** (Nov 2022): *"Implementations MUST support
  TLS 1.2"*; TLS 1.3 SHOULD be supported and preferred. BCP 195 now also includes **RFC 9852 (Jul 2026)**
  — ⚠️ which applies to **new protocols**, not deployed web servers; do not overstate it. **High.**
- **PCI DSS (only where cardholder data is handled):** *"PCI DSS does not consider SSL or early TLS to
  be strong cryptography"* — [PCI SSC FAQ #1491](https://www.pcisecuritystandards.org/faqs/1491/), updated
  July 2026. **High.** Migration deadline **30 Jun 2018**. Current standard **v4.0.1 (11 Jun 2024)**; 51
  of 64 future-dated requirements effective **31 Mar 2025**.
  ⚠️ **Do not quote Requirement 4.2.1 or 4.2.1.1 verbatim yet** — every route to the standard PDF returns
  403 and the reported content came only from third-party blogs (**Low-Medium**). 4.2.1.1's
  certificate-inventory requirement is a near-perfect diligence hook, which is exactly why it must be
  quoted from the real document. **Highest-priority gap to close before this ships.**
- **HSTS — RFC 6797.** [hstspreload.org](https://hstspreload.org/) requires `max-age` ≥ `31536000`
  (1 year) with `includeSubDomains` and `preload`, plus HTTP→HTTPS redirect **on the same host**.
  Mozilla's deployment floor is six months; 2 years recommended. These are **not** in conflict — they
  answer different questions. ⚠️ **The OWASP warning is the deal-relevant one:** preloading *"can have
  PERMANENT CONSEQUENCES"* — a preloaded domain is a constraint that survives the transaction. MDN notes
  the preload list *"is not part of the official HSTS specification."*
- **Mixed content** — MDN: blockable content (`<script>`, stylesheets, `<iframe>`, `fetch`/XHR, web
  fonts) is blocked; upgradable content (images, audio, video) is auto-upgraded. *"Available across
  browsers since January 2020."* ⚠️ The commonly cited Chrome 79/80/81 rollout table is **not verified**
  — cite MDN's "since January 2020". **High / Low respectively.**
- **Chain problems** — NIST SP 1800-16B is the citation for why expired intermediates deserve their own
  check: such outages are *"often difficult to diagnose because the focus of investigation is typically
  on the server certificate, which is still valid and not the cause of the outage."*

### 5.4 Auto-renewing vs manual — what's cited and what's judgment

**Cited:**
- NIST SP 1800-16B §5.1.8: *"The broadening use of and reliance on TLS server certificates… is rendering
  **manual certificate management impractical**. Risks such as certificate-related outages are often the
  result of errors made while manually managing certificates."* *"Automation should be used wherever
  possible."*
- NIST §3.1, naming the cause verbatim: *"**The system administrator is reassigned, and nobody else
  receives expiry notifications.**"*
- NIST: certificate ownership should sit with **functional groups**, refreshed *"within <30> business
  days of a role reassignment or termination"* — not with individuals.
- Let's Encrypt: *"manually renewing certificates is not recommended, as it will need to be done more
  frequently with shorter certificate lifetimes"*; *"short-lived certificates practically require
  automation."*
- NIST §3.1: *"Nearly every enterprise has experienced an application outage due to an expired
  certificate."* Troubleshooting *"often requires hours."*

**⚠️ NOT published — say so plainly: the specific M&A-continuity argument (manual renewal depends on a
named individual and a payment method that both leave with the seller) is reasoned judgment, not a cited
norm.** The defensible construction is three explicit steps: (1) NIST names personnel change as a direct
cause of expired-certificate outages; (2) NIST recommends functional-group ownership refreshed within 30
business days; (3) *our inference* — an acquisition is a large, planned, simultaneous instance of exactly
that discontinuity, hitting the certificate owner, the billing relationship and the CA account credential
at once. **The payment-method half has no published support at all.**

⚠️ **Vendor survey, label it:** Keyfactor/Ponemon (Feb 2019) — *"74% of respondents agree that digital
certificates have caused unplanned downtime"*, costs *"more than $11.1M"*. 🚩 **Keyfactor sells
certificate lifecycle management**; the $11.1M is a modelled aggregate and the 74% is self-reported
agreement from a self-selected panel. **Colour only**, and a 2019 vendor survey is weak in 2026.

### 5.5 ICANN Transfer Policy — the critical item, verified against primary sources

**Answer: the 60-day Change-of-Registrant lock is REMOVED in the revised policy; the Board ADOPTED that
revision on 7 June 2026; it is NOT YET IN FORCE. Today, the 60-day CoR lock still applies.**

| Milestone | Date | Conf. |
|---|---|---|
| TPR Working Group Final Report → GNSO Council | 2025-02-05 | High |
| GNSO Council adopted all 47 recommendations | 2025-03-12 | High |
| Board public comment (11 submissions) | 2025-04-28 → 2025-06-16 | High |
| **ICANN Board ADOPTED — Resolution 2026.06.07.04** | **2026-06-07** | **High** |
| Implementation Review Team + separate CORD Policy | pending | High |
| **No effective date, no consensus-policy text published** | as of 2026-09-22 | **High** |

Board resolution, verbatim: *"Resolved (2026.06.07.04), the Board adopts the Recommendations, and
directs ICANN's President and CEO… to implement the Recommendations…"* and notes resources are required
*"including drafting policy with an Implementation Review Team as well as design and production of a
separate Change of Registrant Data (CORD) Policy."*
[Approved resolutions, 7 Jun 2026](https://www.icann.org/en/board-activities-and-meetings/materials/approved-resolutions-regular-meeting-of-the-icann-board-07-06-2026-en).

**What the revision will do (not yet in force):** the CoR lock is **removed entirely**, not made
opt-out ([OpenSRS/Tucows, 23 Jun 2026](https://opensrs.com/blog/icann86-policy-recap/) — a registrar
that sat in the working group: the CoR process *"has proven to be more of a burden than benefit"* and
*"will be removed under the updated policy"*). Replacement locks are **720 hours (30 days)** after
creation and after an inter-registrar transfer. Registrant-data changes move to a standalone CORD
Policy. The Registrar Stakeholder Group requested an **18-month buffer after the IRT concludes**.

**What is operative TODAY** — ICANN Transfer Policy, 21 Feb 2024 text (mandatory implementation by
**21 Aug 2025**). [Policy page](https://www.icann.org/en/contracted-parties/accredited-registrars/resources/domain-name-transfers/policy) ·
[full text PDF](https://itp.cdn.icann.org/en/files/consensus-policy/transfer-policy-redline-21feb24-en.pdf).
Quotes extracted from the PDF directly. **High throughout.**

- **§II.C.2:** *"The Registrar must impose a 60-day inter-registrar transfer lock following a Change of
  Registrant, provided, however, that the Registrar may allow the Registered Name Holder to opt out…
  prior to any Change of Registrant request."* Reinforced at **§I.A.3.8.5** as a **MUST DENY** ground.
- **§I.A.3.7.5 / §3.7.6** — two further 60-day windows a registrar *may* deny on: within 60 days of the
  **creation date**, and within 60 days of a **prior transfer**.
- **⚑ §II.C.1.3 — the single most operationally valuable clause, and it is ICANN's own advice:**
  *"Inform the Prior Registrant… that **if its final goal is to transfer the domain name to a different
  registrar, the Prior Registrant is advised to request the inter-registrar transfer BEFORE the Change
  of Registrant** to avoid triggering the 60-day lock…"*
  **Move the domain to the buyer's registrar first, then change registrant.** Doing it in the intuitive
  order (change owner at close, then move registrar) locks the domain at the seller's registrar for 60
  days with no remedy but to wait.
- **§I.A.3.8 — mandatory denials:** pending UDRP, court order, pending TDRP, URS proceeding/suspension,
  plus the CoR lock. **A domain under UDRP/URS cannot be transferred at closing at all.**
- **§I.A.3.9 — grounds that may NOT be used to deny**, including *"Domain name in Registrar Lock Status,
  unless the Registered Name Holder is provided with the reasonable opportunity and ability to unlock…"*
  and payment defaults between registrar and its business partners where the holder has paid. **This is
  the registrant's lever when a reseller obstructs a deal.**
- **§II.B.2.1** — a Change of Registrant **must be denied if the registration has expired** and the
  holder no longer has the right to renew or transfer. **This is the direct link between expiry and deal
  risk: an expired domain cannot be transferred to the buyer at all until renewed.**
- **§II.A.1.1** — a domain sale **is** a Change of Registrant (material change to registrant name,
  organization, email, or admin contact email), requiring confirmation from **both** New and Prior
  Registrant (or a Designated Agent, §II.A.1.2) via a secure mechanism.

Registrar practice confirms the lock is live:
[GoDaddy](https://www.godaddy.com/help/transfer-my-domain-away-from-godaddy-3560) documents all three
60-day windows with the opt-out offered at approval time. **High.**

⚠️ **Flag source disagreement:** several SEO blogs (namesilo.com, best-domain-registrars.com,
seo.domains) assert that "in 2026, transfers rely on standard 30-day change-of-registrant locks" and
that TAC is already the standard term. **These are wrong** — they describe the adopted-but-unimplemented
policy as if in force. Do not cite them.

⚠️ **"TAC" is not yet the operative term.** Binding policy says **"AuthInfo"** throughout (§§5.1–5.3).
"Transfer Authorization Code (TAC)" comes from the TPR Final Report, adopted 7 Jun 2026, not implemented.
Checklist copy should read: *"AuthInfo code (being renamed 'Transfer Authorization Code'/TAC under the
Transfer Policy revision adopted 7 June 2026, not yet in force — verify status at audit date)."*

### 5.6 Lifecycle, ERRP, and two corrections

Cleanest primary citation for durations is a registry agreement functional specification:
[.net Registry Agreement Appendix 7 §3](http://www.icann.org/resources/unthemed-pages/appendix7-94-2012-02-25-en). **High.**

| Period | Duration |
|---|---|
| Add / Renew / Transfer Grace | 5 calendar days each |
| **Auto-Renew Grace Period** | **45 calendar days** |
| **Redemption Grace Period** | **30 calendar days** |
| **Pending Delete** | **5 calendar days**, then purged |

⚠️ **ccTLD warning: the 30-day RGP is fixed only for gTLDs.** Namecheap documents .ES at 10 days, .PH
with no RGP at all, .CM deleted on the expiry date itself. **A checklist must not assume the gTLD
lifecycle applies to a ccTLD.** **High.**

**ERRP** — landing [2013](https://www.icann.org/resources/pages/errp-2013-02-28-en); **current text
revised 21 Feb 2024, compliance required 21 Aug 2025**
([link](https://www.icann.org/en/contracted-parties/consensus-policies/expired-registration-recovery-policy/expired-registration-recovery-policy-21-02-2024-en)).
Cite both dates; citing only "2013" cites a superseded document. **High.**
- **§2.1.1:** two pre-expiry notices — *"approximately one month prior"* and *"approximately one week
  prior."*
- **§2.1.2:** one further notice *"within five days after the expiration."*
- **§4.1 — the clause that replaces a fabricated fee number:** *"Registrars must make their renewal fees,
  post-expiration renewal fees (if different), and redemption/restore fees reasonably available…
  At a minimum, these fees must be clearly displayed on the registrar's website."*

⚠️ **CORRECTION — ERRP does NOT guarantee a ~45-day post-expiration renewal window.** §§2.2.2–2.2.3
guarantee only that the registrant can renew through the DNS-interruption period, *"at least the last
eight consecutive days"* before deletion. **The 45 days is the *registry* Auto-Renew Grace Period — a
registrar↔registry billing construct, not a registrant entitlement.** The ~30 days registrants typically
get is **registrar commercial practice**, which is registrar-specific and must be verified per-registrar.
**High. This is the single most valuable correction in the domain section.**

⚠️ **CORRECTION — there appears to be no ERRP obligation to notify before deletion.** ERRP mandates three
notices and no fourth. The nearest real obligation is in the Expired Domain Deletion Policy, requiring
*disclosure at registration* of the expected deletion timing, *"or a date range not to exceed ten (10)
days in length."* **Medium-High.**

**⚠️ Redemption/restore fees — what could NOT be verified.** Registrar fee pages are bot-blocked
(GoDaddy 403/Akamai; Namecheap, NameSilo, Network Solutions, Spaceship all 403/Cloudflare). **No dollar
figure's source text was ever seen.**
- "GoDaddy $80" / "Namecheap $88.88" appeared only in search-engine summaries of blocked pages —
  **Medium-Low, do not publish.**
- "Verisign wholesale restore fee ~$40" — SEO blogs only; Verisign's own post confirming the fee exists
  **states no amount**. **Do not publish a number.**
- **"ICANN caps restore fees at ~$80" is false.** No such cap exists in any primary source.

**The defensible method instead:** ERRP §4.1 requires every accredited registrar to publish its
redemption/restore fee. So the checklist item becomes: **identify the sponsoring registrar from RDAP,
retrieve that registrar's ERRP-mandated published fee page, record the figure and the retrieval date.**
Audit-grade, and cites ICANN policy rather than a guess. Safe to state qualitatively: the fee is charged
**in addition to** renewal and is **an order of magnitude above** a normal renewal.

### 5.7 EPP status codes and the auth code

Primary: [ICANN EPP status codes](https://www.icann.org/resources/pages/epp-status-codes-2014-06-16-en) ·
RFC 5731 · **RFC 3915** (RGP mapping). ⚠️ `https://www.icann.org/epp` **does not resolve** — use the full
URL. ⚠️ **Citation precision:** `addPeriod`, `autoRenewPeriod`, `renewPeriod`, `transferPeriod`,
`redemptionPeriod`, `pendingRestore` and `pendingDelete` are **RFC 3915** statuses, not RFC 5731. Citing
5731 for `redemptionPeriod` is a citation error.

ICANN, verbatim: *"Client status codes are set by registrars… **Server status codes are set by
registries, and they take precedence over client codes.**"* For server codes the registrar must *"work
with the Registry Operator"* and *"This process can take longer than it does for client codes."*
**No status code is removable by the registrant acting alone.** **High.**

| Code | Set by | Acquisition implication |
|---|---|---|
| `clientTransferProhibited` | Registrar | **Expected and good.** Must be removed before close; §5.2 gives 5 calendar days |
| `clientUpdateProhibited` / `clientDeleteProhibited` | Registrar | Good hygiene; SSAC recommends |
| `clientRenewProhibited` | Registrar | Investigate — unusual |
| `clientHold` | Registrar | **Red** — often a billing or abuse dispute |
| `serverTransferProhibited` | **Registry** | **Red for closing timeline** — registrar cannot clear it |
| `serverUpdate/Delete/RenewProhibited`, `serverHold` | **Registry** | **Red** — registry lock or registry blocking |
| `ok` | Registry | RFC 5731: *"MUST NOT be combined with any other status."* **`ok` on a business-critical domain means it is NOT locked — that is a finding, not a clean bill of health** |
| `inactive` | Registry | No nameservers — investigate |
| `autoRenewPeriod` | Registry | **The domain has already passed its expiry date** |
| `redemptionPeriod` / `pendingRestore` | Registry | **Red** — restore fee due; transfers prohibited |
| `pendingDelete` | Registry | **Critical** — 5 days then purged |
| `transferPeriod` | Registry | Recent transfer → 60-day lock may apply |

**Auth code.** [ICANN](https://www.icann.org/resources/pages/auth-2013-05-03-en) and, bindingly,
**Transfer Policy §5.2**: registrars must provide the AuthInfo code **and remove
`ClientTransferProhibited` within five (5) calendar days** of request where self-service generation is
not offered. §5.3: the mechanism may not be *"more restrictive than the mechanisms used for
[registration]."* §5: codes must be *"used solely to identify a Registered Name Holder"* and *"unique on
a per-domain basis."* **RFC 9154** (Dec 2021): authorization information *"SHOULD only be set when a
transfer is in process"*, ≥128 bits of entropy, stored hashed. **Treat the auth code as a short-lived
credential, not a permanent password.** **All High.**

**Registry lock** ([Verisign](https://www.verisign.com/resources/registrar-resources/registry-lock/)):
an authorised individual at the registrar must request the unlock and is then *"contacted by Verisign via
phone and required to provide an individual security phrase."* *"The word 'server' and 'prohibited' must
appear for all three statuses (Update, Delete, Transfer) for the domain name to be registry locked."*
**A registry-locked domain cannot be moved on a normal closing timeline without pre-arranged coordination
with both registrar and registry.** **High.** ICANN SSAC **SAC 044** corroborates and adds directly usable
guidance: *"The SSAC encourages registrants to make certain that `clientTransferProhibited` is set…
and… `clientUpdateProhibited`"*, and to *"incorporate routine checks of registry locks in WHOIS
monitoring activities."*

### 5.8 Acquisition mechanics, WHOIS → RDAP, verifying control

⚠️ **No citable transactional-law commentary on domain transfer at closing was found** — searches were
exhausted, INTA/Escrow.com fetches 404'd. **Say "reasoned from ICANN policy", don't imply legal
commentary backs it.** The ICANN sources make the structural point without needing one:

**Handing over registrar account credentials changes nothing in the registry record.** The seller
remains the Registered Name Holder, retains the policy-recognised ability to initiate a Change of
Registrant, and a buyer who later loses contact with the seller may be **unable to complete a compliant
registrant change at all**. (The further point that the account also carries the seller's other domains,
payment instruments and email is reasoned judgment.)

**WHOIS → RDAP:** *"As of 28 January 2025, the Registration Data Access Protocol (RDAP) will be the
definitive source for delivering generic top-level domain name (gTLD) registration information in place
of sunsetted WHOIS services."*
[ICANN, 27 Jan 2025](https://www.icann.org/en/announcements/details/icann-update-launching-rdap-sunsetting-whois-27-01-2025-en). **High.**
⚠️ **Correction:** registries and registrars *"are no longer required to provide WHOIS services (**except
for .com, .name, and .post**)."* **`.net` is NOT on that list**, contrary to common belief. **High.**
**Sunset removed the obligation, not the service** — many registries still answer port 43 voluntarily, so
**an auditor must not treat "WHOIS still answers" as evidence the data is authoritative.** Lookup tool:
[lookup.icann.org](https://lookup.icann.org/en).

**Redaction — why RDAP alone cannot verify control.** The **Registration Data Policy** took effect
**21 Aug 2025** (published 21 Feb 2024), replacing the Interim Policy and the 2018 GDPR-era Temporary
Specification — which is why ERRP, the Transfer Policy and related policies all carry the
21 Feb 2024 / 21 Aug 2025 dates. Registrant Country must be published; Organization only with consent;
name, email, postal code and street may be redacted, with a published contact email or web form that
*"MUST NOT identify the contact email address or the contact itself."*
⚠️ The precise MUST/MAY structure is **Low** confidence (one automated rendering appeared to invert the
observed default). **The operational fact is High: registrant name and email are typically NOT visible in
public gTLD RDAP output, so identity must be established from the registrar account and internal records,
not from RDAP.** That is exactly why a domain-ownership checklist item cannot be satisfied by a lookup.
**RDRS was extended, not sunset** — Board resolution 30 Oct 2025 continues it up to two more years
(~Dec 2027). **High.**

**How a consultant actually verifies control** (method, not citation):
1. RDAP at lookup.icann.org — capture sponsoring registrar, **creation date, last-transfer date**, expiry
   date, full EPP status set, nameservers.
2. Observed screen-share of the registrar account showing the domain, the registrant contact record, and
   auto-renew + payment-method settings.
3. Have the seller demonstrate they can **retrieve the AuthInfo code and toggle
   `clientTransferProhibited`** — this proves *operational* control, not just credential possession
   (anchored on §5.2's five-day obligation).
4. Confirm the registrant email is a **role address on a domain the buyer will own**.
5. A DNS TXT record placed at the consultant's direction is an independent control proof.

### 5.9 Domain expiry threshold — no standard exists; here is the defensible basis

**Searched and not found:** no CIS Critical Security Control or Safeguard addresses domain registration
expiry (CIS's DNS safeguards cover filtering and query logging). No NIST CSF / SP 800-53 / SP 800-171
control surfaced. Commercial M&A and IT-DD checklists say to schedule domains and document "renewal
status" — **none states a threshold.** **Medium-High** (absence from search, not an exhaustive read).

**Anyone quoting "flag domains expiring within N days" as an industry standard is quoting something that
does not exist.**

**Five bases that DO exist:**
1. **ERRP's reminder schedule** — a regulatory floor at ~30 days. Defensible as "aligned with the
   earliest notice ICANN requires", but it is a *notice* trigger, not a risk trigger, and far too short
   for a deal.
2. **ICANN SSAC SAC 010 (June 2006), Rec. 3** — the closest thing to a published number:
   *"Choose registrars who send multiple renewal notices by email (**e.g., 90, 60, and 30 days prior to
   expiration**)…"* And **Rec. 7, directly on point for transactions:** *"**Begin any research on domain
   name valuation and complete domain name transactions well before your name is due for renewal.**…
   After the expiry date, the only option available to registrants is to either renew the name at the
   same registrar they used, or allow it to expire."*
   ⚠️ **Caveat honestly:** SAC 010 is advisory guidance to *registrants about choosing a registrar*, not
   a DD standard, and it **predates ERRP by seven years**.
3. **The redemption cliff, with SSAC's own arithmetic** — SAC 010 Finding 2: policies *"may protect
   registrants for up to seventy five (75) days… (For example, **a registrar can delete a name
   immediately upon expiration if they choose**…)"* **The safety net is discretionary, not guaranteed.**
4. **⚑ The 60-day lock arithmetic — the most rigorous basis, because it is a binding quantified ICANN
   rule colliding with closing timelines.** Two concrete, non-speculative schedule risks: a domain
   expiring inside the deal window **cannot be transferred at all** (§II.B.2.1); and a Change of
   Registrant, creation, or prior transfer in the 60 days before close **locks transfers past close**.
5. **SAC 044's control framing** — the better shape for an audit item: the finding is a *process
   control*, not a threshold. It also flags a second-order risk worth its own checklist line:
   non-renewal of a domain hosting **someone else's nameservers** — *"a new registrant of domain B may
   configure domain A's DNS information for malicious purposes, including phishing attacks, email
   interception, and redirection."*

> **The methodologically honest formulation:** the auditable finding is not "expires in under N days." It
> is **the absence of a named owner, a funded renewal mechanism, and registrar-level locks**, plus **the
> transfer-lock and expiry-vs-close-date arithmetic**, which is objective and citable. A day-count
> threshold is CloseCheck's editorial layer on top and must be labelled as such.

**CloseCheck's recommended threshold, presented as a methodology choice:** flag any domain whose expiry
falls **within the expected close date + 90 days**, derived from (i) SAC 010's 90/60/30 cadence, (ii) the
60-day transfer-lock windows plus a 30-day execution buffer, and (iii) §II.B.2.1's absolute bar on
transferring an expired registration. **Say exactly that in the report. Do not say "industry standard."**

### 5.10 Paste-ready guidance text — TLS certificate posture

> **What this item assesses.** Whether the business's HTTPS will keep working after close without
> depending on a person or a payment method that leaves with the seller. Certificate lifetimes are
> shortening on a ratified schedule — the maximum is **200 days** as of 15 March 2026, dropping to **100
> days** on 15 March 2027 and **47 days** on 15 March 2029 (CA/Browser Forum Baseline Requirements
> v2.3.0 §1.2.2; Ballot SC-081v3, passed 11 April 2025). A site that survives on manual annual renewals
> today will need renewing four to eight times a year within the buyer's first ownership cycle.
>
> **On thresholds.** There is no authoritative published standard for a "days to expiry" risk threshold,
> and we do not invent one. The renewal norm published by the CA ecosystem is **proportional, not a fixed
> day count**: Let's Encrypt recommends renewing when **one third of the lifetime remains**, and Certbot
> changed its default to the same rule in v4.0.0 (April 2025), having previously used a fixed 30 days.
> The only non-vendor published tier is NIST SP 1800-16B §5.1.15 (notify at 90/60/30, escalate at 30) —
> explicitly marked by NIST as a suggestion, and predating short-lived certificates. Published
> monitoring-vendor defaults do not agree with each other: DigiCert 90/60/30/7/3, UptimeRobot 30/14/7/0,
> Datadog 14/7, Zabbix 7, Pingdom day-of-expiry.
>
> **🔴 RED.** Certificate **expired**, or the hostname does not match (commonly: covers
> `www.example.com` but not the apex, or vice versa — and a wildcard `*.example.com` covers **neither**
> the apex nor multi-level subdomains, per RFC 9525 §6.3, which obsoletes RFC 6125). Certificate
> **self-signed**, chain broken or untrusted, or an **intermediate CA certificate expired** (especially
> serious because the server certificate still looks valid, which is why these outages take hours to
> diagnose). Certificate **expires before the expected close date**, or before close + 30 days, with no
> automated renewal. The site **does not redirect HTTP to HTTPS**, or serves any login, checkout or
> customer-data form over plain HTTP. Server offers **only TLS 1.0 and/or 1.1** (RFC 8996: *"TLS 1.0 MUST
> NOT be used… TLS 1.1 MUST NOT be used"*; RFC 9325 §3.1.1 requires TLS 1.2 support). Where cardholder
> data is handled, SSL or early TLS is in use for any transmission of account data — PCI SSC has required
> migration since 30 June 2018 and *"does not consider SSL or early TLS to be strong cryptography"*
> (FAQ #1491, updated July 2026). **Renewal is manual and the only person who knows how to do it is the
> seller or a departing employee**, with no documented procedure, no shared CA-account credentials and no
> alternate contact. *(Note in the report: NIST documents the personnel-continuity risk — "The system
> administrator is reassigned, and nobody else receives expiry notifications" (SP 1800-16B §3.1) — but
> the specific acquisition framing is our reasoned judgment, not a published norm.)*
>
> **🟡 YELLOW.** Certificate valid but **less than one third of its lifetime remains** with no evidence
> of automated renewal (for a 200-day certificate that is ~67 days; for a 90-day Let's Encrypt
> certificate, 30 days; for a 6-day certificate, 2 days). Certificate **manually purchased** rather than
> issued via ACME or a platform-managed service, even where a procedure exists — this is the item most
> likely to break in the buyer's first year, because the renewal invoice goes to the seller's payment
> method. **No expiry monitoring of any kind** — specifically flag reliance on Let's Encrypt's own expiry
> emails, which **ended 4 June 2025**; a target "relying on the emails" has been unmonitored for over a
> year. **No HSTS header** (preload eligibility requires `max-age` ≥ 31536000 with `includeSubDomains`
> and `preload`; Mozilla's deployment floor is six months) — and note separately if the domain is
> **already preloaded**, since OWASP warns preloading *"can have PERMANENT CONSEQUENCES"* and it is a
> constraint the buyer inherits. **Mixed content** on customer-facing pages (blockable resources —
> scripts, stylesheets, iframes, fetch/XHR, web fonts — are blocked outright, meaning broken
> functionality the buyer inherits). TLS 1.0/1.1 still enabled alongside 1.2/1.3 by choice. Certificate
> covers apex and www but not other customer-facing hostnames in use. Certificate or DNS managed by a
> **third-party agency** whose engagement is not part of the transaction.
>
> **🟢 GREEN.** Issued and renewed **automatically** via ACME or a platform-managed service, driven by
> ARI (RFC 9773) or a proportional rule rather than a hardcoded date. Covers apex, www and every
> customer-facing hostname, chain complete including intermediates. **TLS 1.2 minimum**, TLS 1.3 offered
> and preferred. **HTTP→HTTPS redirect on the same host**, plus HSTS with `max-age` ≥ 31536000. No mixed
> content on customer-facing pages. **Renewal does not depend on any single named individual**, nor on a
> payment method or CA account that leaves with the seller; certificate ownership sits with a functional
> group. Independent expiry monitoring alerts to an address the buyer will control.

### 5.11 Paste-ready guidance text — domain registration posture

> **What this item assesses.** Whether the buyer will actually own and control the domain after close,
> and whether it can be moved on the deal's timetable. This is a **schedule** risk as much as a security
> one: ICANN's Transfer Policy imposes **three separate 60-day transfer locks**, and an expired
> registration **cannot be transferred to a buyer at all** until renewed (§II.B.2.1).
>
> **⚠️ Policy status as at the date of this report — verify at audit date.** The ICANN Board **adopted**
> the revised Transfer Policy (all 47 Transfer Policy Review recommendations) by **Resolution
> 2026.06.07.04 on 7 June 2026**. That revision **removes the Change-of-Registrant 60-day lock entirely**,
> replaces the registration and transfer locks with 720-hour (30-day) locks, and splits registrant-data
> changes into a separate Change of Registrant Data (CORD) Policy. **It is not yet in force** — ICANN must
> still convene an Implementation Review Team and publish consensus-policy text, and registrars requested
> an 18-month buffer after that. **No effective date has been announced. The 60-day Change-of-Registrant
> lock applies today**, confirmed in live registrar documentation. Re-verify before every engagement.
>
> **On thresholds.** There is no published standard — in ICANN policy, CIS Controls, NIST, or any M&A
> due-diligence framework — for how far before expiry a domain becomes a risk flag. We use **expiry
> within the expected close date + 90 days**, derived from ICANN SSAC SAC 010 Rec. 3 (90/60/30
> renewal-notice cadence), the three 60-day transfer-lock windows plus execution time, and Transfer
> Policy §II.B.2.1's absolute bar on transferring an expired registration. This is our methodology
> choice, stated as such — not an industry standard.
>
> **🔴 RED.** Domain **expired**, or RDAP shows `autoRenewPeriod`, `redemptionPeriod`, `pendingRestore`
> or `pendingDelete` — an expired registration cannot be transferred, and `redemptionPeriod` prohibits
> transfers outright and carries a restore fee an order of magnitude above a renewal. **Registrant of
> record is not the selling entity** — an owner's personal name, a former employee, a web developer,
> agency or reseller; because a sale is legally a Change of Registrant requiring the *Prior Registrant's*
> confirmation through a secure mechanism, a wrong registrant means the buyer may be unable to complete a
> compliant transfer if that party becomes unreachable. **A Change of Registrant occurred within the last
> 60 days** without an opt-out (a mandatory denial ground). Domain **created or transferred within the
> last 60 days** and close falls inside that window. **`serverTransferProhibited`,
> `serverUpdateProhibited`, `serverHold`, `serverRenewProhibited`, or `clientHold`** with no documented
> unlock path — registry locks require out-of-band phone-plus-passphrase authentication between registrar
> and registry, and the registrar cannot clear them. Domain subject to a **UDRP or URS proceeding, TDRP
> dispute, or court order** — the registrar **must deny** any transfer. The seller proposes **handing over
> registrar account credentials instead of a compliant transfer** — credentials change nothing in the
> registry record. **The registrant contact email is a personal address the seller retains after close** —
> every transfer confirmation routes through it. **Nobody can produce the AuthInfo code** or demonstrate
> unlocking; registrars must supply it and remove `clientTransferProhibited` within **five calendar days**
> of a request, so an inability to do so signals the seller does not actually control the account.
>
> **🟡 YELLOW.** Expiry falls **within expected close + 90 days** (remedy is cheap: multi-year renewal as
> a closing condition). **Auto-renew on, but the payment method is an individual's personal card.**
> `clientTransferProhibited` set (correct and expected) but the **unlock path not demonstrated**.
> Registrant organisation correct but the **contact email is an individual's** rather than a role address.
> Domain at a **reseller or hosting company** rather than a direct registrar account, adding a party to
> the chain — note that a reseller may **not** deny a transfer over its own payment dispute with the
> registrar where the registrant has paid. **RDAP output redacted** and the seller has not yet shown
> corroborating registrar-account access (registrant name and email are routinely redacted under the
> Registration Data Policy effective 21 Aug 2025, so RDAP alone cannot establish control). Domain is a
> **ccTLD with a non-standard lifecycle** — the 30-day Redemption Grace Period is fixed only for gTLDs.
> **The business's nameservers or email depend on a second domain not included in the transaction** —
> non-renewal lets a new registrant redirect DNS and intercept mail. **`ok` is the only status on a
> business-critical domain**, meaning no transfer, update or delete protections are set at all; RFC 5731
> specifies `ok` *"MUST NOT be combined with any other status"*, so its presence is positive proof the
> domain is unlocked.
>
> **🟢 GREEN.** **Registrant of record is the selling entity**, matching the purchase agreement. Expiry is
> **more than 90 days beyond expected close**, or multi-year renewal is a closing condition. **Auto-renew
> enabled against a company payment method**, with reminders going to a role address the buyer will
> control. **`clientTransferProhibited`, `clientUpdateProhibited` and `clientDeleteProhibited` all set**,
> with a demonstrated ability to remove them. **No server-side locks**, or a registry lock with a
> documented, pre-arranged unlock procedure agreed ahead of the closing date. **No Change of Registrant,
> creation, or inter-registrar transfer within the last 60 days**, verified from RDAP's creation and
> last-transfer dates. The seller has **demonstrated retrieval of the AuthInfo code** during diligence.
> **Transfer sequencing agreed in writing before close**, following ICANN's own advice in Transfer Policy
> §II.C.1.3: **transfer to the buyer's registrar FIRST, then change the registrant** — or obtain the
> seller's explicit opt-out from the 60-day lock before the Change of Registrant is submitted. Doing it in
> the intuitive order locks the domain at the seller's registrar for 60 days with no remedy. The
> **redemption/restore fee published by the sponsoring registrar** has been retrieved and recorded (ERRP
> §4.1 requires every registrar to publish it), so the cost of a missed renewal is a known figure rather
> than an estimate.

---

## 6. The "no authoritative source exists" register

**This section is the most important one for anyone writing checklist copy.** Each entry is a place
where an invented-sounding number would have been easy to write and indefensible to publish. The
recommended treatment is given for each.

### 6.1 Numbers that do not exist as published standards

| Claim someone will want to make | Status | Use instead |
|---|---|---|
| "Typical reserve is X% for Y days" | **No authoritative source.** Vendor consensus 5–15% / 90–180 days, Medium at best | The reserve clause in the target's own agreement; OCC Handbook for mechanism and triggers |
| "Processors issue a letter of good standing" | **Not a defined instrument.** No authoritative source | Seller-authorised written inquiry to the acquirer + purchase-agreement representation |
| "Industry standard is to alert at 30/14/7 days before cert expiry" | **No standards body publishes this.** Vendor defaults range 90/60/30/7/3 to day-of-expiry | Proportional rule (1/3 of lifetime, per Let's Encrypt and Certbot 4.0.0) + NIST SP 1800-16B §5.1.15's bracketed 90/60/30 |
| "Flag domains expiring within N days" | **No CIS, NIST, ICANN or M&A framework states a threshold** | CloseCheck's own stated choice (close + 90 days), with the SAC 010 / 60-day-lock / §II.B.2.1 derivation shown |
| "ICANN caps restore fees at ~$80" | **False.** No such cap in any primary source | ERRP §4.1 per-target retrieval of the registrar's published fee |
| "GoDaddy charges $80 / Namecheap $88.88 to redeem" | Registrar fee pages are bot-blocked; no source text was ever seen | Same — retrieve per-target, record the date |
| "M&A guidance says to verify data transferability" | **IBBA resource centre does not address it.** Broker/marketplace blogs are marketing content | The inverse claim: published broker/QoE checklists largely do **not** cover software data portability, which is why buyers discover it at closing. **Flag as an assumption in `idea.md`, not as sourced** |
| "BEC spikes during M&A integration" | **No FBI/CISA/NIST/peer-reviewed source.** Vendor and bank marketing only | FBI IC3's 2025 BEC dollar figure + the documented **real-estate transaction** analogue, with the M&A parallel labelled analyst inference |
| "Square caps transaction CSV export at one year" | **Not in any Square help article.** Could not verify | The limits that ARE documented: Clover 1yr/pull, Toast 6mo/pull, Shopify 60-day API default |
| "The Excessive Fraud Merchant threshold is 1.5%" | **Wrong.** Every document-level source says 50 bps | 50 bps / USD 50,000 / <10% 3DS |

### 6.2 Sources that are blocked, stale, or must be re-verified before shipping

| Item | Problem | Priority |
|---|---|---|
| **PCI DSS v4.0.1 §4.2.1 / §4.2.1.1 verbatim** | Every automated route to the PDF returns 403; content sourced only to third-party blogs. 4.2.1.1's certificate-inventory requirement is the most checklist-relevant PCI hook | **Highest** |
| **Mastercard SPME manual (4 Aug 2026)** | HTTP 403 / Akamai. All MC thresholds rest on acquirer restatements; the J.P. Morgan guide is **Rev. 12/2019** | High — disclose the vintage |
| **Microsoft high-volume-sender blog** | JS-rendered, would not yield body text across three attempts. **Rejection-phase date (Nov 2025) is Medium** | High — open in a browser and screenshot before printing a date |
| **Registrar redemption fee pages** | GoDaddy/Namecheap/NameSilo/Network Solutions/Spaceship all 403 | Medium — use the ERRP §4.1 method instead |
| **Booksy Biz Terms of Service** | Client-side injected; served HTML is *"Loading Terms of service..."*. The **consumer** ToS "You may not assign your Account" clause does **not** govern service providers | Medium |
| **Booksy partner API docs** | HTTP 401. Do not repeat third-party endpoint inventories as fact | Medium |
| **eCFR 37 CFR Part 11** | Blocked automated fetch; Cornell LII used | Low — verify before publishing |
| **CA/B BR §3.2.2.6 (wildcards) and §6.3.2 (SHOULD tier)** | Not independently quoted | Medium |
| **Keyfactor/Ponemon outage survey** | 2019, vendor-funded; a 62% (2025) figure surfaced unverified | Low — colour only |
| **ICANN Transfer Policy implementation status** | Fastest-moving fact in the checklist — between 7 Jun 2026 adoption and IRT completion | **Re-verify at every audit date** |
| **Clover appointments / ownership transfer negatives** | Rest on the **logged-out** help tree, a subset of the logged-in one | Medium — documented-absence, not proof |
| **ABI / Axial / Big-4 QoE data-transferability guidance** | Search budget exhausted before these queries ran | Open |

### 6.3 Sources that disagree with each other

1. **NIST SP 1800-16B's fixed 30-day cert renewal rule vs the ACME ecosystem's 1/3-of-lifetime rule** —
   they conflict for any certificate shorter than 90 days. Name the conflict.
2. **Apple support page 102028 (398 days) vs CA/B BR v2.3.0 (200 days)** — Apple is stale.
3. **M3AAWG 2019 (1024-bit "current recommended") vs RFC 8301 / NIST (2048)** — M3AAWG is stale.
4. **Mozilla's 6-month HSTS floor vs hstspreload.org's 1-year requirement** — **not** actually in
   conflict; they answer different questions. Don't flag a 6-month `max-age` on a site not seeking
   preload.
5. **Google's "48 hours, a reasonable timeline" (recommendation) vs Yahoo's "within 2 days"
   (requirement)** — don't present "2 days" as one uniform mandate.
6. **USPTO's state-links page (D.C. has no trademark law) vs USPTO's clearance page (index covers D.C.)**
   — unresolved; note it rather than picking a side.
7. **Booksy's own article (client list is a support ticket, upd. 3 Sep 2026) vs Goldie's migration page
   (a "Customers → Export to CSV" button exists, 2 Sep 2025)** — Jane App agrees with Booksy. **Resolve
   on-screen during diligence.**
8. **cside.com (VAMP count floor "moved from 1,000 to 1,500 in April 2026") vs Visa's own fact sheet
   (≥1,500 effective 1 June 2025)** — prefer Visa.
9. **Square community moderators contradict each other on appointment export** — the help article
   (export exists at Appointments > Settings > History) supersedes; the real distinction is History
   export (exists) vs Reports export (does not).

---

## 7. Implications for `spec.md` and the templates

Not decisions — inputs for `spec-writing` and `audit-methodology` to act on.

1. **Tier A email-auth item needs a required evidence step.** DKIM cannot be graded, and key length
   cannot be measured, without a real message from the target's primary sending system. `spec.md` §4's
   DKIM note already gets the selector problem right; the gap is that the *scoring* side needs the test
   message as a first-class evidence artifact, not an optional note. Also: the item should run against
   **every domain the business owns**, not just the primary — parked and legacy domains are the
   unprotected spoofing surface, and NIST Rec. 4-1 is the citation.
2. **Tier A domain item needs three RDAP fields the current spec implies but doesn't name:** creation
   date and last-transfer date (not just expiry), and the full EPP status set. All three 60-day lock
   windows are invisible without them.
3. **The ICANN Transfer Policy status is a dated, re-verify-at-audit-time fact.** It is the fastest-moving
   item across all five topics. Worth a product mechanism — a dated "policy status" note attached to the
   checklist item, surfaced to the consultant at audit time — rather than static template copy.
4. **Tier B payment-processor item should split into four sub-findings**, because they have different
   evidence and different severity: network monitoring-program standing; reserve/hold status;
   **MATCH/VMSS listing (the Red-rating candidate, and it attaches to the principal personally)**; and
   processing continuity at close (a new MID with re-underwriting, which is a closing dependency and a
   working-capital item, not an IT item).
5. **Tier C data-export item is understated at one line.** The research supports a structured procedure
   with an eight-step evidence trail and, critically, a **contactable-count vs row-count** distinction
   that is a valuation input. It also crosses into Tier B (the platform's own terms) and into closing
   mechanics (dated pre-close seller obligations, files in escrow).
6. **Template-specific findings that should drive §5 template content:**
   - **Restaurant (MVP template):** Toast's 60-day post-closure window with no bulk export is the single
     highest-severity platform finding in this research, and Toast Capital blocks ownership transfer.
     Both belong in the restaurant template explicitly.
   - **Salon/service with booking:** appointment-history export fails on **three of four** booking
     platforms (Vagaro, Booksy, Clover). Booksy additionally has no documented ownership-transfer path
     at all and its reviews are licensed to Booksy. The `spec.md` §5 line "Booking software client-data
     export format" is correct but far too mild for what the evidence shows.
   - **General e-commerce:** Shopify's 60-day API order default without `read_all_orders` is the
     silent-truncation trap; Shopify Capital/Credit blocks store transfer.
7. **A "seller cannot or will not represent X" pattern recurs across topics** and is consistently a
   stronger signal than the underlying data — MATCH status, DNS control, AuthInfo retrieval, Booksy
   transferability. Worth considering as a first-class severity input in the roll-up rather than a
   free-text note.
8. **`spec.md` §8 (security/trust) has no new obligations from this research**, but per `CLAUDE.md`'s
   cross-document rule, the Tier A/B/C guidance changes here are §4/§5 changes and therefore imply a
   **`releases.md` §3 "new template version" release event** and a `domain-code-review` versioning check.

---

## Sources

**Payments:** [Visa VAMP fact sheet](https://corporate.visa.com/content/dam/VCOM/corporate/visa-perspectives/security-and-trust/documents/visa-acquirer-monitoring-program-fact-sheet-2025.pdf) ·
[Visa Core Rules 18 Apr 2026](https://usa.visa.com/dam/VCOM/download/about-visa/visa-rules-public.pdf) ·
[Visa: Introducing VAMP](https://corporate.visa.com/en/sites/visa-perspectives/security-trust/introducing-visa-acquirer-monitoring-program.html) ·
[Visa: Evolving VAMP](https://corporate.visa.com/en/sites/visa-perspectives/security-trust/visa-vamp-program-update-fraud-disputes.html) ·
[J.P. Morgan MC ECP Guide](https://www.jpmorgan.com/content/dam/jpm/merchant-services/payment-network-updates/documents/mastercard-excessive-chargeback-program-guide.pdf) ·
[Braintree ECP](https://developer.paypal.com/braintree/articles/risk-and-security/card-brand-monitoring-programs/mastercard-programs/excessive-chargeback-program) ·
[Braintree EFM](https://developer.paypal.com/braintree/articles/risk-and-security/card-brand-monitoring-programs/mastercard-programs/excessive-fraud-merchant-program) ·
[Checkout.com scheme monitoring](https://www.checkout.com/docs/business-operations/manage-disputes/scheme-monitoring-programs) ·
[Stripe: Terminated merchant files](https://docs.stripe.com/disputes/match) ·
[OCC Merchant Processing Handbook](https://www.occ.treas.gov/publications-and-resources/publications/comptrollers-handbook/files/merchant-processing/pub-ch-merchant-processing.pdf) ·
[Commerce Bank MPA v10.15.2024](https://www.commercebank.com/merchantagreement)

**Trademark:** [USPTO Trademark Search](https://tmsearch.uspto.gov/) ·
[TESS retirement](https://www.uspto.gov/subscription-center/2023/retiring-tess-what-know-about-new-trademark-search-system) ·
[Federal trademark searching](https://www.uspto.gov/trademarks/search/federal-trademark-searching) ·
[Comprehensive clearance search](https://www.uspto.gov/trademarks/search/comprehensive-clearance-search-similar-trademarks) ·
[Why search](https://www.uspto.gov/trademarks/basics/why-search-similar-trademarks) ·
[Hiring an attorney](https://www.uspto.gov/trademarks/basics/why-hire-private-trademark-attorney) ·
[Non-attorneys precluded](https://www.uspto.gov/trademarks/protect/non-attorneys-precluded-representing-applicants-and-registrants) ·
[TSDR](https://tsdr.uspto.gov/) · [ID Manual](https://idm-tmng.uspto.gov/) ·
[Assignment Center](https://assignmentcenter.uspto.gov/search/trademark) ·
[State links](https://www.uspto.gov/trademarks/basics/state-trademark-information-links) ·
[Nice current edition](https://www.uspto.gov/trademarks/trademark-updates-and-announcements/nice-agreement-current-edition-version-general-remarks) ·
[TMEP §1207.01](https://tmep.uspto.gov/RDMS/TMEP/print?version=current&href=TMEP-1200d1e5044.html) ·
[TMEP §1207.01(d)](https://tmep.uspto.gov/RDMS/TMEP/print?version=current&href=TMEP-1200d1e6073.html) ·
[37 CFR §11.5](https://www.law.cornell.edu/cfr/text/37/11.5) ·
[37 CFR §11.14](https://www.law.cornell.edu/cfr/text/37/11.14) ·
[15 U.S.C. §1115](https://www.law.cornell.edu/uscode/text/15/1115) ·
[WIPO Nice](https://www.wipo.int/en/web/classification-nice)

**Data export:** [GDPR CELEX 32016R0679](https://eur-lex.europa.eu/legal-content/EN/TXT/?uri=CELEX%3A32016R0679) ·
[WP242 rev.01](https://ec.europa.eu/newsroom/dae/redirection/document/44099) ·
[ICO data portability](https://ico.org.uk/for-organisations/uk-gdpr-guidance-and-resources/individual-rights/individual-rights/right-to-data-portability/) ·
[Cal. Civ. Code §1798.130](https://leginfo.legislature.ca.gov/faces/codes_displaySection.xhtml?lawCode=CIV&sectionNum=1798.130) ·
[§1798.140](https://leginfo.legislature.ca.gov/faces/codes_displaySection.xhtml?lawCode=CIV&sectionNum=1798.140) ·
[CPPA regs](https://cppa.ca.gov/meetings/materials/20230203_item4_text.pdf) ·
[FTC Toysmart](https://www.ftc.gov/news-events/news/press-releases/2000/07/ftc-announces-settlement-bankrupt-website-toysmartcom-regarding-alleged-privacy-policy-violations) ·
Square [7675](https://squareup.com/help/us/en/article/7675-transfer-ownership-of-your-square-account) /
[3819](https://squareup.com/help/us/en/article/3819-deactivate-your-account) /
[6750](https://squareup.com/help/us/en/article/6750-square-profile) /
[5351](https://squareup.com/help/us/en/article/5351-manage-your-square-appointments-account-settings) ·
Toast [data backup](https://support.toasttab.com/en/article/Can-I-download-a-back-up-of-all-of-my-Toast-data) /
[Guestbook](https://support.toasttab.com/en/article/Access-Your-Guest-Data-with-the-Guest-Report) /
[ownership transfer](https://support.toasttab.com/en/article/How-do-I-transfer-ownership-of-my-Toast-account) /
[field reference](https://doc.toasttab.com/doc/platformguide/adminDataExportFieldReference.html) ·
Clover [historical reports](https://www.clover.com/en-US/help/run-historical-reports-with-date-range-filters) /
[export sales reports](https://www.clover.com/en-US/help/export-sales-reports) /
[export customer list](https://www.clover.com/en-US/help/export-customer-list) /
[get all payments](https://docs.clover.com/dev/docs/get-all-payments.md) ·
Booksy [client list](https://support.booksy.com/hc/en-us/articles/16539806017938-How-do-I-obtain-a-copy-of-my-Client-List-from-Booksy) /
[ToS](https://booksy.com/en-us/p/terms) ·
Vagaro [customer list](https://support.vagaro.com/hc/en-us/articles/115004772554-Run-the-Customer-List-Report) /
[change owner](https://support.vagaro.com/hc/en-us/articles/204347570-Change-Owner-or-Transfer-Business) /
[Data Lake](https://support.vagaro.com/hc/en-us/articles/14981322178843-Data-Lake-Integration)

**Email auth:** [RFC 7208](https://www.rfc-editor.org/info/rfc7208) · [RFC 6376](https://www.rfc-editor.org/info/rfc6376) ·
[RFC 8301](https://www.rfc-editor.org/info/rfc8301) · [RFC 8058](https://www.rfc-editor.org/info/rfc8058) ·
[RFC 9989](https://www.rfc-editor.org/rfc/rfc9989.html) · [RFC 9990](https://www.rfc-editor.org/info/rfc9990) ·
[RFC 9991](https://www.rfc-editor.org/info/rfc9991) ·
[Google sender guidelines](https://support.google.com/a/answer/81126) ·
[Google FAQ](https://support.google.com/a/answer/14229414) ·
[Yahoo best practices](https://senders.yahooinc.com/best-practices/) ·
[Microsoft high-volume senders](https://techcommunity.microsoft.com/blog/microsoftdefenderforoffice365blog/strengthening-email-ecosystem-outlook%E2%80%99s-new-requirements-for-high%E2%80%90volume-senders/4399730) ·
[FBI IC3 2025 report](https://www.ic3.gov/AnnualReport/Reports/2025_IC3Report.pdf) ·
[IC3 PSA I-091124](https://www.ic3.gov/PSA/2024/PSA240911) · [IC3 PSA I-060923](https://www.ic3.gov/PSA/2023/psa230609) ·
[CISA BOD 18-01](https://www.cisa.gov/news-events/directives/bod-18-01-enhance-email-and-web-security) ·
[NIST SP 800-177r1](https://nvlpubs.nist.gov/nistpubs/SpecialPublications/NIST.SP.800-177r1.pdf) ·
[NCSC anti-spoofing](https://www.ncsc.gov.uk/collection/email-security-and-anti-spoofing) ·
[NCSC retiring Mail Check](https://www.ncsc.gov.uk/blog-post/retiring-mail-check-web-check) ·
[M3AAWG DKIM rotation](https://www.m3aawg.org/DKIMKeyRotation) ·
[M3AAWG Sender BCP v4.0](https://www.m3aawg.org/sites/default/files/doc_files/m3aawg-sender-best-common-practices-aug-27-2026.pdf) ·
[dmarc.org](https://dmarc.org/overview/) · [internet.nl](https://internet.nl/test-mail/)

**TLS & domains:** [CA/B Baseline Requirements](https://cabforum.org/working-groups/server/baseline-requirements/requirements/) ·
[Ballot SC-081v3](https://cabforum.org/2025/04/11/ballot-sc081v3-introduce-schedule-of-reducing-validity-and-data-reuse-periods/) ·
[NIST SP 1800-16](https://nvlpubs.nist.gov/nistpubs/SpecialPublications/NIST.SP.1800-16.pdf) ·
[Let's Encrypt FAQ](https://letsencrypt.org/docs/faq/) ·
[LE integration guide](https://letsencrypt.org/docs/integration-guide/) ·
[LE 90→45](https://letsencrypt.org/2025/12/02/from-90-to-45) ·
[LE expiry emails ended](https://letsencrypt.org/2025/06/26/expiration-notification-service-has-ended) ·
[Certbot docs](https://eff-certbot.readthedocs.io/en/stable/using.html) ·
[RFC 9773 (ARI)](https://datatracker.ietf.org/doc/rfc9773/) · [RFC 9525](https://datatracker.ietf.org/doc/rfc9525/) ·
[RFC 8996](https://datatracker.ietf.org/doc/rfc8996/) · [RFC 9325](https://www.rfc-editor.org/rfc/rfc9325.html) ·
[BCP 195](https://www.rfc-editor.org/info/bcp195) · [RFC 6797](https://datatracker.ietf.org/doc/rfc6797/) ·
[hstspreload.org](https://hstspreload.org/) · [PCI SSC FAQ 1491](https://www.pcisecuritystandards.org/faqs/1491/) ·
[ICANN Transfer Policy](https://www.icann.org/en/contracted-parties/accredited-registrars/resources/domain-name-transfers/policy) ·
[Transfer Policy full text](https://itp.cdn.icann.org/en/files/consensus-policy/transfer-policy-redline-21feb24-en.pdf) ·
[Board resolutions 7 Jun 2026](https://www.icann.org/en/board-activities-and-meetings/materials/approved-resolutions-regular-meeting-of-the-icann-board-07-06-2026-en) ·
[GNSO Transfer Policy Review](https://gnso.icann.org/en/group-activities/active/transfer-policy-review) ·
[OpenSRS ICANN86 recap](https://opensrs.com/blog/icann86-policy-recap/) ·
[ERRP (current)](https://www.icann.org/en/contracted-parties/consensus-policies/expired-registration-recovery-policy/expired-registration-recovery-policy-21-02-2024-en) ·
[EPP status codes](https://www.icann.org/resources/pages/epp-status-codes-2014-06-16-en) ·
[ICANN auth codes](https://www.icann.org/resources/pages/auth-2013-05-03-en) ·
[RDAP sunsets WHOIS](https://www.icann.org/en/announcements/details/icann-update-launching-rdap-sunsetting-whois-27-01-2025-en) ·
[Registration Data Policy](https://www.icann.org/en/contracted-parties/consensus-policies/registration-data-policy) ·
[Verisign Registry Lock](https://www.verisign.com/resources/registrar-resources/registry-lock/) ·
[SSAC SAC 010](https://itp.cdn.icann.org/en/files/security-and-stability-advisory-committee-ssac-reports/renewal-advisory-29jun06-en.pdf) ·
[SSAC SAC 044](https://itp.cdn.icann.org/en/files/security-and-stability-advisory-committee-ssac-reports/sac-044-en.pdf)
