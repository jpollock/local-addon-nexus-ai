# Intelligent Web Integration — User Journeys

Three journeys frame *why* we're integrating Nexus with the Intelligent Web (IW). Each is a real
person with a real starting point; the plan (`plan.md`) exists to move them along these arcs. Facts
cited here are established in [`findings.md`](./findings.md); vocabulary in [`concepts.md`](./concepts.md);
unresolved mechanics in [`decisions.md`](./decisions.md).

Every journey uses the same template so we can compare them:

- **Actor** — who they are and what they host on.
- **Starting state** — what's true before Nexus touches anything.
- **Friction today** — why the current path is painful.
- **Desired end state** — the outcome we're building toward.
- **Where Nexus fits** — the specific role Nexus plays (and where it deliberately doesn't).
- **Flow** — the concrete step sequence.
- **Dependencies** — what must be true / decided first (→ `decisions.md`).

> **North star, stated once:** Nexus is the *authoring and operations cockpit* in Local. IW (Power +
> Extend) is the *runtime and distribution* on WP Engine's platform. Nexus's job across all three
> journeys is to make the on-ramp from "building on my laptop" to "running on WP Engine's IW"
> feel like one continuous motion — **without forcing the customer onto WPE hosting to get value.**

---

## Journey 1 — The non-WPE customer who wants IW

**Actor.** A developer or agency running WordPress sites hosted **somewhere other than WP Engine**
(SiteGround, Kinsta, a VPS, whatever). They use Local for development. They are *not* a WPE hosting
customer and may never become one.

**Starting state.** They have a WP Engine account (free to create) and a Power **project** with a
`wpe_` API key. Their production sites live off-platform. They've heard IW can add AI features —
chat, knowledge-base grounding, content tooling — to any WordPress site.

**Friction today.** To use Power on an off-platform site they must install the **Hub Plugin**
(brand: **Extend**) by hand, complete a browser OAuth handshake, pick an account and a project, and
hope the connection sticks. The Hub Plugin isn't on wp.org (→ `decisions.md`), so even *finding* it
is friction. Nothing about this is discoverable from inside their dev environment.

**Desired end state.** From Local, they point Nexus at a site, and Nexus gets that site **connected
to Power** — Hub Plugin installed and registered — so Power-backed AI features light up. The site
shows as **Platform: External** in the Power Console and works exactly like a WPE-hosted one for AI
purposes. ✅ (We verified external sites connect and function.)

**Where Nexus fits.**
- Nexus **automates everything around the unavoidable browser step**: detect whether the Hub Plugin
  is present, install/activate it, surface the "Connect" affordance, then read back
  `client_id` / `project_id` / connection status via `wpe_auth_*` once the user returns.
- Nexus **does not** replace the OAuth handshake — PKCE + the account/project pickers happen in the
  browser (→ `decisions.md`: can Nexus host the callback?).
- Nexus can then offer Power as a **per-site WP AI provider** (Layer 1) *and* index the site into a
  **Power KB collection** using the same batched sync the Hub Plugin ships (`findings.md` §4).

**Flow.**
1. User selects a site in Nexus → "Connect to WP Engine AI."
2. Nexus checks for the Hub Plugin; installs + activates it if missing (→ `decisions.md`: bundle vs PIS).
3. Nexus opens the Hub settings "Connect" flow; user completes PKCE + picks account/project in browser.
4. Nexus polls `is_connected()` / reads `wpe_auth_*`; on success, records the project binding.
5. Nexus offers: set Power as this site's WP AI provider; index content into a KB collection.

**Dependencies.** Hub Plugin distribution path; whether Nexus can drive/host the OAuth callback;
credential storage for the resulting connection. All in `decisions.md`.

---

## Journey 2 — The non-WPE customer who goes all-in on WP Engine

**Actor.** The Journey-1 developer, one step further along: they've decided to **build on Local with
Nexus and ship the result to WP Engine's platform** — including custom **agents** — even though they
started off-platform. This is the "convert to WPE" arc.

**Starting state.** They have a working site (and possibly a Nexus-authored **agent** — e.g. a
security-sentinel or SEO agent from the Nexus Agent SDK) running locally. They want it live on WPE.

**Friction today.** There is no bridge from "a Nexus agent running in Local" to "a workload running
on WP Engine." Agents run only on the user's machine. Deploying WordPress itself to WPE is a manual
push/pull; deploying an **agent** has no story at all.

**Desired end state.**
- The WordPress site is on WPE (existing push/pull, out of scope here).
- Any **Nexus-authored agent** the customer wants to run in production is **deployed to WPE Atlas**
  (the Headless/node platform) — *not* registered as a Power "Managed Agent." Nexus agents → Atlas is
  the confirmed product direction (`findings.md` §4–§5).

**Where Nexus fits.**
- Nexus is the **agent authoring environment** — `nexus agent create` already scaffolds a runnable
  agent with a `README.md`, and the SDK gives it `ctx.tools/ai/state/db/credentials`.
- The **new capability** is a **build + upload to Atlas** step: package the agent, create/target an
  Atlas app + environment, upload the build zip (`js.wpengineapi.com`, Basic auth — `findings.md` §5).
- Nexus explicitly **does not** push agents into the Power **Agent Registry** — that's a separate,
  non-Nexus product surface. Nexus may *read* the registry for context only.

**Flow.**
1. User authors/tests an agent locally in Nexus.
2. User: "Deploy this agent to WP Engine."
3. Nexus builds the agent bundle; ensures an Atlas app + environment exist (creates if needed).
4. Nexus uploads the build to the environment; reports the live URL/status.
5. (Optional) The site, now WPE-hosted, is also connected to Power per Journey 1/3.

**Dependencies.** Atlas upload contract for a Nexus agent (entry point, runtime, env/secrets) — 🟡
in `findings.md` §5, tracked in `decisions.md`. Also: how agent secrets/credentials cross the
Local→Atlas boundary.

---

## Journey 3 — The existing WPE customer adding IW + Nexus

**Actor.** An established WP Engine **hosting** customer with one or more production installs. They
already have a WPE account, CAPI access, and (likely) portal `wpe_` keys. They're adding **IW** to
sites they already run, and adopting **Nexus** in Local as the cockpit.

**Starting state.** Sites are WPE-hosted and already visible to Nexus's WPE tooling (installs synced
to graph.db). They may or may not have Power projects yet. They have the smoothest possible on-ramp
because the account/billing relationship already exists.

**Friction today.** Even for a WPE customer, turning on IW per-site still means the Hub Plugin +
browser handshake, and there's no unified place that shows "which of my installs are IW-connected,
to which project, with what enabled." Nexus already inventories their fleet — but it's blind to IW
state.

**Desired end state.**
- Nexus shows, per install, **IW connection status** (connected? which project? KB collections?
  agents in the registry?) alongside the existing fleet health it already tracks.
- Turning IW on for an install is a **one-surface action** from Nexus.
- Power becomes a **first-class option in Nexus's own preferences** (Layer 2) so the customer can
  route Nexus's ctx.ai / chat / agent inference through Power too — not just per-site WP features.
- Because these are WPE installs, Nexus can use **copyinstall** (`db_tables` surgical extraction) to
  pull just what an agent needs for analysis instead of a full local clone (`findings.md` §5).

**Where Nexus fits.**
- Nexus is the **fleet-wide IW dashboard** — it already knows the installs; IW state is one more
  dimension to read (via the `wpe_` key + `WPEngine-Project` header) and display.
- Nexus offers **Power as a Layer-2 provider** in preferences (the requested feature).
- For per-site WP features, Nexus **still presents provider choice** — Power, Local Gateway, or
  another provider. **Do not assume Power** even for WPE customers (standing product guidance).

**Flow.**
1. Nexus reads fleet (existing) + overlays IW connection status per install.
2. For an unconnected install: same connect flow as Journey 1 (Hub Plugin + handshake).
3. Customer optionally sets **Power as Nexus's Layer-2 provider** in preferences.
4. Per site, customer still picks the WP AI provider (Power / Local / other).
5. Nexus uses `copyinstall` for agent-driven analysis where a data pull is needed.

**Dependencies.** `wpe_auth_account_id` ⇔ CAPI account link (🟡 `findings.md` §3) to correlate IW
projects with the installs Nexus already tracks; scope of "Power as Nexus Layer-2 provider."

---

## What the journeys share

| Thread | J1 (non-WPE, wants IW) | J2 (non-WPE → all-in WPE) | J3 (existing WPE + IW) |
|---|---|---|---|
| Needs Hub Plugin + handshake | ✅ | ✅ (for the site) | ✅ |
| Power as **per-site** WP provider (L1) | optional | optional | optional — **user choice, not assumed** |
| Power as **Nexus** provider (L2) | possible | possible | ✅ requested |
| Deploy **agents** | — | ✅ **→ Atlas** | possible → Atlas |
| Uses **Agent Registry** as write target | ❌ | ❌ | ❌ (read-only at most) |
| `copyinstall` for analysis | ❌ (not WPE) | after migration | ✅ |

**Two invariants across all three:**
1. **Nexus never writes to the Power Agent Registry.** Agents are a Nexus→Atlas story.
2. **Provider choice is the user's.** Power is an *option* Nexus makes easy — never a default we
   force, at either layer.
