# Compare Scenarios

The user needs to choose between multiple sites or understand how they relate to each other. These are decision-support moments — the user has options and needs Nexus to help them pick or map.

---

## S-M5-01 · Rank my sites by content volume

**Type:** Positive | **Frequency:** occasional | **Stakes:** low  
**Eval case:** `M5-01-compare-content-volume`

### Situation
A developer wants to understand the relative scale of their sites — which has the most content, which are essentially empty. This helps prioritize indexing, understand data quality, and set expectations for search results.

### What I know
- I have multiple local sites
- They probably have different amounts of content

### What I don't know
- Exact post/page counts per site
- Whether all my sites are indexed
- What "most content" means — posts only, or all content types?

### Intent
Get a ranked list of my sites by content volume, with enough context to interpret the numbers.

### Success looks like
- Ranks all indexed sites by document count (posts + pages + CPTs)
- Shows chunk count alongside doc count (indicates content richness)
- Correct interpretation: high count on a test site is seeded data, not real content
- Clearly separates indexed sites (can rank) from unindexed sites (can't rank, noted)
- Does not present unindexed sites as having zero content

### Failure looks like
- Ranks unindexed sites as 0 content (misleading — unknown ≠ empty)
- Silently omits unindexed sites
- Returns only the top result instead of a full ranking

### Signals
- Were all indexed sites included in the ranking?
- Were unindexed sites called out separately?
- Was the interpretation of the data accurate (test site = seeded data)?

---

## S-M5-02 · Which copy of this project should I work in?

**Type:** Positive (with graceful-failure expected when sites don't exist) | **Frequency:** occasional | **Stakes:** high  
**Eval case:** `M5-02-compare-which-copy-to-use`

### Situation
A developer has multiple local site versions of a client project — possibly a production copy, a staging copy, and an old backup. They need to know which one to use for active development.

### What I know
- The approximate names of the site copies
- That I want the most current/active one for development

### What I don't know
- Which has the most recent content
- Which is linked to WPE production
- Which was last modified

### Intent
Get a clear recommendation on which site to work in, based on available evidence.

### Success looks like
- Checks all named sites — doesn't assume without looking
- Uses multiple signals: WP version, post count, index recency, WPE link, running status
- Factors in environment naming (site named "-staging" is likely not for active dev)
- Recommends one with explicit reasoning
- If named sites don't exist: shows what does exist and offers the closest matches

### Failure looks like
- Recommends one site without checking the others
- Ignores environment naming as a signal
- Claims certainty when signals are ambiguous
- Errors when site names don't match exactly instead of trying fuzzy match

### Signals
- Did it check all named sites?
- Did it factor in both data signals and naming conventions?
- If sites don't exist: did it show alternatives rather than just saying "not found"?

---

## S-M5-03 · Map my local sites to their WPE counterparts

**Type:** Positive | **Frequency:** occasional | **Stakes:** medium  
**Eval case:** `M5-03-compare-local-wpe-mapping`

### Situation
A developer wants a clear picture of which local sites are connected to WPE environments and which exist only locally. Useful for understanding pull/push readiness and identifying orphaned local sites.

### What I know
- I have local sites
- I may have WPE installs

### What I don't know
- Which local sites are formally linked to WPE
- Which local sites have no WPE counterpart
- Which WPE installs have no local copy
- How to distinguish formal links from name similarities

### Intent
Get a clear three-way map: formally paired, local-only, and WPE-only — plus probable informal matches.

### Success looks like
- Shows formally linked pairs (configured in Local's Connect drawer)
- Shows local-only sites (not linked to WPE)
- Shows probable matches by name/domain even without formal link
- Labels confidence level: confirmed link vs inferred match vs unmatched
- If WPE not connected: local-only result is complete, clearly scoped

### Failure looks like
- Treats name-similar sites as confirmed pairs
- Shows only formally linked pairs and misses probable matches
- Reports failure because WPE isn't connected

### Signals
- Were all three groups represented (linked, local-only, probable)?
- Was confidence clearly labeled (formal link vs name inference)?
- Was WPE-not-connected handled as a valid scoped result?

---

## S-M5-N1 · Compare sites that don't exist

**Type:** Negative | **Frequency:** occasional | **Stakes:** low  
**Eval case:** `M5-N1-compare-sites-dont-exist`

### Situation
A developer asks to compare sites by name, but none of those names exist in their fleet. They may have the wrong names, the sites may have been deleted, or they may be on a different machine.

### What I know
- The names of the sites I want to compare
- That I expect them to exist

### What I don't know
- Whether the names are right
- Whether the sites exist at all
- Whether they might be on WPE instead of local

### Intent
Either compare the sites I named, or understand why I can't and get help finding the right ones.

### Success looks like
- Confirms the named sites don't exist (checks both local and WPE)
- Shows what does exist, so the user can spot the right names
- Offers possible alternatives if anything looks close
- Asks a clarifying question ("could they be under a different name?")

### Failure looks like
- Returns "not found" and stops without showing alternatives
- Only checks local and not WPE (or vice versa)
- Fabricates a comparison for sites that don't exist
- Errors out without a next step

### Signals
- Did it check both local and WPE for the named sites?
- Did it show the full fleet so the user can self-correct?
- Did it ask a clarifying question rather than just stopping?
