# Find Scenarios

The user is looking for something specific across their sites. These are active search moments — the user has a question and needs Nexus to locate the answer across a fleet they can't manually browse.

---

## S-M3-01 · Find content about a topic across all sites

**Type:** Positive | **Frequency:** weekly | **Stakes:** medium  
**Eval case:** `M3-01-find-content-by-topic`

### Situation
A developer or content owner wants to know which of their sites has content related to a broad topic. They're not looking for a specific page — they want semantic discovery across their fleet.

### What I know
- The topic I'm interested in (e.g. "e-commerce", "membership")
- I have multiple local sites

### What I don't know
- Whether any of my sites have relevant content
- Which sites are indexed
- What the results will look like

### Intent
Discover which sites have content related to this topic, and see the relevant posts/pages.

### Success looks like
- Searches across all indexed sites simultaneously
- Results grouped by site with title, post type, and a content snippet
- Covers all indexed sites — does not stop at the first result
- Honest when no results exist: explains why (wrong kind of sites, no content) and offers next steps
- Notes any unindexed sites that were excluded

### Failure looks like
- Searches only one site
- Returns "no results" without explaining which sites were checked
- Confuses content about a topic with having a plugin for that topic
- Silently skips unindexed sites

### Signals
- Did it cover all indexed sites?
- Were results grouped clearly by site?
- Did it explain a no-result outcome rather than just returning empty?

---

## S-M3-02 · Which copy of my site is the real one?

**Type:** Positive (with partial failure expected) | **Frequency:** occasional | **Stakes:** high  
**Eval case:** `M3-02-find-which-copy-is-real`

### Situation
A developer has multiple local sites that appear to be copies of the same project — created at different times, possibly with different names. They need to know which is the active working copy.

### What I know
- The approximate names of the sites I'm looking for
- That multiple copies exist

### What I don't know
- Which has the most recent content
- Which was last modified
- Which is linked to WPE production

### Intent
Get a clear recommendation on which site to work in, with reasoning.

### Success looks like
- Checks all named sites — doesn't pick one without looking at the others
- Uses available signals: post count, index recency, WPE link, running status
- Makes a recommendation with explicit reasoning ("jpp-client has 47 posts vs 12 — likely more current")
- Acknowledges when signals are ambiguous rather than fabricating certainty
- Suggests how to verify if uncertain (e.g. check a specific post date)

### Failure looks like
- Picks one arbitrarily without evidence
- Only checks one site
- Claims certainty when post timestamps aren't available
- Returns error if site names don't match exactly (should try fuzzy match)

### Signals
- Did it check all named sites before recommending?
- Did it explain the evidence used?
- Did it acknowledge uncertainty appropriately?

### Known gap
No last-modified-post timestamp in the current index. Post count and index recency are proxies, not ground truth. A good answer says so.

---

## S-M3-03 · Do I have a local copy of my WPE site?

**Type:** Positive | **Frequency:** occasional | **Stakes:** high  
**Eval case:** `M3-03-find-local-wpe-pair`

### Situation
A developer wants to know if they have a local copy of a specific WP Engine site, and if so, how in sync the two are. They may be planning a pull or trying to debug a production issue locally.

### What I know
- The WPE site name (or domain)
- I might have a local copy, but I'm not sure

### What I don't know
- Whether a local site is linked to this WPE install
- When the last sync happened
- Whether the WP versions, plugins match

### Intent
Confirm whether a local↔WPE pairing exists and understand how in sync they are.

### Success looks like
- Identifies the WPE install (by name or domain)
- Checks local fleet for a linked or name-matched site
- If found: compares WP version, plugin count, last sync date
- If not found: clearly says so and offers to create one (with exact steps)
- Does not claim sync without data to support it

### Failure looks like
- Confuses local-copy-jpp (linked to a different install) with the target WPE site
- Claims sites are in sync without comparing
- Modifies anything without being asked

### Signals
- Did it correctly distinguish formally-linked sites from name-similar ones?
- Did it offer concrete next steps (pull, or create+pull)?

---

## S-M3-04 · Find posts or pages about a specific thing

**Type:** Positive | **Frequency:** weekly | **Stakes:** medium  
**Eval case:** `M3-04-find-content-across-sites`

### Situation
A developer or content owner wants to find specific pages — pricing pages, contact forms, checkout flows — across their sites. More targeted than a broad topic search.

### What I know
- The specific thing I'm looking for (e.g. "pricing page")
- I have multiple sites

### What I don't know
- Whether any of my sites have this content
- Which sites have been indexed

### Intent
Get a ranked list of matching pages across all my sites, with enough context to evaluate each result.

### Success looks like
- Searches with multiple related terms (not just the exact phrase)
- Results include post title, type, site, and a content snippet
- Distinguishes real content from placeholder/template content
- Explains a no-result outcome: which sites were checked and why they didn't match
- Notes any unindexed sites

### Failure looks like
- Returns one result and stops
- Presents template content ("$49/mo placeholder") as real pricing pages without noting it
- Returns "no results" without listing which sites were searched

### Signals
- Did it search with semantic breadth (related terms)?
- Did it distinguish real vs placeholder content?
- Did it account for all indexed sites?

---

## S-M3-N1 · Search when nothing is indexed

**Type:** Negative | **Frequency:** occasional | **Stakes:** medium  
**Eval case:** `M3-N1-find-nothing-indexed`

### Situation
A developer asks to search across their sites but states that nothing is indexed yet. The system should not fail silently — it should explain the gap and show the user how to fix it.

### What I know
- The topic I want to search for
- My sites aren't indexed yet (I think)

### What I don't know
- Whether the index is truly empty or partially populated
- How long indexing takes
- What command triggers it

### Intent
Either get search results or understand exactly what I need to do to enable search.

### Success looks like
- Checks actual index state rather than taking the user's word for it
- If truly empty: explains what indexing enables, gives the exact command, offers to start it
- If partially indexed: searches what's available, notes what's missing
- Does not return empty results without explanation

### Failure looks like
- Returns "no results" without explaining the unindexed state
- Says "index your sites first" without giving the command
- Ignores available WPE indexed data when local is empty

### Signals
- Did it verify actual index state rather than assuming?
- Did it bridge from "can't do it" to "here's how to enable it"?
- Did it give the exact command to start indexing?
