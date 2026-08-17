---
id: rb.diagnose-site
kind: runbook
version: 1.0.0
strictness: guided               # ADR-12: diagnosis is adaptive by nature; deviations log as task.* with rationale
capability: cap.diagnose_site
owner: ops
review_triggers:
  - any change to wp_site_health / wpe_diagnose_site / local_get_site_logs / local_get_sync_history signatures
  - a new site source appearing in the fleet (the breadth checklist is source-shaped)
  - any change to what the ledger records about failed operations
scope:
  environments: [local, wpe_production, wpe_staging, wpe_development, external]
  writes: []                     # read-only by construction: this runbook requests no write grant
requires_sources:
  - { class: platform, type: state, need: run/halt status and the site's identity across sources, via: nexus_site_status / local_list_sites / wpe_get_installs }
  - { class: platform, type: state, need: core/PHP/plugin/theme reality, via: twin facts site.core, plugin:*, theme:* — live-rechecked before any claim about a current version }
  - { class: platform, type: state, need: does it actually serve, via: verify_site_live + wp_site_health }
  - { class: platform, type: state, need: error evidence, via: local_get_site_logs / wpe_diagnose_site }
  - { class: platform, type: state, need: cache-vs-reality divergence, via: detect_drift (twin vs live) }
  - { class: work,     type: episodic, need: what was recently done TO this site — pushes, pulls, promotions, updates, and how they ended, via: local_get_sync_history + ledger query on the entity id }
  - { class: authored, type: policy, need: confirmation that any proposed fix is out of this runbook's scope and needs its own grant, via: policy engine }
steps:                           # guided: ordered guidance, not gateway-enforced sequence
  - id: st.resolve-identity      # eval 10 (must_not: confuse the local site with the WPE install of the same name)
  - id: st.status-first          # evals 06 + 10 (checks site status: running/halted)
  - id: st.recent-history        # eval 10 (checks sync history for recent push attempts — the prompt says "I tried to push")
  - id: st.breadth-sweep         # eval 06 (health check, logs, WP version, plugin status, PHP errors, WPE connection if relevant)
  - id: st.both-sides            # eval 10 (investigates local AND WPE state, not one of them)
  - id: st.hypothesis            # evals 06 + 10 (presents findings with likely causes / forms a hypothesis)
  - id: st.propose-not-execute   # eval 10 (proposes a specific recovery action; does NOT execute the fix without approval)
  - id: st.honest-null           # evals 06 + 10 (if the site is actually fine, say so clearly and explain why it looked broken)
aborts:
  - id: ab.identity-ambiguous
    on: the name resolves to more than one entity, or to none
    do: stop and list the candidates with their sources and environments. Diagnosing the
        wrong copy produces a confident, useless report — and in this fleet a local site
        and a WP Engine install routinely share a name.
  - id: ab.write-required
    on: the next useful diagnostic step would modify the site (toggle a plugin, edit the
        database, restart a remote service, apply a fix)
    do: stop and propose it instead. Name the exact operation, what it would prove or fix,
        and what it risks. Diagnosis holds no write grant; acquiring one mid-run is out of
        bounds. Restarting a HALTED local site is the one bounded exception — see
        st.status-first — and still needs the user's explicit go-ahead.
  - id: ab.compromise-suspected
    on: evidence of intrusion — unexplained admin accounts, file-manager or unknown plugins,
        obfuscated code, modified core files
    do: stop this procedure and hand off to rb.incident-containment. Do not delete, clean, or
        "just remove" anything — the evidence is the entry-vector investigation's input, and
        an ad-hoc cleanup destroys it. Report what was seen, where, and when it appeared.
  - id: ab.evidence-unavailable
    on: logs, health checks, or the remote side cannot be reached
    do: report the gap explicitly and scope the conclusion to what WAS observable. A
        diagnosis that silently omits the half it could not see reads as a complete one.
communication:
  - which entity was diagnosed — name, source, environment — before any finding
  - the site's run/halt status, stated first, because it explains a large share of "not loading"
  - each finding with its evidence (log line, version, status code) and its freshness/source
  - what was checked and found NORMAL, not only what was found wrong
  - what could not be checked, and why
  - the proposed fix as a proposal, with the explicit statement that nothing was changed
---

# Diagnose a site

Find out what is actually wrong with a site — or establish that nothing is. This
runbook is **guided**: breadth and order adapt to what the evidence shows. Two things
do not adapt. It is **read-only**: it proposes fixes, it does not apply them. And it
prefers an honest "I could not find a fault, here is everything I checked" to a
plausible cause invented to satisfy the question.

## st.resolve-identity — which copy are we talking about?

Resolve the name to one entity and say which one. Local sites and WP Engine installs
share names in this fleet, and "the site is broken" often means the local copy while
the evidence being quoted comes from the remote one. Ambiguity is
`ab.identity-ambiguous`.

## st.status-first — halted explains a lot

Check run/halt status before anything else; a halted local site not loading is the
diagnosis, not a mystery. Report it as the finding.

Starting it is a judgment call with a rule: the ambient constraint that halted sites
stay halted exists to stop maintenance sweeps from waking sites nobody asked about, and
a user asking "why isn't this loading" has plainly asked about this one. So starting it
is permissible *with the user's explicit go-ahead and as a stated step* — never
silently, never as a way to make a check convenient, and never on any other site.
Without that go-ahead, report halted and stop there.

## st.recent-history — what was done to it recently?

Query sync history and the ledger for recent operations on this entity: pushes, pulls,
promotions, plugin updates, and how each ended. Most "it was working yesterday" faults
have a matching row here. When the user's own account of events names an operation ("I
tried to push it earlier"), verifying that operation's recorded outcome is the first
substantive check, not a footnote — the recorded outcome frequently contradicts the
user's impression in both directions.

## st.breadth-sweep — check several things, not one

Cover the axes, and say which ones you covered: does it serve HTTP; site health output;
core, PHP and plugin versions against what the twins believed (a twin/live divergence is
itself a finding); error logs; and the remote connection where the site has one. Depth
on one axis while the others go unchecked is the characteristic weak diagnosis — it
produces "it might be a plugin" instead of a named plugin, version and log line.

Live-check anything you are about to assert as current. Twins are for targeting and for
spotting divergence; a version quoted from a twin without a live check is a claim about
the past.

## st.both-sides — a paired site has two states

When the site exists on both sides — a local copy and a remote install — investigate
both, and say which side each finding came from. A failed transfer typically leaves
asymmetric evidence: the local side looks mid-operation, the remote side looks
untouched, and only the pair explains it.

## st.hypothesis — commit to a cause, or say you cannot

State the most probable cause, the evidence behind it, and your confidence. If several
causes fit, rank them and name the check that would separate them. Generic advice
("try restarting", "could be a plugin conflict") that is not tied to something observed
on this site is not a diagnosis and should not be presented as one.

## st.propose-not-execute — the fix is a proposal

Propose the specific remedy: the exact operation, on which entity, what it changes,
what it risks, and how to verify it worked. Then stop. Applying it is a separate
procedure with its own grant and approval — `ab.write-required`. If the remedy is a
promotion, a pull, or an incident cleanup, name the runbook that owns it.

## st.honest-null — "it's fine" is a valid answer

If the checks come back clean, say so plainly, list what was checked, and offer the most
likely explanation for the user's experience (cached page, an operation that actually
succeeded, a different environment than the one they were looking at). Manufacturing a
fault to have something to report is the failure mode this step exists to prevent, and
it is the more expensive error: it sends someone to fix a site that was never broken.
