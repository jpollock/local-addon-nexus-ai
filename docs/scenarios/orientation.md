# Orientation Scenarios

The user wants to understand what they have across their fleet. These are "inventory" moments — the user isn't looking for specific content, they want a situational picture of their sites.

---

## S-M2-01 · Show me all my sites

**Type:** Positive | **Frequency:** weekly | **Stakes:** low  
**Eval case:** `M2-01-orientation-all-sites`

### Situation
A developer wants a single unified view of their entire WordPress portfolio — local and WPE — in one answer. They may be starting a work session or onboarding a new collaborator.

### What I know
- I have local sites in Local
- I may or may not have WP Engine sites

### What I don't know
- Exact count on either side
- Which local sites have WPE counterparts
- Which are running right now

### Intent
Get a complete picture of my fleet in one place without switching between tools.

### Success looks like
- All local sites listed (name, domain, running/halted)
- WPE installs surfaced intelligently if connected — notable ones with local counterparts called out, not all 300+
- Clear grouping: local vs WPE, with cross-references where they exist
- Total counts given ("8 local, 306 WPE installs")
- If WPE not connected: local-only result is complete, not partial

### Failure looks like
- Lists all 306 WPE installs without summarizing
- Returns stale data without acknowledging it
- Shows nothing because WPE isn't connected

### Signals
- Did it list all local sites?
- Did it surface local↔WPE pairings intelligently when WPE is connected?
- Was local-only a complete answer when WPE isn't connected?

---

## S-M2-02 · Which of my local sites are running?

**Type:** Positive | **Frequency:** daily | **Stakes:** low  
**Eval case:** `M2-02-orientation-running-sites`

### Situation
A developer is about to do work and wants to know which sites are currently active without opening Local.

### What I know
- I have some number of local sites
- Some are running, some are not

### What I don't know
- Which ones are currently running
- How to start the ones that aren't

### Intent
Know immediately which sites are available for work, and how to start others if needed.

### Success looks like
- Clear running vs halted split
- Domain listed for running sites (so I can open them in a browser)
- Start command offered for halted sites
- If all running: confirm that, offer next action

### Failure looks like
- Lists only running sites and silently omits halted ones
- Returns "no sites running" without listing the halted ones
- Starts sites without being asked

### Signals
- Did it cover all sites (not just running ones)?
- Did it offer the start command for halted sites?

---

## S-M2-03 · Which sites need WordPress updates?

**Type:** Positive | **Frequency:** weekly | **Stakes:** high  
**Eval case:** `M2-03-orientation-wp-updates`

### Situation
A developer is doing maintenance planning and wants to know which sites across their fleet are behind on WordPress core. WPE may or may not be connected.

### What I know
- WordPress releases new versions periodically
- I have local sites, and possibly WPE sites

### What I don't know
- What the current latest WordPress version is
- Which of my sites are behind and by how much
- Which are most urgent

### Intent
Get a prioritized list of sites that need WordPress updates, so I can plan maintenance.

### Success looks like
- States the current latest WP version
- Lists local sites behind, grouped by how far behind
- If WPE connected: lists WPE sites behind, filtered to most critical
- Distinguishes release candidates from stable versions
- If WPE not connected: local-only result is complete and clearly scoped

### Failure looks like
- Lists all WPE sites regardless of update status
- Doesn't state what "up to date" means
- Checks running local sites only and skips halted ones
- Reports failure because WPE isn't connected

### Signals
- Did it state the current latest version as a reference point?
- Did it filter to sites that actually need updates?
- Was WPE-not-connected handled gracefully (local-only, not an error)?

---

## S-M2-04 · Which of my sites have a specific plugin?

**Type:** Positive | **Frequency:** occasional | **Stakes:** medium  
**Eval case:** `M2-04-orientation-plugin-search`

### Situation
A developer needs to audit which sites across their fleet have a specific plugin installed. They might be doing security patching, planning a migration, or identifying a dependency.

### What I know
- The plugin name I'm looking for (e.g. WooCommerce)
- I have local sites, and possibly WPE sites

### What I don't know
- Whether the plugin is installed on any of my sites
- Whether it's active or just installed
- Whether WPE data is in cache

### Intent
Get a complete list of which sites have this plugin, across both local and WPE.

### Data tiers (system responsibility, not user concern)
The system should try each tier transparently, from richest to leanest:
1. **Cached data** (index/graph/digital twin) — fastest, may be stale
2. **SSH via MCP/CLI** — if WPE authenticated and cache is empty, fetch live plugin data
3. **Name heuristics** — last resort for WPE; clearly labelled as inferred, not confirmed

### Success looks like
- For local: checks all sites, using filesystem scan for halted ones if no cache
- For WPE (if connected): uses cache → SSH fetch → name heuristics, in that order
- Distinguishes confirmed from inferred results
- Is honest about data freshness when using cache

### Failure looks like
- Jumps to name heuristics without attempting SSH fetch when authenticated
- Claims confirmed plugin data it doesn't have
- Only checks running local sites and ignores halted ones
- Reports "can't check" and stops

### Signals
- Did it use the richest available data source for each site?
- Were inferred results (name heuristics) clearly labeled as such?
- Did it cover halted local sites via filesystem scan or cache?

---

## S-M2-N1 · Plugin query when all sites are stopped

**Type:** Negative | **Frequency:** daily | **Stakes:** low  
**Eval case:** `M2-N1-orientation-all-halted`

### Situation
A developer wants to check plugin presence but all their local sites are halted. The system should use every available data source before reporting limited results — and should never report nothing when filesystem data is available.

### What I know
- Which plugin I'm looking for
- All my sites are currently halted

### What I don't know
- What data the system has cached from previous runs
- Whether a filesystem scan can answer the question

### Intent
Get a useful answer about plugin presence even when sites aren't running.

### Data available for halted local sites (system responsibility)
Even when halted, local sites have data available:
1. **Cached index/graph data** — from last sync when site was running
2. **Filesystem scan** — plugin directories are readable on disk even when the site isn't running

The system should use both and never report "no data" for a local site just because it's halted. The user shouldn't need to know which path was taken.

### Success looks like
- Uses cached data and/or filesystem scan to answer from available sources
- Reports what was found with appropriate freshness note
- Does not attempt WP-CLI (database queries require running site)
- Offers to rescan when sites are running for live confirmation

### Failure looks like
- Attempts WP-CLI on halted sites and errors
- Returns "can't check halted sites" when filesystem data is available
- Claims certainty from stale data without caveating it

### Signals
- Did it use filesystem scan or cached data rather than failing?
- Was data freshness noted?
- Was WP-CLI appropriately skipped?

### Key insight
Halted ≠ no data. A filesystem scan can read plugin directories on disk. Cached graph data persists across restarts. The system should always have *something* to offer for a local site regardless of running state.
