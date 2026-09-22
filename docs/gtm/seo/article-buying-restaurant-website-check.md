# Article 2 — Long-tail: restaurant vertical

**Target keyword:** buying a restaurant website online ordering check (cluster: "due diligence buying a restaurant", "restaurant online ordering due diligence", "buying a restaurant what to check")

**Title tag:** Buying a Restaurant? Check the Website, Online Ordering, and Delivery Accounts First

**Meta description:** Before you buy a restaurant, verify who owns the domain, whether the online-ordering account transfers, and what the POS contract really says. A practical guide to the tech side of restaurant due diligence.

---

# Buying a Restaurant? Check the Website, Online Ordering, and Delivery Accounts First

Restaurant due diligence usually means the books: sales records, food costs, the lease, payroll. All necessary. But a meaningful and growing share of a restaurant's revenue now flows through technology the standard diligence process never touches — the website, the online-ordering system, the third-party delivery accounts, the point of sale, the Google listing. These are revenue-carrying assets, most of them are just *accounts*, and accounts have owners. In more deals than you'd expect, that owner isn't the person selling you the restaurant.

Here's what to check, roughly in the order a deal lets you check it.

## Start with the questions that don't need the seller's permission

You can answer all of these from public records before you've written an offer.

### Who actually owns the domain name?

Look up the domain in public registration data (RDAP — the modern replacement for WHOIS). You want the registrar, the expiration date, and, where visible, the registrant.

The classic restaurant version of this problem: the website was built years ago by a freelance web designer or a small agency, who registered the domain under their own account and has been invoicing the restaurant ever since — or has quietly stopped responding altogether. The seller "has a website" the way you "have" an apartment you rent. If the registrar account isn't the seller's to hand over, the domain isn't part of the assets you're buying until someone makes it so, and you want that resolved as a closing condition, not discovered when the site goes down eleven months in because a renewal notice went to a dead inbox.

### What is the website, and is it maintained?

Identify the platform from the outside — WordPress, Squarespace, a POS vendor's bundled site, something custom. Check that HTTPS works properly and the certificate is current. If it's WordPress, outdated versions and abandoned plugins are usually detectable and tell you what kind of shape the whole stack is in. None of this is expensive to fix; all of it is worth knowing before you price the deal.

### Who controls the Google Business Profile?

For a restaurant, the Google listing is arguably worth more than the website: it's where the reviews live, where the phone number and hours surface, where "order online" buttons point. Check whether the profile is claimed and try to establish who administers it. Review history does not transfer to a new listing — if the profile is controlled by a former manager or an old marketing company, recovering it through Google's process is slow and far from guaranteed, and starting over means starting over on years of reviews.

### The email setup

Public DNS shows who hosts the restaurant's email and whether the domain has basic anti-spoofing protection (SPF and DMARC records). More importantly for a deal: if the "business email" is actually the seller's personal Gmail, then every platform account below — ordering, delivery, POS, Google — probably resets its password to an inbox that leaves with the seller.

## Then get the contracts and read four clauses

Once diligence formally starts, request the actual agreements. For a restaurant, four documents do most of the work.

### The POS agreement

Remaining term, auto-renewal mechanics, cancellation window, early-termination fee, and whether the hardware is owned or leased. Restaurant POS contracts are notorious for multi-year auto-renewals with termination penalties calculated on the full remaining term. If your operating plan says "switch to a modern POS in month two," the contract may say that costs thousands of dollars — better to know while it's still the seller's problem to negotiate.

Also check what's bundled: many restaurant POS contracts tie in payment processing, the website, gift cards, and online ordering. Terminating one strand can unravel the rest.

### The online-ordering platform agreement

If the restaurant does meaningful direct online ordering, find the transferability clause in the platform agreement. Sometimes the account transfers cleanly with the business. Sometimes the terms are written around the individual account holder and the honest answer is "unclear" — which, for an account carrying a real fraction of weekly revenue, is a finding that belongs in your negotiation, priced, in writing.

### The delivery platform accounts

DoorDash, Uber Eats, Grubhub and similar accounts come with order history, ratings, and marketplace placement — and their transfer processes are platform-specific, change over time, and generally assume the *platform's* consent, not just the seller's. Verify the current process for each platform the restaurant depends on, and get the transfer initiated as part of closing rather than after it. A re-created delivery account starts from zero: zero ratings, zero history, and whatever placement the algorithm gives a brand-new restaurant. Also confirm who receives the payouts today — delivery deposits routed to the seller's personal bank account are a closing-checklist item all by themselves.

### The menu-sync and integration layer

Ask how the menu actually gets onto each platform. Is the POS integrated with online ordering and delivery (prices update once, everywhere), or does someone hand-edit four dashboards? Hand-managed menus are a hidden labor cost and an error source; a working integration is worth confirming *keeps working* when the accounts change hands.

## Before closing: log in, export, and change the contacts

Contracts describe intentions. Near closing, verify reality:

- **Watch the seller log in** to the website admin, registrar, POS back office, online-ordering dashboard, each delivery platform, and the Google Business Profile — or test handed-over credentials yourself, system by system, as a closing checklist.
- **Export the data**: sales history from the POS, the customer list from the ordering platform. Confirm exports actually work while the seller is still motivated to help.
- **Change the recovery email and phone** on every account to the buyer's. This is the single most commonly skipped step, and it means every future password reset for the business routes to the seller indefinitely.

## The pattern behind all of this

Every item above is the same question wearing different clothes: **is this asset actually the seller's to sell, and does it survive the transfer?** For a restaurant, the honest answers are discoverable — some from public records in minutes, some from four contracts, some only with logins near closing. The failure mode isn't that these checks are hard; it's that nobody's diligence checklist includes them until something breaks post-closing.

If you have a QoE provider or diligence consultant on the deal, ask them to cover this layer explicitly — it's structured evidence-gathering, the thing they already do, pointed at different assets.

---

*CloseCheck is the tool consultants use to run this exact audit: the public-record checks run automatically, contract findings are captured as structured data, and the output is a client-ready, consultant-branded report. The external checks are free to run on any deal — [run a free scan] on a restaurant you're evaluating and see its public technology footprint in minutes.*
