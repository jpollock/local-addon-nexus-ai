# Build order

Sequenced so each step ships on its own and nothing depends on a decision that has not been made
yet. Steps 1–2 are worth doing whatever else you conclude.

## 1. Stop the bleeding (days)

No new surfaces. Each of these is a bug in the current build.

- **Fix the health calculation.** Roll up agent run status, stale syncs and credential failures.
  Report *unknown* rather than green when an input is missing. Today Activity says "All Systems
  Healthy" while an agent fails hourly.
- **Aggregate repeated agent failures** into one entry with a count and time range, put the raw
  command or stack behind a disclosure, and auto-pause an agent after N identical consecutive
  failures.
- **Filter auto-drafts and revisions** out of the event timeline, and omit the actor field rather
  than printing `UNKNOWN`.
- **Sort Operations by what is stale or failing** instead of arrival order.
- **Put the pending-review count on the rail badge** so it is visible without opening Nexus.
- **Delete Ask/Tell** and the dashboard prompt box. Three chat entry points collapse to the panel.

## 2. One vocabulary, one number

Mostly naming and a shared selector. Unblocks everything after it.

- Collapse the six knowledge vocabularies to **Basic / Detailed / Searchable**, freshness separate.
- Define the canonical fleet count and scope **once**; make every label read from it. Start by
  writing down what each of the six current numbers is scoped to — that audit is still open.

## 3. The panel

The highest-value piece, and the infrastructure already exists — `DockedPanelContainer` is already
globally mounted over the whole app.

- Add the **Insights** tab alongside Chat; make it context-aware (fleet vs current site).
- Add **wide** and **full** sizes; keep one conversation across all three.
- Have Insights read live from the background-job settings rather than restating them.

## 4. Inbox

- New destination aggregating approvals, findings and failures across all agents.
- Inline decide/undo; plain-language titles; evidence behind a disclosure.
- Per-agent pending counts derive from this list.

## 5. Sites

- One table replacing the Operations list and the dashboard fleet cards.
- Add the **External** host type end to end: model, filters, table, counts, first run.
- Bulk actions on a selection; Operations retires.

## 6. Settings and agents

- Merge the two settings homes; build Background work with derived cost figures.
- Rewrite the agent cards; keep the existing configuration behind an Advanced link.
- Move MCP, ports, index internals and reset to Advanced.

## Not in this package

**Staging and revert.** Named as a precondition for letting non-developers act, and deliberately
not designed yet — see DECISIONS.md.
