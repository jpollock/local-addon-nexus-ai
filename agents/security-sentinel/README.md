# security-sentinel

> Fleet-wide WordPress security surveillance — detects active compromise,
> pre-breach exposure, and distributed attack campaigns across all WP Engine
> installs and linked local sites.

## How It Works

Sentinel runs on a 15-minute cron and on three events: WPE sync completed,
plugin activated, and user created. Each sweep checks every install in scope
through two tiers.

**Tier 1** runs entirely without an LLM and completes in seconds. It executes
a battery of absolute checks (ABS-01 through ABS-07): known backdoor plugin
slugs, default auth salts, "admin" username, low-entropy plugin directory
names used by attackers to hide tools, and more. It also runs exposure checks
(EXP) for misconfigurations that enable attacker access, and relative checks
(REL) that diff against a stored baseline to surface new admin accounts or
recently installed plugins. Finally it runs four log-backed checks (LOG-AUTH,
LOG-PROBE, LOG-ENUM, LOG-DIST) against 30 days of access log aggregates from
log-processor, counting failed login attempts, probe paths, enumeration hits,
and distinct attacker IPs — excluding successful logins.

**Tier 2** triggers when Tier 1 produces at least one critical finding or two
high active-compromise findings. It clones the site into a sandbox, then runs
five LLM-powered specialist modules: enumerator (filesystem inventory),
pattern scanner (PHP obfuscation, ELF binaries, temporal file clusters),
database scanner (injected scripts, rogue cron hooks, spam in posts),
behavioral prober (cloaking, xmlrpc, REST user enumeration via HTTP), and a
synthesizer that correlates all specialist results into a single verdict,
entry point hypothesis, and remediation plan.

**Fleet correlation** runs after all per-site checks and flags the same
suspicious plugin slug appearing on two or more installs (potential
account-level compromise) and shared new-admin email domains across installs.

## Data Sources

| Source | Required | Notes |
|--------|----------|-------|
| Nexus graph.db (fleet_sql) | Yes | Plugin inventory, user list, site metadata |
| wpe_site_deep_refresh (SSH WP-CLI) | Yes | Fresh plugin/user data for each install |
| Log Processor aggregates | Optional | 30-day auth/probe/enum/IP data via get_log_aggregates |
| wp_eval (sandbox only) | Tier 2 | Filesystem and DB inspection in a cloned sandbox |

## Output

- **Findings** — one finding per signal, in the Approvals tab with severity (critical/high/medium) and category (active-compromise/pre-breach/misconfiguration)
- **Report** — Tier 2 only: synthesizer narrative with verdict, entry point, attacker items, blind spots, and remediation steps
- **Log** — per-install sweep progress, Tier 1 signals found, Tier 2 phase labels, sandbox lifecycle
- **State** — per-install baseline: admin user list and plugin list at last scan, used by relative checks (REL-03 etc.)

## Setup

No additional setup is required beyond Nexus itself. For log-backed checks
(LOG-AUTH, LOG-PROBE, LOG-ENUM, LOG-DIST) to work, you must also set up
log-processor for each install you want to monitor.

To enable Tier 2 deep investigation, the site must be start-able in Local
(for local sites) or pullable from WPE (for remote installs). The sandbox
is created automatically and deleted after the run.

## Tips & Tricks

Run sentinel on-demand via the Run Now button after any suspicious event —
a new admin account email, an unexpected plugin, or a spike in login failures
visible in the Traffic Intelligence section of an seo-insights report.

If a site is flagging ABS-07 (low-entropy plugin name) on a known legitimate
plugin, add the slug to the `ABS07_ALLOWLIST` set in `agent.js` and file a
note so it can be included in the next release.

The autonomy setting controls what happens when Tier 2 finds active compromise:
- **Suggest only** — findings reported, no remediation executed
- **Act, then ask** — sandbox cloned and scanned; you approve before any deletion
- **Fully autonomous** — full remediation in sandbox; requires your approval before production push

## FAQ

**Q: Why did sentinel escalate to Tier 2 on a site that seems clean?**  
A: Two high active-compromise signals trigger Tier 2 regardless of whether
they turn out to be false positives. Check the Tier 1 findings in the
Approvals tab — if ABS-07 or REL-03 fired incorrectly, update the allowlist
or baseline.

**Q: LOG-AUTH fired but users legitimately log in to the site.**  
A: LOG-AUTH counts only failed logins (HTTP 200, 403, 429 on the login POST).
Successful logins (302 redirects) are excluded. If it still fires, the site
is receiving genuine brute-force traffic.

**Q: Tier 2 is taking a long time.**  
A: Tier 2 pulls the full site into a sandbox — file copy plus database. For
large sites this can take 5–10 minutes. The 20-minute timeout is intentional.

## Troubleshooting

| Symptom | Likely cause | Fix |
|---------|-------------|-----|
| No installs checked | WPE sync not run or auth expired | Run nexus doctor; re-authenticate WPE |
| LOG-* checks never fire | log-processor not configured | Set up log-processor for the install |
| ABS-07 false positive | Known-good short plugin slug | Add slug to ABS07_ALLOWLIST in agent.js |
| Tier 2 sandbox creation fails | Local not running or disk full | Start Local; check disk space |
| Synthesizer returns unavailable | AI provider not configured | Run nexus doctor; check API key |

## System Prompt

The Tier 2 synthesizer uses the following prompt template (data injected at runtime):

```
You are a senior WordPress security analyst synthesizing findings from five 
specialist agents. Your job: correlate, elevate, and produce a remediation 
plan. You must also explicitly disclose blind spots.

SITE: {installName} ({environment}, {postCount} posts)

## Tier 1 signals (static analysis)
{tier1Signals}

## Enumerator findings
{enumeratorResult}

## Integrity findings
{integrityResult}

## Pattern scanner findings (includes temporal cluster analysis)
{patternResult}

## Database findings
{databaseResult}

## Behavioral findings
{behavioralResult}

## Access log corroboration (30-day aggregate)
{logCorroboration}   ← only included when log data is available

SYNTHESIS RULES:
1. CRITICAL from any specialist leads the report.
2. Temporal cluster = attack session boundary. Items within the cluster 
   window are suspect regardless of name.
3. Cross-agent correlation: flagged by 2+ specialists = CONFIRMED.
   Flagged by 1 = PROBABLE.
4. Always name the entry point.
5. If access log data present: use auth attack volume and IP cardinality 
   to calibrate severity.
6. Remediation order: stop exfiltration → remove persistence → close 
   entry point → verify clean.
7. BLIND SPOTS: always disclose what was NOT checked.
```
