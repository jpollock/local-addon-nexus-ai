---
id: pol.ops-default
kind: policy
version: 1.0.0
scope: tenant                    # applies to every client/site unless a narrower set overrides
owner: ops
constraints:
  - id: c.write-default-deny
    rule: Write operations against any environment are denied unless a capability grant allows them.
    enforcement: gateway
    origin: expertise
  - id: c.production-writes-off
    rule: Production writes (push, WP-CLI write, CAPI write) are off by default; enabling is a
          settings/grant change, never a conversation outcome.
    enforcement: gateway
    origin: expertise
  - id: c.delete-promote-opt-in
    rule: Delete and promote are disabled for ALL environments unless explicitly opted in; they are
          gated by operation type, not by environment.
    enforcement: gateway
    origin: expertise
  - id: c.backup-before-overwrite
    rule: Any operation that overwrites an environment (push, promote, restore) requires a verified
          backup of the destination first. Not waivable in-session.
    enforcement: gateway
    origin: expertise
  - id: c.maintenance-window
    rule: Production-affecting changes run inside the client's maintenance window; outside it,
          schedule or obtain explicit client sign-off. Default window is Tue/Thu 06:00–08:00
          site-local unless the client policy set overrides.
    enforcement: ambient
    origin: intent
  - id: c.halted-stay-halted
    rule: Never start a halted site solely to perform maintenance on it; skip and report.
    enforcement: ambient
    origin: expertise
  - id: c.state-freshness-for-action
    rule: Acting on a cached fact past its freshness SLO is not permitted; re-check live or disclose
          and stop. Browsing/targeting from twins is fine with staleness disclosed.
    enforcement: gateway
    origin: expertise
  - id: c.source-labeling
    rule: Facts presented to users carry their source and trust class; measured and estimated figures
          are never blended without labels.
    enforcement: ambient
    origin: expertise
  - id: c.denial-is-final
    rule: A user denial of a proposed action ends that proposal for the session; do not re-propose
          unprompted or reframe to obtain consent.
    enforcement: ambient
    origin: expertise
---

# Ops default policy

The tenant-wide floor. Client policy sets (`policy/clients/*.md`) may add
constraints or tighten these; nothing may loosen a `gateway`-enforced constraint
except a control-plane settings change with its own audit event.

Two enforcement classes appear above, and the distinction is the model's
advisory-vs-binding line: **gateway** constraints are checked in code at the tool
layer — the agent cannot violate them; **ambient** constraints ship in every
context bundle and are tested by evals (B-02, C-02, C-03) rather than enforced by
tooling — they are the ones a capable agent must *choose* correctly, which is why
they stay few and sharp.

Origins are recorded per constraint (expertise vs. intent vs. regulation) so that
when a constraint is questioned, we know who has authority to change it: operators
own expertise rules, clients own intent rules, nobody negotiates with regulation.
