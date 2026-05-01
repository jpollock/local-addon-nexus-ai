# First Run Scenario Feedback

## S-M1-01

For the situation, are we assuming that "just installed Nexus" also includes full setup of the addon/cli/mcp, including integration into Claude or Claude Code, or the like? Perhaps we are, which is fine. So for "What I know", it could be "I have installed Nexus" and "I have setup Nexus to work with my AI agents". But perhaps this is too much of an assumption? Should we have a "setup Nexus" scenario? Does that even make sense? Is it even possible to document and execute?

## S-M1-02

We say that failure includes "no data" because of no indexing but we say in the Situation that the developer wants to get a first look at their fleet before they've done any indexing or configuration. Which is it? I am fine with a "first glimpse" not dependent on sites running and being indexed. There is some data that we get at startup of Local with the addon enabled! That's great! Perhaps the failure state is that it returns empty/no data because of some failure in startup? Also, if they haven't connected WPE then they would not be able to see WPE sites. Also, the user MIGHT NOT be a WPE customer (which is OK).

I also struggle to see how, without indexing, we can successfully answer the next step "checking plugins" without inefficient startup/scan/ssh processing, or are you thinking that this is the minimal "filesystem scan" with the commentary from the AI that "we can do more when you index?"

This scenario requires some re-thinking, IMO. Or be clearer, given that the next scenario begins to address my concerns?

## S-M1-03

This is great! Underneath, we still have to be thinking about content index and the graph/digital twin data. But I also think that the user should NOT have to be concerned about those.

## SM-M1-N1

Looks good!

---

## Resolution

**2026-05-01**

**S-M1-01** ✅ Updated — clarified scope in Situation: Local running + addon active + AI agent connected. Added explicit note that MCP fully configured, AI provider key, and WPE connection are NOT assumed. Updated "What I know" to reflect this.

**S-M1-02** ✅ Updated — fixed the contradiction between "before indexing" premise and failure state. Success now correctly anchors to the metadata layer (site list, status, basic WP version — no indexing required). Added explicit "Ceiling" section explaining what requires indexing vs what's immediately available. Added WPE-not-connected as a valid complete answer, not a failure. Removed the misleading suggestion that plugin checks work without indexing or a running site.

**S-M1-03** ✅ Updated — removed implementation language (index, vector store, embeddings). Reframed entirely in user terms: "searchable" not "indexed". Signal updated to avoid exposing technical concepts.

**S-M1-N1** — No changes needed.
