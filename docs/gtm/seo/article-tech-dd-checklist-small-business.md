# Article 1 — Cornerstone

**Target keyword:** technology due diligence checklist small business (long-tail cluster: "tech checklist buying a small business", "technology due diligence for buying a business")

**Title tag:** Technology Due Diligence Checklist for Buying a Small Business (Restaurants, Salons, Franchises, E-commerce)

**Meta description:** A practical technology due diligence checklist for sub-$2M business acquisitions. What you can check from public records today, what documents to demand from the seller, and what to verify with live access before closing.

**Positioning note (internal, don't publish):** every page ranking for the head term assumes the target has an engineering org and a CTO. This piece deliberately does not. It is written for buyers and advisors of main-street businesses and structured so the abbreviated checklist near the top is snippet-eligible.

---

# Technology Due Diligence Checklist for Buying a Small Business

Most due diligence checklists for "technology" assume you're buying a software company: code reviews, engineering org charts, technical debt assessments. If you're buying a restaurant, a salon, a franchise location, or a small e-commerce store, that advice is useless — and the checklists written for $50M software deals will have you asking a pizzeria owner about their CI/CD pipeline.

But small businesses run on technology too, and it fails in different ways. The website, the domain name, the point-of-sale system, the online-ordering account, the booking software, the Google Business Profile — these are revenue-carrying assets, and in a surprising number of deals, **nobody checks whether the seller actually owns or can transfer them until after closing.**

This checklist covers what to verify, in the order you're actually able to verify it during a deal.

## The short version

If you only do ten things, do these:

1. Look up who legally owns the domain name (registrant, not "the guy who pays for it")
2. Check the domain's expiration date and where it's registered
3. Confirm the SSL certificate is valid and who issued it
4. Identify what the website runs on and whether it's badly outdated
5. Find out who has admin access to the Google Business Profile
6. Get the POS system contract and read the termination and renewal clauses
7. Get the online-ordering or booking platform agreement and find the transferability clause
8. Ask for payment processor statements and check for holds, reserves, or chargeback problems
9. Build a list of every software subscription the business pays for, and mark each one: transfers, or must be rebuilt
10. Before closing, log in to everything — or watch the seller do it — and confirm the credentials work and the data can be exported

The rest of this article walks through each layer in detail: what you can check **today from public records**, what you'll need the **seller to hand over**, and what requires **live access** near closing.

## Layer 1: What you can check right now, without asking anyone

Everything in this section is visible from public records. You can — and should — run these checks before you've made an offer, because the results tell you how much friction to expect later, and occasionally they kill a deal outright.

### Domain ownership and expiration

The domain name is often the single most valuable technology asset in the deal, and the single most commonly mishandled one. Public registration data (via RDAP, which replaced the old WHOIS system) shows the registrar, the registration and expiration dates, and — where privacy services don't mask it — the registrant.

What you're looking for: **is the registrant the business, the owner personally, or somebody else entirely?** A pattern that shows up constantly in small-business deals: the domain was registered years ago by a web designer, a marketing agency, a former partner, or an ex-employee, under *their* account. The business has been paying invoices, but has no legal control over its own web address. If the seller can't produce registrar account access, the domain isn't theirs to sell — and getting a domain back from an unresponsive third party ranges from awkward to impossible.

Also check the expiration date. A domain expiring two months after your planned closing, registered under an email account the seller no longer checks, is a small time bomb.

### DNS and hosting

Public DNS records show which provider actually serves the website and email. This matters for one reason: **you need to know how many separate accounts must transfer at closing.** Domain at one registrar, DNS at a second provider, hosting at a third, email at a fourth — each is a separate handover with a separate login.

### SSL certificate

A valid HTTPS certificate is table stakes. Check that it exists, hasn't expired, and note the issuer. An expired or misconfigured certificate isn't usually a deal issue by itself — it's a signal about how the rest of the stack is maintained.

### What the website runs on

Identifying the CMS or site platform (WordPress, Squarespace, Wix, Shopify, a custom build) is usually possible from the outside, and version information often is too. A WordPress installation several major versions behind, with visibly outdated plugins, tells you two things: budget for remediation, and expect that nobody technical has been minding the store.

### Email authentication and email hosting

Public DNS also reveals the business's email setup: MX records show who hosts the mail (Google Workspace, Microsoft 365, the web host's bundled mail), and SPF/DMARC records show whether the domain is protected against spoofing. Weak email authentication is fixable — but if the business's email lives in the seller's personal account, that's another transfer to negotiate explicitly.

### Google Business Profile

For a local business, the Google Business Profile is a revenue asset — it's the map listing, the reviews, the phone calls. Two questions: **is it claimed, and who administers it?** An unclaimed profile is an easy fix. A profile claimed by a former manager, an old marketing agency, or the seller's personal Google account that isn't part of the deal is a genuine problem, because Google's recovery process for contested listings is slow and uncertain, and the review history doesn't move.

### Social accounts

List the business's active social accounts and, as far as public information allows, work out who actually administers them. The follower count isn't the point — the admin access is.

### Trademark conflicts

Run the business name and domain through a trademark search. You're not filing anything; you're checking whether the name you're about to buy the goodwill of is quietly infringing someone's mark.

## Layer 2: Documents to demand from the seller

Once you're under LOI (or earlier, with a cooperative broker), the document requests begin. For a main-street business the technology documents that matter are contracts — and the goal isn't to *collect* them, it's to extract three or four specific answers from each.

### The POS contract

Point-of-sale systems are the classic trap. Get the agreement and answer, in writing: What's the remaining term? Does it auto-renew — and how far before renewal must you cancel? What's the early-termination penalty? Is the hardware owned or leased? Small-business POS contracts frequently auto-renew for multi-year terms with termination fees that assume the full remaining term — a real cost if your plan was to switch systems after closing.

### Online-ordering, delivery, and booking platform agreements

For a restaurant: the online-ordering platform and the third-party delivery accounts (DoorDash, Uber Eats, and similar). For a salon or service business: the booking platform. For each, the question that matters most is **transferability** — and the honest answer is often "unclear," because platform terms are frequently written around the account holder, not the business. An online-ordering account that generates a third of revenue and *cannot be transferred*, only re-created from zero — losing ratings, order history, and platform placement — is a finding that belongs in the deal price, not a post-closing surprise.

### Payment processor standing

Ask for recent processor statements. You're checking for held funds, rolling reserves, and chargeback rates — and, again, whether the merchant account itself transfers or whether you'll be underwritten from scratch (usually the latter; plan for it).

### The full software subscription inventory

Have the seller list every recurring software the business pays for — POS, scheduling, accounting, loyalty, marketing, website, everything — with its cost. Then mark each line: transfers to the buyer, or must be rebuilt. The monthly total is a real operating cost that belongs in your model, and the "must be rebuilt" column is your first ninety days.

## Layer 3: What only live access can prove

Contracts say what should be true. Late in diligence — often at or just before closing — verify what *is* true.

- **Log in to everything.** The website admin, the hosting account, the domain registrar, the POS back office, the booking platform, the Google Business Profile, the social accounts. Either the seller demonstrates each login in front of you, or credentials are handed over and tested as part of the closing checklist. "I'll get you the password after closing" is where technology assets go to die.
- **Test data export.** Can the customer list, sales history, and booking records actually be exported? A platform that holds your data hostage is a finding worth knowing about while you still have leverage.
- **Confirm account contact details** are being changed to the buyer's — otherwise every reset email for every system goes to the seller forever.

## Who should run this checklist

Buyers can run Layer 1 themselves — that's the point of it being public. But most sub-$2M acquisitions already have a QoE (Quality of Earnings) provider or a diligence consultant on the buy side, and the technology layer fits naturally into that engagement: it's evidence collection, structured findings, and a report — the same discipline as financial diligence, applied to different assets.

If you're a buyer, ask whoever is doing your financial diligence whether their scope covers any of the above. If you're the consultant, this checklist is a service line your clients assume they're getting.

---

*CloseCheck is audit software for exactly this: consultants run the public-record checks automatically, capture contract findings in a structured format, and deliver a client-ready technology diligence report under their own brand. The external checks (Layer 1) can be run on any deal, free, before an engagement is even signed — [run a free external scan] to see what a deal's public technology footprint looks like.*
