# A host contract for chrome-level addon surfaces

**From:** the Nexus AI addon team
**To:** Local engineering (`@getflywheel/local-engineers`)
**Date:** 2026-08-20
**Against:** Local 10.1.1 @ `844352123`, `local-components` 17.8.2
**Status:** proposal, for ratification

---

## 0 · What this is, and what it costs you

This is a request for four named surfaces in Local's addon API, and — in the same
breath — a commitment to delete eleven places where we reach into Local's DOM
today. It is written as a response to your architect's reconnaissance of the
renderer, which we asked for and which answered every question we had with
receipts. Their seven-item list of *"what I'd want from an addon proposing this"*
is the structure of this document, in their order.

We want to be precise about the shape of the ask, because we think the shape is
what usually sinks proposals like this one:

- **Four surfaces, not a framework.** No generic slot registry, no plugin
  architecture, no "chrome extensibility layer". Four named things, each of which
  can be reviewed on its own and shipped on its own.
- **Detection folds into each surface** rather than arriving as a fifth item.
- **Every item removes more of our coupling than it adds of your surface area.**
  Section 5 is the ledger, with versions attached.
- **Your architect's estimate for a v1 of all four is ~8 engineer-weeks.** Their
  number, their words — see §8.

What we are asking you to take on is not four features. It is a *contract*: four
names that we will build against and that you will not rename without an alias.
Section 7 asks you to write down the deprecation policy that makes that a real
commitment rather than a hope, and it is the cheapest and most valuable item here.

### Where we were wrong

Four of our own assumptions did not survive the recon, and it is worth listing
them first, because three of them were wrong *in our favour* and the fourth
changed the shape of an entire ask:

1. We believed `routes[main]` was a route hook. It is a catch-all sink: the addon
   block is the last child of `MainPage`'s `<Switch>` and carries no `path`, which
   in react-router 5.3.4 is an unconditional match, so it runs only when none of
   Local's thirteen routes matched (recon §3; their citation: `MainPage.tsx:185-200`,
   `react-router.js:882-894`). Preempting `/main` from there is structurally
   impossible, not merely unsupported.
2. We believed screen replacement with Local's screen as the fallback would be a
   new principle. **It ships today** — `routes[site-info]` splices addon routes
   above the non-exact Overview catch-all (recon §3, §8.1; their citation:
   `SiteInfo/index.tsx:464-495`, the splice at `:486`, the fallback at `:489`).
   That is the lead argument for item 4 and it is your code, not our workaround.
3. We believed the `TabNav_Items_*` hash tracked file content and would move
   whenever the stylesheet changed. It is computed over the file *path* plus the
   class name, so it survives every edit to `TabNav.sass`; only the `_v` suffix
   tracks releases (recon §7; their citation: `shared-rules.js:14`,
   css-loader 6.11.0 `dist/utils.js:289-299`). We had pinned the full string
   including `_v17-8-1` while you ship 17.8.2 — so that selector had *already*
   stopped matching and nothing told us. It is now `[class*="TabNav_Items_"]`,
   and a build gate refuses any version-pinned class in our source.
4. We believed reading the theme class off `<html>` was the only way. It is the
   intended way, but `localPreferences.currentThemeName` and the `osThemeChange`
   IPC event were both available to us the whole time (recon §4; their citation:
   `themecop-init.tsx:13-17`, `ThemeCop.ts:196`). We already subscribed to the
   event; we now read the published value first. That correction cost you nothing
   and removed a source of drift from our side today.

We mention these because they are the difference between a proposal written from
the outside and one written after reading the code. Everything below is cited to
the recon; where the recon did not assess something, we say so rather than
substituting a guess.

---

## 1 · Name the surfaces, not the abstractions

> *"'Nexus needs a rail item, a right-docked panel with reserved width, the
> site-list body, and the theme ramp' is reviewable in an afternoon. 'A chrome
> extensibility framework' is a quarter of design review."* — recon §9

Four items. Each carries an integer-versioned member on one frozen namespace:

```ts
context.capabilities // { themeTokens?: 1, mainVerticalNav?: 1, layoutReservation?: 1, regionProviders?: 1 }
```

Absent means unsupported, and `undefined` is falsy, so an old host degrades
correctly with no version comparison anywhere. This is your architect's own
recommendation (recon §6), with two members renamed to match the reshaped asks
below: their illustrative `chromeSlots` is `mainVerticalNav` because we are asking
for one named slot rather than a registry, and their `routeOwnership` is
`regionProviders` because they talked us out of route ownership entirely.

**Adding it costs one field on `AddonRendererContext`** (`renderer.d.ts:277-311`).
It is typed, it degrades by construction, and it means detection is not a fifth
ask — it is the shape of each of the four.

One request about the integers, because it is the part that bites later: **a bump
from 1 to 2 must mean "additive"**. If a capability changes in a way that breaks a
v1 consumer, it needs a new member name, not a higher integer. Otherwise every
consumer has to pin an exact integer and the versioning does nothing.

### 1.1 · Theme tokens as values — first, and independent of everything else

**What exists today.** Tokens exist only as SCSS: `_variables.scss` (102 lines —
the full ramp, `$gray-darker: #131313`, `$green: #51bb7b`, `$blue: #50c6db`, plus
`$museo-sans-rounded` / `$system-font`) and `_theme.scss` (457 lines of
`if-theme-light()` / `if-theme-dark()` mixins). CSS custom properties appear in
exactly four component SCSS files repo-wide, all component-local. There is no
global custom-property layer and no theme React context — the recon grepped every
`createContext` in `app/renderer` and `packages/local-components/src` and found
zero. `local-components` exports 166 lines of components and no tokens at all.
Local's own app code consumes tokens by `@import`-ing through a relative
`node_modules` path (recon §4; their citation: `ProductDrawer.scss:1-2`,
`SitesSidebar.scss:1`). As your architect puts it: *"That's not an API you're
missing; it's the absence of one."*

**What we are asking for.**

1. The ramp emitted as **CSS custom properties on `:root`**, scoped under
   `Theme__Light` / `Theme__Dark`. This is the recon's own recommendation, and its
   reasoning is the part that matters: custom properties are what make tokens
   consumable by addons that do not have a SASS build, *which is most of them*.
2. `theme: { name, tokens }` on `AddonRendererContext`, with the **existing**
   `osThemeChange` IPC event as the change signal (`ThemeCop.ts:196`). No new
   event, no new subscription mechanism.
3. `capabilities.themeTokens: 1`.

**What we do with it.** Our renderer maintains 36 `--nxai-*` custom properties
that restate colour decisions beside Local's, in two themes, by hand. They derive
from your ramp instead. Every one of them is a place our UI can drift out of
Local's palette without anyone noticing, and today nothing but care prevents that.

**Why first.** Your architect's words: *"Do this first regardless of everything
else. No architectural risk, no runtime coupling, immediately useful to every
addon, and it removes a whole class of DOM sniffing."* It also has no dependency
on the other three, so it can ship alone and still be worth shipping.

**The one complication, which we are carrying rather than leaving with you:** the
recon notes that external consumers already depend on the current token names, so
a rename needs an alias period. See §6.

### 1.2 · One named rail slot — `mainVerticalNav`

**What exists today.** Nothing. Not an undocumented hook, not a deprecated one —
*"You didn't miss a hook. There is none."* `MainVerticalNav` renders nine
hardcoded JSX children positionally, and `VerticalNav` is a dumb `<nav>` that
renders `props.children` (recon §2; their citation: `MainVerticalNav.tsx:34-192`,
the children at `:179-187`, mounted at `MainPage.tsx:157-164`;
`VerticalNav.tsx:14-27`). `VerticalNavItem` supports
`type: 'addsite' | 'button' | 'filler' | 'navlink' | 'switcher'` and is already
exported from `@getflywheel/local-components` — so *the item is available to us
and the slot is not*.

**What we are asking for.** One named slot, not a generic registry — again, your
architect's framing: *"A generic mount-point system invites the question 'which
slots, forever?' and stalls. One slot with an obvious extension path ships."*

- The nine positional calls become a `{ key, order, group: 'top' | 'bottom',
  render }[]` array, run through a filter or a typed additive hook, and rendered.
  `renderFiller()` at `:185` already partitions the rail into top and bottom, so
  the grouping model exists in the layout and only needs a name.
- **The item shape is modelled on `AddonSettingsItem`** (`renderer.d.ts:381-396`)
  — the documented `{ path, displayName, sections, onApply, sectionsProps }` shape
  addons already use to contribute to Preferences. It is the closest thing in the
  published API to a named slot with a typed contract, and matching it makes this
  a continuation of something you already accepted rather than a novelty.
- `capabilities.mainVerticalNav: 1`.

**Three requirements, stated up front rather than left as implementation detail:**

**(a) MobX-observable, or backed by a store, from the outset.** This is a
requirement and not a preference, and it is the single most consequential thing
the recon told us. The hook registry is not reactive: `RendererAddonLoader` runs
before `render()`, `global.registeredHooks` is a plain object, and `doContent` is
a synchronous array read during render (recon §1 and §10; their citation:
`bootstrap-app.tsx:14-21`, `HooksRenderer.tsx:8-18`, `:119-133`). Register a
surface after your `readyPromise` resolves, or after a container lazily resolves a
service, and *nothing re-renders* — your content appears whenever that subtree
next re-renders for an unrelated reason, or never. Your architect calls this
*"the single most under-documented semantic in the system"* and notes that
`MainVerticalNav` is already `observer()`-wrapped (`:192`), so for this surface the
reactivity costs nothing. Their warning is exact and we are repeating it back
verbatim because it is the failure mode we would otherwise ship into: *"it needs
to be a stated requirement in the proposal, not an implementation detail, or
you'll get an additive-array API with the same one-shot semantics and a
nondeterministic startup race."*

**(b) Per-item error isolation.** `doContent` has no try/catch, unlike
`doActions` (recon §1; their citation: `HooksRenderer.tsx` vs `HooksMain.ts:31-36`).
A throwing content callback propagates to `ErrorBoundaryDialog`, which fires
`goToRoute` → `/main` and shows a native error dialog (`ErrorBoundaryDialog.tsx:15-31`).
**One bad addon bounces the user out of whatever they were doing and back to the
site list.** A rail slot without per-item isolation makes that a permanent
property of the rail. We would rather ship a rail with one missing icon.

**(c) The active-state fix comes with it.** `renderLocalSitesLink` computes its
active state by *negative* path matching against five hardcoded route prefixes
(recon §2; their citation: `MainVerticalNav.tsx:65-71`). Any addon-owned rail item
living under `/main/` lights up the "Local sites" icon simultaneously unless it is
added to that exclusion list. As the recon puts it: *"A contribution API that
doesn't also fix active-state resolution ships a visual bug on day one."* The fix
is to make ownership explicit — each item declares the route prefix it owns, and
active state resolves against the owner — rather than to extend the exclusion
list, which just moves the bug to the next contributor.

### 1.3 · Layout reservation v1 — `layoutReservation`

**What exists today.** No layout owner, no region concept, no width authority.
`.Window` is a plain global class in `:global` scope, `position: absolute;
inset: 0; display: flex`, with three hardcoded child widths: 68px rail, 25%
sidebar clamped 230–480px (34px collapsed), and the remainder for content (recon
§5; their citation: `Window.tsx:93-110`, `Window.scss:3-14`,
`VerticalNav.scss:3-12`, `SitesSidebar.scss:9-17`, `:106-109`). `ProductDrawer` is
the only panel-shaped feature and it is `position: fixed` with a scrim — it
overlays and never reserves (`ProductDrawer.scss:4-21`, `:30-60`).

We are not extending a system. We are asking you to introduce the first one, and
we want to say that plainly rather than pitch it as a small addition.

**What we are asking for — scoped exactly as your architect scoped it.**

```ts
reserveEdge({ edge: 'right', requestedPx: 380 }) // → { grantedPx: number }
```

`Window` is the only correct home: it is the sole owner of the outer box, it
already accepts arbitrary props, and it is rendered by both `MainPage` and
Settings (recon §5). It applies granted insets as inline style and publishes the
granted values through context.

v1, and only v1: **right edge only · main window only · one reservation at a time ·
no persistence · grant clamped to a fixed fraction of window width.** Everything
else — contention between two addons, other edges, persistence across restart,
the second `.Window` in Preferences — is v2 and we are not asking for it.

**"The shell decides and reports what it granted."** That framing is ours and your
architect adopted it verbatim, for the reason that makes it worth keeping: it
makes the API a *negotiation* rather than a shared mutable, which is what makes it
reviewable. A caller asks; the shell answers with what it actually gave; the
caller renders against the answer, not against the request.

**The known costs, which are yours and which we are not pretending away** (recon
§5, all five):

1. `position: fixed` descendants escape any `.Window` inset — `.DrawerOverlay` is
   fixed to the viewport, and there will be more.
2. The rail width (`left: 68px`) and the Windows titlebar offset (`top: 32px`) are
   duplicated as magic numbers in at least three files; a reservation system needs
   them to become derived values or the drawer misaligns the moment anything is
   reserved against.
3. Per-platform insets already exist informally (`.Window.__OsWindows { top: 32px }`)
   and would need folding into the same model.
4. The z-index ladder is flat and hand-maintained — 8 drawer, 9 rail, 10 backdrop,
   with the ordering documented by hand in a code comment (`ProductDrawer.scss:17`).
   A granted panel needs a defined layer and there is no scale to assign it from.
5. The percentage sidebar means reserving 400px on a small window pushes content
   toward zero. **The clamp is the load-bearing part**, which is why it is in v1's
   scope rather than deferred.

Their honest range for the full thing is 3–5 weeks; the v1 above is ~2.5 and
covers our docked panel completely.

### 1.4 · Region providers — `regionProviders`

**Lead with the receipt: you already ship this pattern.**

`SiteInfo`'s `<Switch>` splices addon routes *above* the non-exact Overview
catch-all (recon §3 and §8.1; their citation: `SiteInfo/index.tsx:464-495`, the
`doContent('routes[site-info]')` splice at `:486`, `RoutePlus path={match.path}/`
Overview at `:489`):

```jsx
<Switch>
  <RoutePlus path={`${match.path}/database`} … />
  <RoutePlus path={`${match.path}/backups`} … />
  <RoutePlus path={`${match.path}/tools`} … />
  {HooksRenderer.doContent.call(this, 'routes[site-info]', { routeChildrenProps })}
  <RoutePlus path={`${match.path}/`} component={SiteInfoOverview} … />
</Switch>
```

Addon content takes priority; Local's own screen is the fail-open fallback.
`React.Children.forEach` flattens the returned array, so each addon route
participates individually in `Switch` ordering. That is the principle we are
asking to generalise, and it is already in production in your own code. We are
asking for it at a *safer* granularity.

**We are not asking for route or screen ownership.** We asked for it; your
architect refused it and was right, and we are recording the reasoning here so
nobody has to re-derive it (recon §9, "Wrong-shaped"):

- A route is not a screen. `/main` renders `MainPage`, which owns `Window`,
  `MainDragDrop`, `MainVerticalNav`, `ProductDrawer`, `SitesSidebar` and the inner
  `Switch` (`MainPage.tsx:154-202`). Claiming the route means inheriting
  responsibility for all of that chrome. Nobody wants that, including us.
- The screens have no uniform contract. Each gets a hand-assembled `componentProps`
  bag (`MainPage.tsx:93`, `:98`, `:120-121`), and `SelectSite` in particular drives
  selection state that flows back to the main process (`App.tsx:162-169`, `:171-197`).
- "Fail-closed fallback to Local's own screen" contradicts what the existing
  boundary does: `ErrorBoundaryDialog` renders null and navigates away
  (`ErrorBoundaryDialog.tsx:15-31`), and `RoutePlus` wraps every route in it
  (`RoutePlus.tsx:24-33`). Real route-level fallback would mean a second,
  semantically opposite boundary in a tree where the existing one is everywhere.
- A route-level takeover is all-or-nothing and unversionable: you could never
  change what `/main` renders again without breaking whoever owns it.

**What we are asking for instead:**

```ts
registerRegionProvider('main.siteList.body', {
  id: 'nexus.fleet',
  match: (ctx) => boolean,      // sync, cheap, must not throw
  render: (ctx) => ReactNode,   // ctx is Local's own typed props
});
```

Local renders the highest-priority provider whose `match` returns true. **A
region-local error boundary falls back to Local's built-in body and logs** — which
is true fail-closed, because a region fallback is well-defined in a way a route
fallback is not. Props assembly stays in your hands, so the contract is typeable.
Chrome, sidebar and nav stay consistent. Each region is independently versionable.

**One region in v1: `main.siteList.body`.** That is the surface we actually want —
the site list's body showing what needs attention, rather than us owning
`MainPage`. Their sizing: ~2 weeks for the mechanism plus ~0.5 per region exposed.

**A note on mechanism, because your own direction points away from one of them.**
`CreateSiteStore.ts:121` and `:141` both carry *"TODO: remove the hook once addons
have been updated to use store actions"*, and `updateCreateSiteDefinitions`
(`renderer.d.ts:140-142`) is the replacement shape (recon §1). We read that as the
team moving from filter hooks toward MobX store actions, and we would rather these
four items land in the direction you are already going than add four new filter
hooks you will want to remove. If a store-action shape is the preferred mechanism
for any of the above, that works for us — the requirement is the *name and the
contract*, not the delivery mechanism.

---

## 2 · A written removal path, per item

> *"What happens to Local's UI when Nexus is disabled, uninstalled, crashes on
> load, or is running against a host two versions newer? For each of the four
> asks. This is the question that actually decides it, and it's the one addon
> proposals reliably skip."* — recon §9

Four items × four scenarios. Concretely, and with the design property that makes
each answer true rather than aspirational.

### 2.1 · Theme tokens

| Scenario | What Local's UI does |
|---|---|
| **Disabled** | Nothing changes. The tokens are Local's own values, published to `:root` and to the addon context regardless of whether any addon reads them. There is no registration to unwind. |
| **Uninstalled** | Nothing changes, for the same reason. This item is a *publication*, not a contribution — which is why it is the one item with no failure mode at all. |
| **Crashes on load** | Nothing changes. A read cannot fail the writer. |
| **Host two versions newer** | Our probe requires `themeTokens >= 1` and ignores unknown members, so a `themeTokens: 2` host serves us as long as v1 names survive — which is the alias commitment in §6. If the member is absent (rolled back), we fall back to reading `Theme__Dark` off `<html>`, which is what we do today and which is pinned by an explicit backwards-compatibility comment at `ThemeCop.ts:55`. |

### 2.2 · Rail slot

| Scenario | What Local's UI does |
|---|---|
| **Disabled** | The rail renders its own nine items and nothing else. Because the slot is MobX-observable (requirement 1.2a), deregistration re-renders the rail immediately — the item does not linger until an unrelated re-render, which is exactly the failure the reactivity requirement exists to prevent. |
| **Uninstalled** | Same, plus no addon code is loaded at all. `AddonLoaderService`'s semver gate already makes a failing addon invisible rather than degraded (`AddonLoaderService.ts:282-292`). |
| **Crashes on load** | **The rail renders without our item and the user stays where they are.** This is the whole point of requirement 1.2b: today a throwing content callback navigates the user to `/main` and shows a native error dialog. Per-item isolation converts our crash from "the user loses their place" into "one icon is missing". We consider the isolated behaviour part of the ask, not a nice-to-have. |
| **Host two versions newer** | Unknown capability members are ignored by our probe. If `mainVerticalNav` is absent — an older host, or a rollback — we render no rail item at all *once our stated Local floor has passed the release that introduced the slot*; before that, our current injection still runs. The floor is what makes this safe and it is proposed in §5. |

### 2.3 · Layout reservation

| Scenario | What Local's UI does |
|---|---|
| **Disabled** | The reservation is released and `Window`'s inset returns to the stylesheet's `right: 0`. Content reflows to full width. |
| **Uninstalled** | Same. Nothing persists, because **v1 has no persistence** — which we now regard as a safety property rather than a scope cut: a grant that survived a restart could outlive the addon that requested it and leave a permanently narrowed window with nothing to blame. |
| **Crashes on load** | No reservation is ever made; the window is full width. If we crash *after* reserving, the shell must release on unmount/teardown — we are asking for release-on-teardown as part of the contract, because we cannot guarantee we get to clean up after ourselves. |
| **Host two versions newer** | Without the member we do not call it, and the panel overlays instead of reserving. That is already our fallback today when `.Window` is not found, so the degraded path is the one currently in production and is tested. |

### 2.4 · Region providers

| Scenario | What Local's UI does |
|---|---|
| **Disabled** | No provider is registered; Local renders its own site-list body. Nothing has been replaced — a provider is a render-time lookup, not an installation. |
| **Uninstalled** | Same. |
| **Crashes on load** | Two distinct guards, because there are two ways to fail: a `match` that throws is treated as `false` (which is why `match` is specified as sync, cheap and non-throwing — a provider that cannot say whether it applies does not apply); a `render` that throws is caught by the region-local boundary, which falls back to Local's own body and logs once. **The user sees Local's site list.** |
| **Host two versions newer** | A region id we know that the host no longer exposes simply never matches, and our provider is inert; region ids we do not know are irrelevant to us. This per-region granularity is precisely what route ownership could not offer — there, a rename is a broken screen. |

---

## 3 · We will take on the regression net

> *"You already have 20 Playwright suites in this repo. Offer to extend them to
> cover each new surface, including the disabled/uninstalled/throwing paths. An
> API with host-repo tests attached is an API someone can refactor around; one
> without is a landmine, and the team knows it."* — recon §9

There are 20 `addons-nexus-ai-*.playwright.ts` suites in Local's master branch
today, alongside `addons-notes`, `addons-preflight`, `addons-table-plus` and
`addons-xdebug-vscode` (recon §8.6). We wrote them; we maintain them; and as your
architect notes, they are *also* our exposure, because they encode the DOM
assumptions §7 of the recon rates as fair game.

**What we commit to, per item:**

- A suite covering the surface working — a contributed rail item renders and
  navigates; a reservation is granted and content reflows; a provider renders and
  the fallback does not.
- A suite covering each removal-path row in §2 that is observable from the UI:
  **disabled, uninstalled, and throwing**. The throwing case is the one we most
  want in your repo rather than ours, because it asserts a property of *your*
  boundary, not of our code.
- Deletion of the DOM assertions that the corresponding retired reach required.
  The suites get smaller as §5's ledger empties.

**This is an offer, not a change already made.** This packet writes nothing into
Local's repository. We will open the PRs on your schedule and against your review;
if you would rather these live elsewhere, tell us where.

---

## 4 · Dual-track, demonstrated before you change anything

> *"Prove the capability probe degrades cleanly against 10.1.1 — where every probe
> returns undefined and you fall back to your current path. That converts 'will
> this fork our addon ecosystem?' from an objection into a demonstrated
> non-issue."* — recon §9

Done, and shipping in our branch now — before this proposal, deliberately, so that
the question is answered by a measurement rather than by a plan.

- `src/renderer/hostCapabilities.ts` reads `context.capabilities` when present and
  records `context.environment.version` alongside as the fallback signal.
- **`has()` never reads the version.** A capability is never inferred from a
  version in either direction: a host at 99.0.0 advertising nothing gets every
  guest path, and a host at 9.0.0 advertising `themeTokens` gets the contract path.
  Both are pinned by tests, and a mutation that wires a version comparison into
  the answer is killed by them.
- Unusable levels (`0`, negative, fractional, `'1'`) are **dropped rather than
  treated as presence**, because a member we cannot read is not support.
- A malformed or hostile context degrades to the guest track rather than throwing.
  An addon that crashes while asking what the host supports has answered the
  question badly.
- The test suite drives **both** tracks: a mock host advertising all four members,
  and the stock 10.1.1 context shape, where every probe is `undefined` and every
  guest path runs unchanged. 52 tests across three suites; 20 of 20 mutations
  killed.

Alongside it we have inventoried every place we reach into Local's DOM — see §5 —
and both the probe and the inventory are enforced by our build. The dual-track
claim is therefore not a promise about future discipline; it is a property our CI
fails without.

---

## 5 · What we will stop doing, and when

> *"Name the MutationObserver injection, the `.Window` mutation, the hashed-class
> selector — and commit to deleting each one when its replacement lands, with a
> version. A proposal that removes fragile coupling is a very different
> conversation from one that adds surface area. This is the single highest-leverage
> paragraph you can write."* — recon §9

We have counted them. **Eleven open reaches, across nineteen marked lines in six
files**, plus **one** twentieth line for the single reach we are explicitly
keeping and disclosing. The list is not a
prose estimate: it is generated from our source by
`scripts/generate-dom-reach-inventory.ts` into
`docs/intelligence/dom-reach-inventory.json`, and our build fails if a reach
exists in code without a declaration, or a declaration exists without code. A new
reach cannot be added to our renderer without appearing in this table.

| Reach | What it depends on | Recon's stability read | Deleted at |
|---|---|---|---|
| `theme-class-read` | `Theme__Dark` on `<html>` | very likely (pinned by comment, `ThemeCop.ts:55`) | **Nexus 0.6.0** — `themeTokens ≥ 1` |
| `theme-class-css-scope` | `.Theme__Dark` as a CSS selector | same | **Nexus 0.6.0** — `themeTokens ≥ 1` |
| `nav-rail-injection` | `#Sidebar` + a child whose class contains `DragRegion` | id: likely · wrapper nesting: **coin-flip** | **Nexus 0.7.0** — `mainVerticalNav ≥ 1` |
| `nav-rail-observer` | a body-wide `MutationObserver` re-inserting our item when React drops it | (the one-shot registry is why it exists — §1, §10) | **Nexus 0.7.0** — `mainVerticalNav ≥ 1` |
| `nav-theme-css-scope` | `.Theme__Dark` + six palette values hand-copied from `VerticalNav.scss` | class: likely · copied palette: unassessed, drifts silently | **Nexus 0.7.0** — `mainVerticalNav ≥ 1` |
| `sites-sidebar-toolbar-button` | `[class*="SitesSidebar_Toolbar"]` | **fair game** (recon §7) | **Nexus 0.7.0** — folded into the rail item, or `mainVerticalNav ≥ 2` (a second slot) |
| `window-right-reservation` | `.Window`, and setting `right` on it | very likely — *"the oldest layout code in the app"* | **Nexus 0.8.0** — `layoutReservation ≥ 1` |
| `site-list-filter-css` | injected CSS hiding rows by `[data-site-id]` | unassessed — **and the reach with the largest blast radius: it hides your content** | **Nexus 0.9.0** — `regionProviders ≥ 1` |
| `site-list-badge` | `[data-site-id]` rows + `.TID_SiteListSite_Span_SiteName` | TID_*: effectively public · row attribute: unassessed | **Nexus 0.9.0** — `regionProviders ≥ 1` |
| `window-data-location-read` | `.Window[data-location]` + a body-wide attribute observer | `.Window`: very likely · the attribute itself: **unassessed** | **Nexus 0.9.0** — `regionProviders ≥ 1` (or earlier, if a chrome slot supplies context first) |
| `tabnav-nowrap` | `[class*="TabNav_Items_"]` | *"better than 95% odds over two releases"* with the suffix dropped | **Nexus 0.9.0** — retired with our fifth site-info tab |
| *(kept)* `theme-root-attribute` | our own `data-ag-theme` on `<html>` — no Local name | not a Local dependency | **never** — declared as permanent guest behaviour, and excluded from the count above so it cannot make the number look better than it is |

**Already deleted, without waiting for anything from you:**

- The version-pinned `.TabNav_Items_ad_cY_v17-8-1` rule — it pinned 17.8.1 while
  you ship 17.8.2, so it had stopped matching and nothing said so. Now
  `[class*="TabNav_Items_"]`, and a build gate refuses any version-pinned
  `local-components` class in our source going forward.
- The theme class demoted from *source* to *fallback*: we read
  `localPreferences.currentThemeName` first.

**And one measurement we owe you, because the recon guessed generously about us
and we would rather be accurate:** we have never used a `MutationObserver` for the
theme — we were already on `osThemeChange`. Four observers exist in our renderer
and none of them watches the theme. We are recording that rather than claiming
credit for deleting something that was not there.

### The version floor, proposed for your ruling

A capability landing does not immediately let us delete a guest path, because
users on older Local builds still need one. So the ladder above reads *"deleted at
Nexus X.Y.0"* and the missing half is our supported-Local floor.

**We propose:** our floor moves once, at **Nexus 1.0.0**, to the first Local
release carrying all four capabilities. Guest paths for a given item are retained
until then and deleted at the version named above only for hosts advertising the
capability — that is, both tracks stay live and tested until the floor moves, and
the ledger reaches zero *open* reaches at 1.0.0. If you would rather we hold an
older floor for longer, that is your call to make and we will re-cut the ladder
against it; what we need is a floor that exists, because without one the last
column is never reached and this section becomes decorative.

---

## 6 · The token rename problem, arriving with us

> *"If tokens become public API, the existing external consumers need a
> deprecation path. Arriving with that already thought through signals you
> understand you're asking the team to take on a contract, not just write code."*
> — recon §9

The recon flags (§9, near-trivial) that external consumers already depend on the
current token names, so a rename needs an alias period. Here is the path we
propose, and it is deliberately the conservative one:

1. **Ship the existing names first, unrenamed.** The initial export is mechanical:
   whatever `_variables.scss` calls a value today is what the custom property and
   the `tokens` object call it. No consumer breaks on day one, and the release
   that introduces the API introduces zero renames — those are two changes and
   they should not travel together.
2. **Any better name arrives as an addition, never a replacement.** Both names
   resolve to the same value in the same release. This is exactly the practice
   `deprecatedHooks` already encodes for hook IDs, with version fields recording
   when each rename happened (`HooksRenderer.tsx:20-93`) — aliases from 2.3.3 and
   5.10.5 still honoured on 10.1.1, seven majors later.
3. **Generate the alias table from the token source.** This is the one place we
   would ask you to improve on the hook precedent rather than copy it. The recon
   found that `deprecatedHooks` *"advertises replacements for hooks that no longer
   have call sites"* — six dead IDs — and warns: *"If you read that map as a hook
   catalogue, you'll target six dead IDs. It is an alias table, not a registry."*
   A hand-maintained alias table drifts into advertising names that no longer
   resolve. A generated one cannot.
4. **We will be the canary.** We will consume the new names from the first release
   that offers them and report anything that does not resolve, before the alias
   period ends rather than after.

What we are *not* asking for: a rename of the ramp as part of this work. If the
names stay exactly as they are, every item in §1.1 still delivers everything we
need.

---

## 7 · Please write down the deprecation policy

> *"Getting 'hook IDs and chrome slots are semver-stable; renames get permanent
> aliases' written down — which merely codifies what's already been practised
> since 2.3.3 — is nearly free to grant and is worth more to you over five years
> than any of the four APIs."* — recon §9

This is the cheapest item here and the one we would take over any single API if we
had to choose.

**What exists today** (recon §6): `.github/CODEOWNERS` is a single wildcard rule —
there is no separate API owner. The API is hand-written `.d.ts` files in `app/api/`
with no codegen, no API-diff CI gate, and no contract test that types match
implementations. Publication is a script that copies files into the public
`local-addon-api` repo; cadence is *whenever Local ships*, because the version bump
is in the release pipeline (`azure-pipelines-build.yml:140-149`, `:269-298`). The
API is, in your architect's words, *"a byproduct of the app release, not an
independently governed artifact."*

**And there is no written deprecation policy.** What exists is a strong practice:
`@deprecated` JSDoc on ~13 `SiteJSON` properties (`index.d.ts:148-233`), the
`deprecatedHooks` alias table with its version fields, and in-tree accommodation
of specific named third-party addons — `SiteInfoTools.tsx:99-101` carries a param
*"only consumed by Broken Link Checker"*, and `SiteInfoOverview.tsx:218` branches
on whether the Atlas addon contributed. The recon's summary is the sentence we are
responding to: *"the de facto policy is 'renames get a permanent silent alias;
nothing is ever removed.' Very friendly, and — since it's undocumented and
unenforced — very fragile."*

**What we are asking for — one paragraph, in the repo:**

> Hook IDs, chrome slot names, region ids, capability member names and design
> token names are treated as public API. Renames ship with a permanent alias.
> Removal requires a major version and a release-note entry. The `capabilities`
> integers are additive: a breaking change to a capability takes a new member
> name rather than a higher integer.

That codifies what you have already done since 2.3.3 rather than asking for a new
commitment. If you would also accept a CI check that the published `.d.ts` names
have not disappeared, we will write it and hand it to you; a policy with a test is
the version that survives a re-org.

---

## 8 · Effort — your architect's numbers, not ours

These estimates are the Local architect's own, from recon §9. They are explicitly
*"my estimates, not the team's"*, for **one engineer familiar with the renderer,
including tests and a docs pass**. We are reproducing them rather than restating
them as our own, and we have no basis to revise them.

| Item | Their estimate |
|---|---|
| Theme tokens as values | 1 – 1.5 weeks; **~2 weeks** with the CSS custom properties, which they judge *"worth it"* |
| Named rail slot | 1.5 – 2 weeks for the rail; ~1 more for a second slot |
| Layout reservation | 3 – 5 weeks for the full thing — *"and the range is honest"*; **~2.5 weeks** for the v1 scoped in §1.3 |
| Region providers | ~2 weeks for the mechanism, plus ~0.5 per region exposed |

> *"Total, my scoping: tokens 1.5 + rail slot 2 + reservation v1 2.5 + region
> providers 2 ≈ **8 engineer-weeks for a v1 of all four**, versus roughly 12–15 if
> route ownership is taken literally."* — recon §9

**What we are deliberately not asking for**, so the scope is legible:

- No generic slot registry — one named rail slot, with an obvious extension path.
- No route or screen ownership — region providers instead, per §1.4.
- No second region beyond `main.siteList.body` in v1.
- **No bundled-addon status.** `bundledAddons.ts:8` is `const bundledAddons = [];`
  today, and the loader has a whole privileged path for bundled addons that skips
  the enabled-check (`AddonLoaderService.ts:304-309`, `RendererAddonLoader.ts:92-100`).
  The recon notes it as a lever that may be a shorter path than new hooks for some
  of what we want. We are not proposing it here: it is a product and distribution
  decision rather than an API one, and folding it into this ask would make a
  reviewable contract into a strategy conversation.

---

## 9 · What we are asking for, in one place

1. `capabilities.themeTokens: 1` — the ramp as CSS custom properties and
   `theme: { name, tokens }` on the addon context, `osThemeChange` as the signal.
2. `capabilities.mainVerticalNav: 1` — one named rail slot, item shape modelled on
   `AddonSettingsItem`, **MobX-observable**, per-item error isolation, active-state
   ownership fixed.
3. `capabilities.layoutReservation: 1` — `reserveEdge` on `Window`; right edge,
   main window, one reservation, no persistence, clamped; the shell reports what it
   granted; release on teardown.
4. `capabilities.regionProviders: 1` — `registerRegionProvider`, first region
   `main.siteList.body`, region-local boundary falling back to Local's own body.
5. **A written deprecation policy** — one paragraph, codifying the practice you
   have honoured since 2.3.3.

In exchange: eleven DOM reaches deleted on a published ladder, Playwright coverage
in your repo for every new surface including its failure paths, a dual-track
capability probe already shipping and already tested against stock 10.1.1, and the
token-rename path in §6 arriving with the ask rather than after it.

We are happy to bring any of this to a design review, to split it across releases
in whatever order suits your roadmap, or to write the first draft of the `.d.ts`
for any item you want to see spelled out before deciding.
