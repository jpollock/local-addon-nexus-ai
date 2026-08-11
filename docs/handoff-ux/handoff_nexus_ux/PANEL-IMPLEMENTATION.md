# The panel — implementation package

Scope: the docked Insights/Chat panel only. Everything needed to build it, nothing about the rest of
Nexus. Self-contained — you should not need the other handoff files to build this.

**Provenance rule.** This document asserts **design intent**. Where it appears to describe repository
state — a method, a mount point, an existing behaviour — treat that as a claim to verify, and if the
code disagrees, the code wins without reconciliation. Two earlier claims of that kind were wrong.

---

## 1. What it is, and why it is the priority

One panel at the edge of the app, two tabs, four sizes, present on **every screen in Local** —
including screens Nexus does not own. It replaces three separate chat entry points and it is the only
Nexus surface that works where the user already is.

It resolves three findings at once: the three chat surfaces of differing quality collapse to one; the
health check stops needing a tab; and the review queue stops needing to be remembered, because it
comes to the user.

**The infrastructure is believed to already exist.** `DockedPanelContainer` was observed being
rendered into a fixed full-viewport div on `document.body`, gated by a `dockedPanelEnabled` setting.
If that still holds, this is mostly repackaging what is already mounted. Verify before planning.

---

## 2. The four sizes

One state. Model it as a **single enum** — `closed | docked | wide | full` — with exhaustive
branches. Do not model it as two booleans (`isOpen`, `size`): the combination `closed + full` then
exists, renders nothing, and strands the user with no way back. That trap was in the prototype until
it was caught.

| Mode | Form | Purpose |
|---|---|---|
| `closed` | 48px rail, right edge | Resting state. Carries signal — see §3. |
| `docked` | 380px column | Default. Reading answers, glancing at insights. |
| `wide` | 620px column | An answer with a table in it, site still visible behind. |
| `full` | Overlay across the app frame, 760px centred column | Sustained conversation. |

**Transitions.** `docked ⇄ wide` is a toggle in the header. `→ full` is a separate control and
**switches to the Chat tab**, because that is what people maximize for. `full → docked` via a
labelled control, not just an icon. Closing from any open size goes to `closed`; opening from
`closed` returns to `docked`.

**The conversation is identical in all four.** Maximize is a size change, never a different surface —
same history, same scroll position, same draft text. If a user loses their place when resizing, the
model is wrong.

---

## 3. Collapsed (48px) — the state it is in most of the time

This is the whole argument for the panel, so it must not be mute. A chevron and a vertical word give
nobody a reason to open it and no idea when to.

Top to bottom: an expand chevron; the Nexus mark in a `#ecfcfd` rounded square with a **count badge**
overlaid; a vertical label; then flex spacer; then a **stuck marker** pinned at the bottom.

**Two indicators, deliberately not one.** Ten decisions waiting is a normal Tuesday. One paused agent
is not. A single number cannot say both.

- **Count badge** — `#0ECAD4` on white text, 15px tall, `border-radius: 3px`, `font-size: 9px/700`,
  `letter-spacing: 0.5px`, `box-shadow: 0 0 0 2px #fff`. Deliberately the **same treatment as the
  left-rail badge**: one signal appearing in two places, not two signals to learn. Hidden at zero —
  not rendered as `0`.
- **Stuck marker** — 30×30, `border-radius: 8px`, `#fffbeb` on `#b45309`, glyph `!`. Shown only when
  something is actually stuck.

### Scoping — the rule that is easy to get wrong

Both indicators scope to **what the rail is showing**, and they must scope together.

| Context | Label | Badge | Stuck marker |
|---|---|---|---|
| A Nexus screen | `INSIGHTS` | fleet count | shown, tooltip names its scope |
| A single site's screen | `THIS SITE` | that site's count | **suppressed** |

A fleet problem affecting two other sites must not render as an alarm about the site the user is
looking at. Scoping the badge but not the marker — which the prototype did until review — puts a
site-scoped number and a fleet-scoped alarm 40px apart with nothing saying they differ.

If you later want fleet problems visible from a site screen, they need a visibly different treatment
and a label saying so. Silent is not an option.

The whole strip is one click target. Tooltip names the scope: `Insights across all 367 sites` /
`Insights for Good Aesthetic Club`.

---

## 4. Header

Left: a segmented control, `Insights` / `Chat`, `#f3f4f6` track, active pill white with
`box-shadow: 0 1px 2px rgba(17,24,39,0.1)`. Right: widen toggle, maximize, close.

Icons come from the repo — `DockedPanel/assets/icon-expand.svg`, `icon-contract.svg`,
`icon-collapse.svg` — stroke `#868d98`. **Use the assets.** The prototype hand-draws the collapse
chevron because tooling was unavailable when it was built; do not reproduce that path.

---

## 5. Insights tab

A context label in `12px/800` uppercase `#6b7280`, then:

**Waiting card** — amber (`#fffbeb` on `#fde68a`), title `N things are waiting on you`, a sentence
breaking it down, and a button into the Inbox. **Not rendered when the Inbox is already on screen** —
a card that says "go where you are" is noise. Not rendered at zero.

**How the fleet looks** — four rows, icon + label + value. Problems in `#ef4444`/`#b45309`, neutral
facts in `#374151`. On a site screen these become site-level facts (what we know, broken links, pages
returning errors, last looked) rather than fleet ones.

**Running on its own** — the background jobs, each with a live status, and a footer line stating the
current connection load. **This reads from the same computed values as Settings → Background work.**
It must never be a second copy of those numbers; if the two disagree the user is being shown that the
product does not know its own state.

---

## 6. Chat tab

**Empty state.** A line naming the fleet, then suggestion pills grounded in the user's actual sites —
not generic prompts. In `full`, this becomes a centred hero: `What do you want to know?` at
`34px/800`, `letter-spacing: -0.025em`, with a large composer and pills below.

**Turns.** User right-aligned on `#e0f2fe`; assistant left on `#f3f4f6`; `border-radius: 11px` docked,
13px in full; `13.5px/1.5` docked, `15px/1.55` full.

**Answers render as UI, not prose.** An answer naming sites returns a bordered table of rows
(name + meta), a filled primary action (`Stage an upgrade on all 5`), and the line *"Staged first —
nothing goes live until you say so."* Attribution underneath at `12px #9ca3af`. A wall of markdown the
user has to re-read to act on is the failure mode this replaces.

**No agent picker in the composer.** Do not offer Content / SEO / Site health / Orchestrator. Choosing
correctly requires knowing how the system is decomposed — the exact demand the rest of the design
removes. Route automatically and name the specialist *after the fact* (`Switched to the Security
agent`), which is informative rather than a decision.

**Composer footer**, always present: *"Anything that changes a site is staged and shown to you
first."*

---

## 7. Behaviour

- **Context follows the app.** On a site screen the panel scopes to that site — label, counts, stats,
  and the assistant's implied subject. Moving between screens re-scopes it without losing the
  conversation.
- **Landing:** open on Inbox when anything is waiting, otherwise on Ask.
- **Theme:** follow Local's light/dark setting. The current panel is dark with cyan accents while the
  dashboard is light with teal — four visual systems within two clicks. The panel does not get its
  own.
- **Persistence:** size and open/closed persist across launches. Open question, worth deciding before
  build: whether that is **global or per-screen**. Global is what exists; per-screen is probably right
  — collapsed on a site you are working in, open on Nexus screens — but it is a real product call and
  it changes the storage shape.

---

## 8. Tokens

Brand `#0ECAD4` for accents, active borders, dots, badges. **Filled controls carrying white text use
`#0a8189`** (hover `#076b71`) — `#0ECAD4` with white measures 2.96:1 and fails AA at button sizes;
`#0a8189` is the same hue at 4.65:1.

Surfaces `#ffffff` / `#f9fafb` / `#f3f4f6`. Borders `#e5e7eb`, inputs `#d1d5db`. Text `#111827` /
`#4b5563` / `#6b7280` / `#9ca3af`. Warning `#fffbeb` / `#fde68a` / `#b45309`. Danger `#fef2f2` /
`#fecaca` / `#ef4444`. Success `#f0fdf4` / `#3d9c52`. Teal tint `#ecfcfd`. Chat user bubble
`#e0f2fe`. Icon stroke `#868d98`. Nexus mark fill `#05262e`.

Radii: 3 badge · 6–7 controls · 8–9 rail squares and cards · 11–13 bubbles and composer · 20 pills.
Type: Local's UI stack. Motion: `animation: nxfade 0.18s ease` (opacity + 4px translateY) on reveal;
nothing else animates.

---

## 9. Acceptance

1. The panel appears on a Local screen that has no Nexus navigation on it.
2. Collapsing on a site screen shows that site's count and **no** stuck marker while a fleet problem
   exists; the same rail on a Nexus screen shows the fleet count **and** the marker.
3. Typing a draft, maximizing, and restoring preserves the draft, the history and the scroll position.
4. No reachable state renders neither the panel nor the rail.
5. The load figure in *Running on its own* equals the one in Settings → Background work, without a
   reload.
6. Turning the panel off in Settings removes it from every screen in Local, and the copy confirming
   that says nothing else changes.
7. Asking a question that names sites returns rows and an action, not a paragraph.

---

## 10. Not in this package

**Staging and revert.** The panel promises it in two places and nothing shows what staged looks like,
where staged-but-unapplied work lives, or what revert costs once something is live. That is the
precondition for letting a non-developer act on a client's site, and it is deliberately undesigned —
not an oversight to route around. Flag it if you hit it while building.
