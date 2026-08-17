# Nexus AI Help — data freshness, live checks, and safety

*DRAFT · Track B pressure-test artifact · 2026-08-17. Written under the
surface-contract rule: user vocabulary only. Every place the rule could not
be kept — because the PRODUCT currently says something else — is a numbered
finding at the end, not a workaround in the text. These articles document
behavior that is SHIPPED today.*

---

## Why do answers show how old the data is?

When you ask Nexus AI about your sites — "which sites have WooCommerce?",
"which sites are outdated?" — the answer usually comes from information the
app gathered earlier: the last time it synced with WP Engine, the last time a
site reported a change, the last time it scanned. That's fast, and usually
right — but a plugin could have been updated an hour ago.

So instead of presenting stored information as if it were live, answers tell
you where each fact came from and when it was last true:

> alpineoutfitte · v10.9.4 · active · **2h ago**

If a fact is old enough that it might no longer be true, it's marked:

> goldenecomm · v10.9.1 · active · 1d ago **⚠ may be out of date**

Different kinds of facts age at different speeds — a plugin version is
considered current for hours, a site's WordPress version for about a day —
so the warning appears when *that kind* of fact has been unverified for too
long, not on a fixed timer.

**You don't need to do anything about these markers.** They exist so that
when you're about to act — update a plugin, push a change — you know whether
you're acting on this morning's reality or last week's.

## What is a live check?

When an answer includes facts that may be out of date, Nexus AI will offer
one:

> The WP Engine data here is about 9 hours old. I can run a live check
> before you act.

A live check connects to the actual site right now, reads its real current
state, compares it with what was stored, tells you what (if anything)
changed, and updates the stored information so the next answer is fresh. Ask
for it in plain words — "check that live," "verify alpineoutfitte" — or say
yes when it's offered.

A live check is read-only. It never changes anything on your site.

## Why did the answer mention sites I didn't ask about?

Sometimes an answer ends with a note like:

> Note: 2 other environments also had this plugin the last time they were
> checked, but they didn't appear in today's results.

That's the app being honest about a disagreement between two of its own
information sources rather than silently picking one. It usually means one
source is fresher than the other — a site was removed, renamed, or simply
hasn't been re-scanned. If the note matters for what you're doing, a live
check on the named site settles it.

## What does "diverged for" mean in change reports?

When you ask what changed across your sites, some rows show how long the old
value had been in place before the change was seen:

> woocommerce · 9.5 → 9.9 · held for 11 days

This tells you whether a change was routine drift (a version that sat for
months, then updated) or churn (a value that changed twice in a day). It is
the time between the app's own observations — a change that happened while
the app wasn't looking is dated from when it was noticed.

## What are pairing suggestions?

If you have local copies of sites and WP Engine installs that look like they
belong together but aren't linked, Nexus AI can point that out:

> "alpine-outfitters" (local) looks like it matches "alpineoutfitte"
> (WP Engine, production). To link them: …

These are suggestions only. **Nexus AI never links sites on its own** —
linking changes how tools interpret "this site," so it's always your click.
Suggestions appear only for sites that aren't already linked, and each one
shows the exact linking step.

## Which actions are protected, and how do I change that?

Some operations can affect a live site, so they're gated:

- **Writes to production are off by default.** Pushing to a production
  environment, running write commands on it, deleting — all blocked until
  you explicitly allow them. When something is blocked you'll be told it's
  a Nexus AI setting (not a WP Engine error) and exactly where to change
  it: **Preferences → Nexus AI → WP Engine → Access & Permissions**.
- **Per-site exceptions.** Rather than enabling production writes
  everywhere, you can allow them for one specific install. If you've set an
  exception, actions on that install proceed — and the assistant will say
  the exception is why.
- **A verified backup comes first.** Before any push that overwrites a
  WP Engine environment, Nexus AI creates a backup of the *destination* and
  waits until it's confirmed complete. This is not skippable — not by the
  assistant, and not by asking it nicely. If the backup fails, the push
  doesn't happen.
- **Risky actions ask first.** Anything destructive shows you what it's
  about to do and waits for your approval.

## What information does Nexus AI keep, and where?

Everything described above runs on your machine. The record of observations
— which plugin versions were seen where and when, what changed, what the
assistant was told and allowed — is stored locally alongside the app's other
data. It is not sent anywhere. It exists so answers can be honest about
their sources, and so you can always ask "how do you know that?" and get a
real answer: what was observed, when, and by what means.

---
---

## PRESSURE-TEST FINDINGS (not part of the user docs)

Where writing these articles in user vocabulary was impossible or strained —
each is a product finding, most with a one-line fix:

1. **The freshness summary line leaks internals verbatim.** Shipped output:
   *"Freshness: 0 of 62 ledger-observed facts within SLO — 62 stale;
   consider a live re-check before acting on those."* Three jargon terms in
   one sentence (ledger-observed, SLO, and arguably "facts"). The article
   above had to describe what the line *means* instead of quoting it.
   Fix: *"Freshness: 62 of 62 items haven't been verified recently —
   consider a live check before acting on them."* One string per tool;
   candidate for a small copy-sweep packet, governed by the controlled
   vocabulary.
2. **`detect_drift` prints "Changes Recorded by the Ledger [origin:
   ledger]".** "Ledger" is our word, not the user's. Fix: "Changes Nexus AI
   observed directly [source: observed]" — same information, no new noun.
3. **The trust label renders raw:** "(observed)", "(derived)", "indexed
   2026-08-15" mix three vocabularies in one column. Livable, but the
   article couldn't explain the difference without inventing a taxonomy the
   user never needed. Fix: collapse to "checked <time>" vs "estimated" in
   user-facing columns; keep the precise classes in logs/manifests.
4. **"⚠ stale" is fine; "provisional" (aggregate reports) is not** — it
   reads as legalese. The article said "may be out of date"; output should
   too.
5. **There is no way to point a user at "what does Nexus AI know about this
   site right now?"** The article on stored information has no "see it
   yourself" step — the underlying answer exists (per-site facts + ages)
   but no user-facing surface exposes it. This is exactly the "where am I?"
   status from the surface contract — evidence it should be scheduled, not
   just designed (WP-17 renders health for the *pipeline*; this is its
   sibling for a *site*).
6. **Pairing suggestions are invisible unless asked for by tool name.**
   Nothing proactively surfaces them. Docs can only say "Nexus AI can point
   that out" — truthful, but the honest phrasing exposed that discovery is
   pull-only today. A design question for the surface review, not a defect.
7. **What could NOT be written at all: nothing.** Every shipped behavior was
   explainable in the five-phrase register plus ordinary words. The strain
   was consistently in quoting shipped output strings — i.e., the model
   passed the test; some copy didn't. That is the cheapest possible class
   of finding.
