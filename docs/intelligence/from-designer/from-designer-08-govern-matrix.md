---
title: Cycle four — The Govern matrix, and two field fixes for the comparator
author: designer (Nexus AI UX)
source: Govern matrix.dc.html (design component, project "UX Prototyping for Intelligence Docs")
committed_by: architect, verbatim
date: 2026-08-19
answers: cycle four (M7 Govern) as framed in moments-companion-for-designer.md §3; the two field findings of 2026-08-19; the law-review note on rb.promotion-execute
status: ratified — nine pins inherited by WP-44; XD-25 registered; seven vocabulary rows ratified into v1.3; the law-review item re-scoped to four runbooks
---

# The Govern matrix

*M7 Govern · seven real capabilities, three grant states · 1440×1024*

The surface where consent about a capability is given, which is the one consent a conversation may never elicit. Every row is a capability the registry serves, its state from the grant record and its ceremony from the document — including the column that says what granting it would actually gate, whose honest answer indicts more than the law review expected.

Above the table, in the chrome: *Nothing here is granted because a document exists. A capability arrives denied, and becomes granted only by an act recorded on this list.*

## 5a · What agents may do

| Capability | State | The document it is pinned to | What granting it gates | |
|---|---|---|---|---|
| `cap.bulk_plugin_update` · strict procedure | **Granted** — control.grant.issued · evt_7a02 · 18 Aug, 09:12 | rb.bulk-plugin-update · 1.2.0 · strict · `sha256:0646cfe11c` | 4 of 8 checkpoints the platform can verify. 4 are on the agent's account only. | granted |
| `cap.incident_containment` · strict procedure | **Granted** — control.grant.issued · evt_7a03 · 18 Aug, 09:12 | rb.incident-containment · 1.1.0 · strict · `sha256:fedec1dfb1` | **The grant itself, and nothing after it.** All 5 checkpoints are narrative — the platform can verify none of them, so nothing downstream of this grant is provable. | granted |
| `cap.promotion_preflight` · strict procedure | **Disarmed** — control.grant.issued · evt_7a04 · 18 Aug, 09:12 | rb.promotion-preflight · 1.1.0 · strict · `sha256:ae5a1678d2` — no longer matches | **The grant itself, and nothing after it.** All 4 checkpoints are narrative. | granted |
| `cap.promote_environment` · production consequence | **Never by default** — Production consequence is not a default, so nothing but a grant you make yourself reaches this. | rb.promotion-execute · 1.1.0 · strict · `sha256:d5fa9bc67d` | **The grant itself, and nothing after it.** All 5 checkpoints are narrative. | denied |
| `cap.incident_remediation` · production consequence | **Never by default** — Containment is granted and remediation is not: stopping the bleeding and changing production are two different permissions. | rb.incident-remediation · 1.1.0 · strict · `sha256:bb707ba844` | **The grant itself, and nothing after it.** All 6 checkpoints are narrative. | denied |
| `cap.wpe_pull` · guided procedure | **Denied** — Guided documents carry no mandatory full-body ride, so nothing materialized this. Grantable by an entry you make. | rb.wpe-pull · 1.0.0 · guided · `sha256:0c052e155a` | 8 steps, none of them a checkpoint. A guided document is adapted as it runs, and deviations are recorded with their reason. | denied |
| `cap.diagnose_site` · guided procedure | **Denied** — as above. | rb.diagnose-site · 1.0.0 · guided · `sha256:f088ac3354` | 8 steps, none of them a checkpoint. | denied |

**The disarmed row carries its own band:** "Granted, and disarmed on an integrity failure. The document on disk is not the one this grant was made against. Not staleness — the review this grant carries happened against different text, so the capability behaves as though it were never granted." Door: *Re-grant against the current document.* The switch stays on: it renders the consent state, and the chip renders the force state.

### The finding, rendered rather than argued

**The gates column indicts more than one capability.** Four strict capabilities have no attestable checkpoint at all — `cap.incident_containment`, `cap.promotion_preflight`, `cap.promote_environment`, `cap.incident_remediation` — and two of them are granted today. Granting one of these gates the grant itself and nothing after it. That is not a rendering problem: it is what the documents say, and it is the strongest argument this surface can make for authoring attestable checkpoints before any of these grants is relied on.

**Two refusals already point at this list.** A scope block that barred 2 production cells lands on `cap.bulk_plugin_update` (production needs its own runbook version, which does not exist yet); a gated tool refused with a governDoor lands on `cap.promote_environment`. A door lands on the row, not on the top of this page — the row is the answer to the refusal that sent you here.

## 5b · Two field fixes for the comparator

**The all-absent matrix.** One sentence above the dashes, not inside them: "This file is a drop-in, so no place records a version for it. The dashes are not missing data — there is nothing here that varies by place," with the door *See what is recorded about drop-ins*. The line is derived from the fact's own class, not from counting how many cells came back empty.

**The history line, anchored.** It sits inside the site's own row — indented under the site name, on a rule that stops at the row's edge. Full-width separators read as belonging to the table; this reads as belonging to coolagency, which is what it is a fact about.

## The pins this surface owes · J-Refusal's four remaining criteria

- Every row is a capability the registry serves, and every fact on it is derived: the document, its version, its pinned hash, and the attestable-versus-narrative split from the checkpoints themselves.
- A capability arrives denied. No row is granted because a document exists, and the surface says so in the words the deny-flip made true.
- The two production capabilities render as never-granted-by-default rather than as ordinarily denied — a disclosed row a user can act on, never a quiet absence.
- A door from a refusal lands on the row, not on the top of Settings, and the row is the answer to the refusal that sent you here.
- A grant states which act made it and when, from its own `control.grant.issued` event.
- A disarmed grant renders as granted-and-disarmed with the reason, never as denied: a hash that no longer matches is an integrity failure, not a permission the user withdrew.
- The gates column is derived from the document and never softened. Zero attestable checkpoints renders as what it is, on granted rows as loudly as on denied ones — and the column moves when the document does.
- The act is a control on this surface. Nothing on this page can be reached, widened or confirmed from a conversation.
- Every widening is recorded and reversible from the same row that made it.

## What is absent, and on purpose

- No grant-all, no recommended set, no bulk enable. A widening is one capability at a time because that is the unit a person can weigh.
- No conversational route in or out. Chat may walk you to this page and say what is behind it; it is not the door.
- No invented capability labels on the sheet as drawn. The id is the vocabulary the refusals already use, and a friendlier name would be authoring at the most consequential words on the surface — the label set was proposed through the loop instead, and is now ratified with the id kept visible in mono beside it.
- No hiding of ungranted capabilities. A capability with no grant is a row, because a row is the only thing a user can act on.
- No severity theatre on the production rows. They are denied by rule, and the rule is stated once rather than dressed in red.
- No count of grants as a health score. Three of seven granted is not a posture to improve; it is a record of what was decided.
- No copy of the runbook here. The document is named, hashed, and one door away.

## Design-system note

The state chip is the bound system's `Chip` at `size=xs` (neutral for granted and denied, `error/strong` for disarmed, `warning/subtle` for never-by-default) and the act is its `Switch` at `size=md`. The commentary cards — the law-review finding and the arrivals list — sit outside the 1440×1024 window as sheet annotations, because neither is Settings chrome.

## The three asks, since ruled

The seven human labels are ratified as vocabulary rows with the id kept in mono beside them. The gates wording stands unsoftened, with the derivation property — the column moves when the document does — load-bearing as the pin rather than the sentence. The disarmed switch stays on: the switch renders consent, the chip renders force, and the band with its door says "granted but not in force" better than a second label would.
