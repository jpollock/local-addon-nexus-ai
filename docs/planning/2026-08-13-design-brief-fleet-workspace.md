# Design Brief — Fleet Workspace

**For:** Product Design
**Date:** 2026-08-13
**Status:** Brief for a second round of screens

---

## What we're building

A desktop workspace where someone manages **every WordPress site they're
responsible for** — not just the ones on their laptop.

Today, Local shows you the sites you've downloaded. This turns that inside out:
the app opens onto your WP Engine installs, and a local copy becomes something
you *pull down when you need one*, not the price of entry.

On top of that fleet sits an AI layer that does three things: tells you what's
wrong across all your sites, recommends what to do about it, and — when you
approve — does it.

## Who it's for

Agency owners, in-house web managers, and marketers who look after somewhere
between three and three hundred WordPress sites. Some are developers. Many
aren't, and increasingly the people responsible for a site's *performance* are
not the people who can safely edit it.

## The mental model

Three ideas carry the whole product. If a screen makes any of them unclear, the
screen is wrong.

**1. The site is the thing. Where it lives is a detail.**
`www.jeremy.com` is in your list whether or not it's on your machine. You can
look at it, ask questions about it, and change it. What varies is *how much we
currently know* and *what we can safely do* — not whether it appears.

**2. A local copy is a sandbox, not a home.**
When you ask for something risky — a code change, a plugin swap, anything that
could break a live site — we offer to pull the site down, make the change on a
disposable copy, show you exactly what changed, and push it only when you say so.
This is the safety mechanism that lets AI touch production at all.

**3. Everything runs in a loop.**

> **See** what you have → **Understand** what's wrong → **Act** on it →
> **Verify** it worked

The screen that exists so far ("What do you need done?") is the *Act* entry
point. The other three quarters of the loop don't have screens yet. That's what
this round is for.

## What already exists

One screen: a centred prompt — *"What do you need done?"* — with a scope
selector, an agent picker, and eight task cards (Landing page, Plugin update,
Performance audit, Security scan, Content brief, Push to WP Engine, Save as
Blueprint, SSL renewal).

It works well as a launcher. Two things it raises rather than answers:

- **Is this the home screen, or a mode you enter from somewhere else?** If the
  fleet is the primary object, the fleet probably wants to be home and this is
  what you get when you start a task. We don't have a strong view — that's a real
  question for you.
- **The most valuable thing in the product isn't something you ask for.** Six of
  the nine research participants who ranked features put *fleet health* first.
  Health isn't a request; it's a state that should already be true when you open
  the app. It currently has nowhere to live.

---

## Screens we need

### Priority — these three carry the most product risk

**1. The fleet.** Every site you're responsible for, in one list. Grouped
sensibly (WP Engine groups production, staging and development under one site).
Shows at a glance which need attention, which are healthy, and which we don't
know much about. Local sandboxes appear attached to the site they came from, not
as separate entries.

The hard part: a fleet of 200 sites where 190 are fine. How does the list stay
useful at that scale, and how does it feel calm rather than alarming?

**2. What needs attention.** Ranked findings across the whole fleet — outdated
PHP, a misconfigured cache, a plugin with a known exploit, a page whose traffic
is collapsing, content that contradicts something published last year. Each with
a plain-language reason it matters and an action.

Two constraints. Findings must carry *why this matters*, not just severity — one
participant specifically asked for the AI to explain the value of a change so
less technical people understand it. And findings must be able to **leave the
app**, into Slack, ClickUp or PagerDuty, because several people told us flatly
they will not log into another dashboard.

**3. The sandbox moment.** The single most important interaction in the product.
Someone asks for something risky. We offer a sandbox. We pull the site, make the
change, and show a diff. They approve. We push and re-check.

If this reads as a modal to dismiss, the entire trust model fails. It needs to
feel like a normal, even desirable, way to work — not a warning.

### Second round, if there's capacity

**4. A single site.** One install: its environments, whether a sandbox is
attached, its health, its content, what's changed recently.

**5. Work in progress.** An agent is doing something right now. What is it
touching? How far along? Can I stop it?

**6. After the fact.** We made a change. Did it work? What moved?

---

## Constraints that aren't negotiable

**Nothing stale is ever shown as current.** For a site you haven't opened in
three weeks, everything on screen is remembered, not observed. Every value needs
a source and an age — *checked just now* / *from our last sync, 4 days ago* /
*we've never successfully reached this site*. This is pervasive: it touches every
row, every number, every finding. It is cheap to design in and impossible to
retrofit, and the product's credibility rests on it.

**Recommend first, act on approval.** The default posture is insight. Acting is
something you turn on, per site. From the research: *"I would never want to give
an AI agent code access, but I would love for it to have its insights of here's
what you can do and where you can go to fix it."*

**Not everything should be a conversation.** *"If I say update the H2 title to
XYZ, and there's two H2s on a page, then I have to explain to an AI, go back and
forth. Whereas if I can click a thing and just make an edit, that's easier."*
Chat is right for ambiguous work and wrong for precise edits. Both need to exist.

**Presence beats navigation.** One reason people want this on the desktop rather
than in a browser: *"it's way less easy to lose in all the 1,000 tabs that people
have open."* Whatever the AI layer is, it should feel present rather than
somewhere you go.

---

## What the research says

Ten sessions on the North Star vision, plus a year of prior work. The most
load-bearing quotes:

> *"I think the site health and monitoring is the most impressive feature that I
> saw. And I will say that because that is what most people fail at — for
> instance, enabling the WP Engine cache. I can't tell you how often I've seen
> that not properly implemented."*

> *"It's a little confusing in my mind because I'm thinking Local is local. I'm
> not thinking about production sites."*
> — the naming and framing problem, in one sentence

> *"You hear a lot of horror stories about AI connecting to servers and people
> have wiped out their databases. I do think that local is going to be a place
> where we're gonna continue to do a big chunk of our development and our
> testing, especially in that AI landscape."*
> — why the sandbox matters

> *"If I could do SEO checks more before I launch the site, and do that within a
> local staging site, that would be great."*

> *"Those access and permission settings are really important in any kind of
> shared platform like this where we've got some control to do some quite
> powerful stuff, but we don't want them to be able to do too much."*

> *"I would want some type of a secondary AI system to check this AI system and
> make sure it wasn't going rogue."*
> — two participants independently asked for this

The single non-adopter had already built his own version: *"I don't log into
WordPress dashboards anymore. I don't log into WordPress sites anymore. I just
connect my agents."* Worth designing as though he's the near future.

---

## Deliberately out of scope

Don't spend time on these — they're real, they're just later:

- **Multiple users, roles, and client access.** Everyone asked for it. It needs
  identity work we haven't done, and the research on who the primary user
  actually is isn't finished.
- **Web and mobile.** Several people wanted both, especially for alerts. Held
  until we know the audience better.
- **SEO tooling that competes with Ahrefs or SEMRush.** We'll do content
  intelligence from the customer's *own* data — overlap, decay, contradictions —
  not third-party market data.
- **Writing content.** We brief and we check. We don't draft, yet.

## Open questions we'd like your view on

1. Is the task launcher the home screen, or does the fleet own home?
2. At 200 sites, what makes a fleet list calm instead of overwhelming?
3. How do you show a site you know a lot about next to one you know almost
   nothing about, without the second one looking broken?
4. Where does the AI live when you're not talking to it?
5. Should a site you've pulled down look different from one you haven't — and how
   much should anyone have to care?
