# The shell inversion — execution plan · nexus as THE Local interface

*(Architect, 2026-08-20. Execution plan, POC-branch-first, per the
owner's direction. Audience: us. The product buy-in case is a separate
document assembled from the demo; this one is how the shell actually
gets built. The standing rules all carry: derived-never-authored, copy
gate-held, the designer loop per surface, evals precede surfaces,
every packet gated and adjudicated.)*

## 0 · Ground truth — what exists and what the addon can reach

**Three of the rail's five destinations already exist as shipped
surfaces:** Home = the arrival (WP-46, in flight) · Settings = the
Govern section (WP-44) · Nexus = the Docked Panel chat + procedure
surfaces (WP-26/27/35/38/43). The comparator (WP-41/42) is the seed of
the Sites destination. Every designer sheet since cycle four is drawn
INSIDE the full shell — the chrome is already the contract.

**Mechanics the addon owns today** (read from `src/renderer/index.tsx`
and `NavItemInjector.ts`): full-page routes via
`hooks.addContent('routes[main]')` at `/main/nexus/...`; rail items via
MutationObserver injection (no official vertical-nav hook — a known
fragility, already version-pinned against Local's own SCSS); global CSS
injection; sidebar badges; HashHistory navigation (boot-time redirect
is a `window.location.hash` write). **Conclusion: a shell takeover is
reachable from inside the addon.** Local core is NOT required for
phase A — it is required only to make the inversion native (phase B).

**Substrate: complete.** The session registry (WP-30) was the last
missing fold. Every shell surface reads derived data over IPC; no new
architecture is required by anything in this plan — which is the
"rendering change on the entity graph" ruling, now checkable.

## A · Shell mode in the addon — the demo vehicle

The inversion ships as a MODE, not a coup: a "Start in Nexus" setting,
default OFF, that boots Local into `/main/nexus/home` and renders our
shell frame. Local's own chrome is subdued, never removed — **the
escape hatch is a law of this plan**: every Local surface stays one
click away, and nothing the shell does can trap the user. An inversion
that hides the old app is a demo trick; one that survives beside it is
a product argument.

### The packet sequence

| packet | what | status / dependency |
|---|---|---|
| WP-46 | Home — the arrival + re-entry | **in flight** |
| WP-20c + micro bundle | incident split; registered micros | next, small |
| **Cycle six (designer)** | the Sites matrix (sessions-by-consequence), the M1 cold-open verdict view, the act-small surface | the one real design gap; shell chrome already drawn |
| **WP-47 · the shell frame** | the frame at `/main/nexus/*`: rail per the sheets, route table, boot redirect behind the setting, Local chrome subdued via the existing injection mechanics, escape hatch pinned by test | after WP-46; small, mostly plumbing |
| **WP-48 · Sites by consequence** | the main-view inversion: sites ordered by the consequence order (registry situations join site rows), comparator reached from it, site row opens Local's own site-info | after cycle six; the one genuinely NEW surface |
| **WP-49 · the Glance verdict** | M1's cold open — "is everything okay" answered from the fleet verdicts; the shell's front door above the arrival | after cycle six; flips J-Glance |
| Act-small surface | one change, one site, without fleet ceremony | rides cycle six's ruling; may fold into WP-48 |
| Shell sitting | owner boots with the mode ON, walks all six moments in the shell, on the record | after WP-47–49 |
| Demo assembly | the scripted walk (Glance→Inspect→Act→Return→Govern, restart included), from the shell, on the real fleet | the closing artifact; feeds phase B |

Locks stay disjoint by construction: WP-47 owns the frame and
`index.tsx`; WP-48/49 own their component directories; the eval
registry lock serializes as always.

### What phase A must prove (its acceptance frame)

1. Local boots into the shell and a person can do a full day's work
   without leaving it — and can leave it at any moment (the hatch).
2. The Sites view ordered by consequence is USABLE as the primary
   view, not just demonstrable — the sitting judges this, pass³.
3. Every shell surface is the derived surface we already shipped —
   zero forked rendering, zero shell-only data paths. A shell that
   needs its own derivations has failed this plan's premise.
4. J-Glance and the remaining renderable journey criteria flip in the
   registry; what remains BLOCKED names Local core or product scope
   honestly.

## B · Local core — making it native (post buy-in; prepared, not scheduled)

Not ours to schedule, but ours to make cheap. Phase A's discipline is
the preparation: every surface is a React component consuming a typed
IPC contract, so the port to Local's codebase is a mount-point change
plus the removal of the injection hacks (the MutationObserver rail
becomes a real rail; the boot redirect becomes the boot route). What
genuinely needs Local core: the native rail, the default route, theme
integration without CSS injection, and killing the ABI dance by
aligning the addon's native deps with Local's Electron. The
deliverables that open that conversation: the demo, the shell sitting's
record, this plan, and the designer's sheets as the visual contract.
The record itself is the argument that this can be maintained by a
team that wasn't in the room.

## Risks, named

- **Injection fragility**: the rail/CSS injection breaks if Local
  restyles its nav. Mitigation: already version-pinned with drift
  comments; WP-47 adds a boot-time detection that falls back to
  Local's chrome with the shell reachable by route — fail-open to the
  old app, never a broken window.
- **Performance at the front door**: the arrival's fold runs on boot.
  WP-30's fold is bounded (the 2000-manifest horizon, disclosed);
  WP-47 measures cold-boot-to-verdict and records the number rather
  than assuming it.
- **The product risk is the real one** and no packet retires it: Local
  is WP Engine's product and the inversion reimagines its main
  surface. Phase A's whole design — a mode with a hatch, zero forked
  data paths, the record behind every screen — exists to make the
  buy-in decision easy and reversible, which is the most a branch can
  do.

## The one-line version

Ship the shell as a mode inside the addon (three surfaces exist, two
to build, one frame to hang them in), sit in it, demo from it, and
hand Local core a finished argument instead of a proposal.

---

## AMENDMENT (2026-08-20) — the designer's plan adopted as governing; phase A reframed

The designer delivered their own inversion plan
(`from-designer/from-designer-10-shell-inversion-plan.dc.html`,
committed verbatim, md5 `8ba961cd999160cd5435f50e9d623939`), and this
amendment records the adjudication: **their plan supersedes this
document's phase A as the plan of record for the inversion itself.**
Two of their corrections are accepted outright:

1. **The end state.** Theirs is better than this document's: "the rail
   is Local's own, the window is Local's own, and the intelligence is
   not a place inside it — it is how every place behaves." A
   Nexus-branded shell replacing Local's chrome was the weaker
   inversion; intelligence dissolving INTO Local is the one the
   moments model actually implies, and the one a product team can say
   yes to. Their six phases (composer everywhere → site screen absorbs
   intelligence → the record as a place → Settings absorbs Govern →
   the list leads with the arrival → the last selector deleted),
   ordered by ascending risk, each gated by a journey eval, dual-track
   by HOST CAPABILITY rather than by flag, are adopted as the
   sequence. Phase 6's gate being a number reaching zero — the only
   phase that cannot be declared done by narrative — is the best
   single mechanism in either document.
2. **The mechanism ceiling.** Their §3 refutes this document's phase A
   as SHIPPABLE product: every surface bought by selector is bought
   against Local's next release, and the failure is silent. The
   receipts are from our own source and they are correct. "A phase 1
   that begins before the contract exists will be built as injection
   and will have to be built twice" stands as the ruling.

**What survives of this document's phase A — reframed, narrowed:** the
POC-branch shell is retained ONLY as the DEMO PROTOTYPE — explicitly
disposable, never shipped to a user, bounded by the same DOM-reach
inventory their phase 0 requires. Its sole purpose is to answer their
own §9's first question in our favor: the host contract runs through
Local's team's roadmap, and the thing most likely to get four API
items onto another team's roadmap is sitting them in front of a
working inversion rather than a proposal. WP-47/48/49 as SHIPPING
packets are WITHDRAWN; the surfaces themselves (Sites-by-consequence,
the Glance verdict, act-small) remain real work — they are consumed by
the designer's phases 5, 1, and 2 regardless of mount point, and they
build against IPC contracts exactly as before, so nothing built for
the demo is thrown away except the mount.

**The two plans compose:** theirs is the product inversion (gated on
the host contract, phase 0 first); this document's remainder is the
demo track that wins the contract, plus the packet sizing their §1
explicitly leaves to the architect — to be bolted on phase by phase as
each opens.

**Their §9, dispositioned:** contract ownership → WE DRAFT, Local
ratifies; the draft is phase 0's packet, and the demo is its exhibit.
Dual-track floor → a stated Local version floor, proposed at phase 0's
gate, so phase 6 is finite. Phase-5 reversibility → their instinct is
adopted: the route back to the plain list is product behavior, one
move, no settings; whether it becomes a persistent choice is a product
conversation deliberately deferred. The addon's name → flagged to the
owner; a product decision, not ruled here.
