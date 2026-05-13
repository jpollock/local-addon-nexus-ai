# Orientation Scenario Feedback

## S-M2-01

LGTM

## S-M2-02

LGTM

## S-M2-03

Note that it is OK if the user does not have WP Engine connected, either because they haven't logged in or because they aren't a customer. This is probably a general statement, applicable for any of these similar type of scenarios, for any moments.

Otherwise, LGTM.

## S-M2-04

Note that if WPE data isn't available in cache (index/graph/digital twin) and the account is signed in, then SSH route is available (but this isn't direct SSH access! the MCP/CLI calls can do the fetch of data).

## S-M2-N1

For Local sites, always we should be able to do filescan, to at least see what's on disk. I think that this should be abstracted away into the MCP/CLI and user is alerted to this fact. AI shouldn't have to think about the intracacies of how data is fetched and managed on the backend process.

---

## Resolution

**2026-05-01**

**S-M2-01** ✅ No changes needed. Added note that WPE-not-connected is a valid complete answer (covered by Global Assumptions in README).

**S-M2-02** ✅ No changes needed.

**S-M2-03** ✅ Updated — WPE connection now optional; local-only is a valid scoped result. Added to both Success and Failure.

**S-M2-04** ✅ Updated — Added "Data tiers" section documenting the three-tier fetch sequence: cached data → SSH via MCP/CLI (when authenticated) → name heuristics. Made clear this is system responsibility, not user concern.

**S-M2-N1** ✅ Updated — Added "Data available for halted local sites" section documenting that cached data + filesystem scan are always available. Clarified that halted ≠ no data. Noted that WP-CLI (database queries) is the only thing that requires a running site.

**README** ✅ Added "Global Assumptions" section covering: WPE optional everywhere, data always available at some tier, implementation concepts stay hidden from users.



