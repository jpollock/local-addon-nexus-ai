# Nexus AI Help — your copy and the live site

*DRAFT · Track B pressure-test artifact №2 · 2026-08-17. WORKING-BACKWARDS
DOCS: these articles describe behavior that does NOT exist yet — they are
written first, so the vocabulary is fixed before WP-14/15/17 freeze names
into schemas and tool output. The controlled vocabulary at the end is the
Wave-2 gate deliverable: packet naming must conform to it. Findings follow.*

---

## Your copy and the live site

Every site you work on in Local is a **copy** — your own private version of
a site, running on your computer, safe to experiment with. The site your
visitors actually see is the **live site**, running at WP Engine. In
between, a site may also have **staging** and **development** environments
at WP Engine — shared spaces for trying things before they go live.

Your copy remembers where its contents came from. Ask "where am I?" (or just
look at the site's status) and you'll see something like:

> **You're in a safe copy of Alpine Outfitters.**
> Code: the `campaign-acf` branch.
> Content: pulled from the live site **11 days ago**.
> Nothing you do here touches the live site.

Two of those lines matter more than they look:

- **"Pulled from the live site 11 days ago"** — your copy's posts, pages,
  and products are a snapshot. The live site has kept moving since. Eleven
  days of new orders, comments, and edits exist there and not here. When
  that matters (and Nexus AI will tell you when it does), refreshing your
  copy is one step: *pull from the live site again.*
- **"Nothing you do here touches the live site"** — this is a guarantee,
  not a reassurance. Changing the live site requires steps that are
  separately protected (see "Why can't I just push everything?").

A copy isn't one of the site's environments — it's *yours*, and it tracks
them. You can pull from the live site today and push to staging tomorrow;
it's still the same copy, and its status always says what it's currently
tracking and how far **behind** (or ahead) it is.

## Asking questions while you work

You never have to tell Nexus AI *where* to look for an answer — questions
find their own best source:

- **"What's our most-visited content?"** is answered from the **live
  site's** analytics — always, even while you're working in your copy —
  because only the live site has real visitors. The answer says so:
  *"From the live site's analytics, last 30 days."*
- **"What plugins does this have?"** is answered from whatever you're
  looking at — your copy if you're in your copy — with the usual freshness
  markers.
- **"Has anything like this broken before?"** is answered from the site's
  whole history: things that happened on the live site, on staging, and in
  your copy all count, because they're one site's story.

Actions are different from questions: anything that *changes* something
tells you exactly what it will touch, before it runs:

> This adds the field group to **your copy only**.

## Why can't I just push everything?

Because a site's code and its content move in opposite directions, and
pretending otherwise is how live sites get damaged.

**Code moves up.** Themes, plugins, custom field definitions — changes you
make in your copy are meant to travel: copy → staging → live, tested at
each step. This is the path Nexus AI takes your code changes through, with
a backup and your approval before anything reaches the live site.

**Content moves down.** Posts, pages, orders, media — the live site is
where content is *born* (that's where your team publishes and your
customers act). Content flows from the live site down into your copy when
you pull. It is never pushed up wholesale, because your copy's content is a
snapshot from days ago — pushing it over the live site would erase
everything that happened since.

So when you say **"push my changes live"**, Nexus AI splits the request:

> Here's the safe way to ship this:
> **Can go up:** your field changes and the theme adjustment — through
> staging, with a backup of the live site first.
> **Shouldn't go up:** your content copy — the live site has 11 days of
> newer content that a push would erase. These 3 draft pieces should be
> published on the live site instead — want me to set that up?
> Proceed with the split?

If you truly need to overwrite live content — it happens — that's a
separate, explicit decision with its own confirmation, never a side effect
of shipping code.

## A campaign, start to finish

*(The strategist's tutorial — doubles as the model's acceptance test.)*

You're planning a content campaign for Alpine Outfitters. You want traffic
data, some new custom fields, draft content, and a small theme tweak — live
by Friday, without breaking anything.

1. **"Let me work on Alpine Outfitters without touching the live site."**
   Nexus AI sets you up in your copy (creating one from the live site if
   needed) and confirms: safe copy, what it's tracking, how fresh.
2. **"What content performed best last quarter?"** Answered from the live
   site's analytics, labeled as such. You didn't choose a source; you never
   do, for questions.
3. **"Add a 'campaign' field group to posts."** Done — *"in your copy
   only"* — on a branch, since this site's code is version-controlled.
4. **Draft the content pieces.** They live in your copy. If a draft builds
   on an existing page, Nexus AI notes when your version of that page is
   11 days old and offers a refresh.
5. **"Tighten the hero spacing."** Theme change, your copy, same branch.
6. **"Ship it."** The split, as above: code up through staging with backup
   + approval; content published on the live site through its own path.
   Friday: campaign live, live site never at risk, and every step of what
   happened — who approved what, based on which information — is on record.

At no point did you choose environments, name branches (unless you wanted
to), or learn a new word.

---
---

## CONTROLLED VOCABULARY v1 (the Wave-2 gate)

User-facing words — tool output, prompts, docs, and UI must use these and
only these for these concepts. Schema/internal names are unconstrained but
must never leak.

| Concept (internal) | User-facing term | Never say |
|---|---|---|
| working copy / Layer-3 entity | **your copy** (of <site>) | working copy, sandbox, clone, env |
| wpe_production | **the live site** | production (except in Access & Permissions settings, where it's established) |
| wpe_staging / wpe_development | **staging** / **development** | environment ids |
| content lineage (`content_pulled_from` @ t) | **pulled from <source> <time> ago** | lineage, upstream, snapshot age |
| code lineage (branch/sha) | **the <name> branch** | code_ref, sha (unless user is git-fluent — mirror their language) |
| divergence (copy vs upstream) | **behind** / **ahead** (by time or by items) | drift (reserved for change reports), divergence |
| temporal drift (change reports) | **changed** / "held for <duration>" | drift.detected, ledger |
| freshness pass/fail vs SLO | **checked <time> ago** / **may be out of date** | stale (borderline — ⚠ icon ok, word sparingly), SLO, within SLO |
| pull-live / verify_site_live | **live check** | re-check, verify-site-live, pull-live |
| twin-only / coverage gap hints | **"also seen on … last time they were checked"** | twin, coverage gap, ledger-observed |
| ADR-23 refusal + offer | **the safe split** | two-flow decomposition |
| where-am-I status | **site status** / "where am I?" | task frame, working context |
| health verdicts (WP-17, if ever user-visible) | **OK / needs a check / not reporting** | OK/STALE/DARK (internal only) |

### v1.1 additions (2026-08-17 — WP-20 procedure surfaces + the designer-v5 copy sweep)

The v1 table predates the procedure surfaces; these rows extend it. Rulings,
not drift — each was found in use (prototype v5 / §5b copy) and sanctioned
deliberately:

| Concept (internal) | User-facing term | Never say |
|---|---|---|
| strict runbook (ADR-17) | **runbook** — named, versioned, "marked strict" | procedure (as a noun of art), law document, capability doc |
| checkpoint (gateway-sequenced) | **checkpoint** — "7 of 7 checkpoints attested" | step (for STRICT runbooks — reserved: guided runbooks have steps, strict have checkpoints, per ADR-17 am. 2) |
| attestation record | **attested** — recorded against the checkpoint | *verified* — NEVER for checkpoints. "Verify" belongs to the live check alone; a narrative attestation is recorded, not checked, and no checkpoint renders a verified tick |
| runbook-added step badge | **"runbook added this"** + a reason line | policy-injected, procedure-mandated |
| canary | **canary** — "updates one site first as a canary" | pilot, probe site |
| WPE inventory unit | **install** — ONLY inside WP Engine-labeled contexts (Connections, grants quoting WPE: "one named install") | using *install* as the Nexus count noun |
| Nexus count noun | **environments** — "203 sites · 367 environments" | installs (outside WPE-labeled contexts), envs |
| WPE account inventory refresh | **synced** — "last synced 2 hours ago", the account/install catalog only | *synced* for site reads (those are **checked**) or content (that is **pulled**) — three acts, three verbs |
| a site's manifestation at a place | **locative phrasing: "this site, at staging" / "at WP Engine" / "on this Mac"** — the site is one thing manifested in several places | "the staging environment" as a noun-of-place users must open; also dissolves the dev-collision finding (№2 item 6) |

Confirmed by the same sweep, no change needed: "may be out of date" was
already the v1 fact-level freshness phrase (it composes with the status
level: "checked 3 days ago · ⚠ may be out of date · Check it now"), and the
prototype's usage conforms.

### v1.2 additions (2026-08-18 — the ambient triage + the deferral affordance)

| Concept (internal) | User-facing term | Never say |
|---|---|---|
| deferral (session act, XD-13) | **deferred** — "deferred by you until <condition>", the reason on the row | snoozed, muted, dismissed, silenced |
| wake condition (ends a deferral) | **wake** — "wakes when <condition>"; the deferral ends, full escalation returns, the condition is named | expires/expiry (a wake can be an event, not only a date), reminder |
| ending a deferral early | **end the deferral** — a session act, recorded like the deferral it ends | cancel, undo, dismiss |

## PRESSURE-TEST FINDINGS (№2)

1. **The model survived the harder test.** Every future behavior was
   writable in the register above; no article needed a term the vocabulary
   table doesn't contain. The S1–S4 contract holds on paper.
2. **"Copy" needs a qualifier exactly once** — at first introduction ("a
   copy — your own private version"). After that, bare "your copy" carries
   everything. Writing found no need for "working copy" anywhere — drop the
   modifier from all user surfaces.
3. **"Behind" wants units.** "11 days behind" (time) reads perfectly;
   "3 plugins behind" (items) also works; mixing them in one line does not.
   WP-15's divergence output should pick per-flow: content = time, code =
   items/commits. This is a real spec input discovered by drafting.
4. **The safe-split dialog carries a hidden fourth option** — "publish these
   pieces on the live site instead — want me to set that up?" implies a
   content-publishing path (copy draft → live publish) that NO packet
   currently builds. Writing exposed it: the split's "shouldn't go up" half
   is only actionable if that path exists. Needs a scope decision before
   the S4 dialog ships — otherwise the offer dead-ends.
5. **Step 4's freshness nudge** ("your version of that page is 11 days
   old") requires per-CONTENT-item freshness, which is finer-grained than
   any current twin fact (we track plugins/themes/core, not posts). Honest
   status: the walkthrough overpromises today's substrate — either M3
   content-level observation enters scope, or the tutorial's step 4 softens
   to site-level ("your copy's content is 11 days old").
6. **"Development" (the WPE environment) vs "your copy" collide in user
   speech** — people call both "dev". The docs never needed to distinguish
   them explicitly, which is suspicious rather than reassuring; the
   where-am-I status must always name WPE development as "development (at
   WP Engine)" on first reference in a session.
