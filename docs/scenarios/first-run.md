# First Run Scenarios

The user has just installed Nexus. They have no prior context about what it does or what state their environment is in. These scenarios test whether Nexus surfaces value immediately without requiring the user to already know what to ask.

---

## S-M1-01 · What can I do right now?

**Type:** Positive | **Frequency:** rare | **Stakes:** high  
**Eval case:** `M1-01-first-run-what-can-i-do`

### Situation
A developer has installed Nexus, Local is running with the addon active, and they've connected it to their AI agent (Claude Code or Claude Desktop). They open Claude and type their first prompt. They have no idea what capabilities exist.

**Scope:** Local running + addon active + AI agent connected. Does NOT assume MCP fully configured, AI provider key set, or WPE connected. This is the "just got it working" state.

### What I know
- Local is running with the Nexus addon active
- I have connected Nexus to my AI agent
- I have some WordPress sites in Local

### What I don't know
- What Nexus actually does
- Whether WPE is connected or not
- Whether my sites are indexed
- What commands or tools are available

### Intent
Understand what I can do right now without any setup steps.

### Success looks like
- Concrete capabilities described with real examples ("ask me X and I'll do Y")
- Current system state surfaced (how many sites, WPE connected or not)
- A clear first action suggested — not a feature list
- No jargon (MCP server, vector store, graph DB)

### Failure looks like
- A wall of features with no starting point
- "You need to configure X first" with no next step
- Describes what Nexus *could* do rather than what works *right now*
- Requires the user to already know what to ask

### Signals
- Did it check actual system state (sites, WPE connection) before answering?
- Did it give at least one concrete example prompt the user can copy?
- Did it avoid implementation terminology?

---

## S-M1-02 · Show me what's in my sites

**Type:** Positive | **Frequency:** occasional | **Stakes:** medium  
**Eval case:** `M1-02-first-run-whats-in-my-sites`

### Situation
A developer wants a first look at their fleet before they've done any indexing. This is the "orient me" request — they want whatever Nexus can surface immediately from the metadata layer (site list, status, WP version from the graph DB) without requiring a full index run.

Note: the user may not be a WPE customer. If WPE isn't connected, local-only results are a complete answer, not a failure.

### What I know
- I have local WordPress sites in Local
- I may or may not have WP Engine sites

### What I don't know
- How many sites I have
- Which are running
- Whether WPE is connected
- WP version, plugins, themes (requires WP-CLI on a running site or prior indexing)

### Intent
Get a meaningful first look at my fleet from whatever data is immediately available — no indexing required.

### Success looks like
- Lists all local sites (name, status, domain) from the metadata layer — no indexing needed
- Shows WPE installs if connected, summarized intelligently
- Is honest about what it can't show without indexing ("plugin list requires a running site or prior index")
- Does not require WPE to be connected — local-only is a valid complete answer
- Offers a natural next step ("want me to start a site and check plugins?")

### Failure looks like
- Returns nothing because no indexing has happened (metadata should always be available)
- Pretends it can show plugin lists without indexing or a running site
- Requires WPE to be connected before showing anything
- Shows raw errors from the startup layer rather than graceful partial data

### Ceiling
Without indexing, deep site data (plugins, themes, content) isn't available. The scenario ceiling is: site list + status + basic WP version from graph DB. Everything deeper requires either a running site (WP-CLI) or a completed index. A good answer surfaces that ceiling naturally rather than hiding it.

### Signals
- Did it show site list and status without requiring indexing?
- Was it honest about what requires indexing vs what's immediately available?
- Did it handle the WPE-not-connected case gracefully?

---

## S-M1-03 · Show me how search works

**Type:** Positive | **Frequency:** rare | **Stakes:** medium  
**Eval case:** `M1-03-first-run-make-searchable`

### Situation
A developer has just set up Nexus and wants to see what cross-site content search looks like in practice. They may or may not have sites already indexed — the system should meet them where they are.

### What I know
- I have local WordPress sites
- I want to search across them

### What I don't know
- Whether my sites are already indexed
- What a search result looks like
- What kinds of questions I can ask

### Intent
See search working — either demonstrated with real results, or understand clearly what I need to do to enable it.

### Success looks like
- If sites are searchable: runs a real example search and shows results
- If sites are not yet searchable: explains what to do next, offers to start the process
- Either way: the user sees something concrete — not an explanation of features
- Never exposes implementation terms (index, vector store, embeddings) to the user

### Failure looks like
- Lists search features without demonstrating anything
- Says "you need to set up search first" and stops without offering next steps
- Runs a search, returns nothing, and doesn't explain why
- Uses technical language the user has to decode

### Signals
- Did it check whether search is available before choosing a path?
- Did it either show results OR offer a concrete next step to enable search?
- Did it avoid exposing implementation concepts (indexing, vector store) to the user?

---

## S-M1-N1 · I haven't configured anything — what works?

**Type:** Negative | **Frequency:** occasional | **Stakes:** medium  
**Eval case:** `M1-N1-first-run-no-provider`

### Situation
A developer has installed Nexus but not yet configured an AI provider. They want to understand what's usable now versus what needs more setup. The system is in a partially-configured state.

### What I know
- Nexus is installed
- I haven't added an API key or configured AI features

### What I don't know
- What works without AI config
- What requires an API key
- How much of Nexus I can use today

### Intent
Know exactly what I can use right now and what I need to set up to unlock the rest.

### Success looks like
- Clear separation: "works now" vs "needs setup"
- "Works now" includes real capabilities (fleet management, WPE tools, site search, DB scanning)
- "Needs setup" names the specific gap and gives the exact command to fix it
- Does not treat partial configuration as a blocker to usefulness

### Failure looks like
- Says "please configure AI provider" and stops
- Vague about what works without AI
- Names features that don't work without saying what does
- Makes the user feel like they broke something

### Signals
- Did it explicitly list capabilities that work without AI config?
- Did it give the exact setup command (not just "go to settings")?
- Did it frame partial setup as normal progress, not a failure state?
