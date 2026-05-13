# Health Scenarios

The user wants to know if things are working correctly — their sites, their WPE account, or Nexus itself. These are diagnostic moments where the user may or may not know what's wrong.

---

## S-M4-01 · SSL audit across WPE sites

**Type:** Positive | **Frequency:** monthly | **Stakes:** high  
**Eval case:** `M4-01-health-ssl`

### Situation
A developer or site owner wants to identify SSL issues across their WP Engine fleet before they become problems — certificates expiring, mismatched domains, or failed renewals.

### What I know
- I have WP Engine sites with custom domains
- SSL certificates expire periodically

### What I don't know
- Which of my sites have custom SSL certificates
- Which are expiring soon (within 30 days)
- Whether any have already expired
- Which sites use WPE's default subdomain (no custom cert needed)

### Intent
Get a prioritized list of SSL issues sorted by urgency so I know what to act on first.

### Success looks like
- Checks all WPE accounts (not just the first)
- Surfaces expired certs as highest priority
- Shows days remaining for certs expiring within 30 days
- Explains "Error fetching certs" correctly (default subdomain — no custom cert, not a problem)
- Offers to trigger renewal for flagged installs

### Failure looks like
- Checks only one account when multiple exist
- Treats "Error fetching certs" as a problem for default-subdomain sites
- Shows raw dates without sorting by urgency
- Omits expired certs

### Signals
- Did it cover all accounts?
- Were results sorted by urgency (expired first, then by days remaining)?
- Did it correctly interpret Error responses as default-subdomain sites?

---

## S-M4-02 · Database health across local sites

**Type:** Positive | **Frequency:** monthly | **Stakes:** medium  
**Eval case:** `M4-02-health-database`

### Situation
A developer wants to understand the database health of their local WordPress sites — looking for bloat, orphaned data, revision accumulation, and autoload issues that slow down performance.

### What I know
- I have multiple local sites
- WordPress databases can accumulate junk over time

### What I don't know
- Which of my sites have the most problems
- What specifically is causing issues
- Whether it's safe to clean anything

### Intent
Get a fleet-wide database health summary ranked by severity, with specific issues called out per site and safe next steps offered.

### Success looks like
- Scans all running local sites
- Gives a health score per site
- Names the top issue per site (orphaned meta, revisions, autoload bloat)
- Identifies the specific plugin or pattern causing the issue where possible
- Offers dry-run cleanup before any deletions
- Notes which sites couldn't be scanned (halted) and why

### Failure looks like
- Returns a score with no specifics about what's wrong
- Proposes cleanup without offering a dry-run first
- Scans only one site

### Signals
- Were issues attributed to specific plugins or patterns?
- Was a dry-run offered before cleanup?
- Were halted sites noted rather than silently skipped?

---

## S-M4-03 · Is Nexus itself working?

**Type:** Positive | **Frequency:** occasional | **Stakes:** high  
**Eval case:** `M4-03-health-nexus-itself`

### Situation
A developer suspects something is wrong with Nexus — queries are failing, the addon isn't responding, or they just want to verify everything is connected before starting a work session.

### What I know
- Something might be wrong (or I'm just being cautious)
- Local is running

### What I don't know
- Whether the MCP server is running
- Whether WPE is authenticated
- Whether the AI provider is configured
- What the error rate is

### Intent
Get a clear pass/fail status on every Nexus component, with the exact fix command for anything that's broken.

### Success looks like
- Checks each component explicitly: Local, GraphQL, MCP server, WPE connection, AI provider, knowledge graph
- Clear status for each: ✅ / ⚠️ / ❌
- For anything not green: gives the exact command to fix it
- Interprets borderline metrics correctly (5.2% error rate from eval runs ≠ real outage)

### Failure looks like
- Says "everything looks fine" without actually checking
- Reports an error without giving a fix command
- Treats expected transient errors as real failures
- Missing components (checks Local but not MCP server)

### Signals
- Did it check every component (not just one)?
- Was the exact fix command given for any failure?
- Did it exercise judgment on borderline metrics rather than flagging everything red?

---

## S-M4-N1 · SSL audit when not sure if authenticated

**Type:** Negative | **Frequency:** occasional | **Stakes:** medium  
**Eval case:** `M4-N1-health-wpe-not-authenticated`

### Situation
A developer wants to check WPE SSL status but is uncertain whether they're logged in. The system should check auth state first rather than making CAPI calls that will fail with cryptic errors.

### What I know
- I want to check SSL across my WPE sites
- I may or may not be authenticated with WPE

### What I don't know
- Whether my WPE session is active
- What error I'll get if I'm not authenticated

### Intent
Get the SSL audit if possible, or a clear explanation of how to authenticate if not.

### Success looks like
- Checks WPE auth status before making fleet calls
- If authenticated: proceeds with full SSL audit
- If not authenticated: clearly explains what's needed and gives the exact login command
- Does not surface raw CAPI 401 errors to the user

### Failure looks like
- Makes CAPI calls, gets 401, and shows the raw error response
- Says "not authenticated" without giving the login command
- Gives up without a next step

### Signals
- Did it check auth before making CAPI calls?
- Was the login command given if not authenticated?
- Did it proceed to the audit if authenticated?

### Key insight
In practice, the system may be authenticated even when the user isn't sure — the right behavior is to check and proceed, not to ask the user to verify manually.
