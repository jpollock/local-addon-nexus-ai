# Eval B-03 — tool selection

The gate named in `chat/tool-adapter.ts` since WP-11: *"narrowing what the
model can see changes behaviour and is gated on eval B-03."* Nothing
populates `grants` until this harness says the selector is good enough.

Two failure modes, measured separately (a single pass/fail hides both):

1. **Selector recall** (`kind: "recall"`) — for a request with a
   known-correct tool, assert the tool is either resident (bucket 1's Orient
   stage) or in the selector's top-k. A miss is a ranker problem: reweight
   lexical vs cosine, or fix a namespace assignment.
2. **Escape hatch** (`kind: "escape-hatch"`) — with the correct tool
   deliberately withheld from the grant set, assert the FULL round trip: the
   model calls `search_tools`, the discovered tool is appended to the grant
   set (append-only — the array never shrinks or reorders mid-turn), and the
   model completes the task with it on a later iteration. Not merely that
   the search happened. First half failing is a prompt problem; second half
   is the append plumbing. **Runner support pending** — it needs the
   append-only grants implementation (P5 stage 3) and a live provider; the
   case format is defined now so cases accumulate ahead of the plumbing.

## Case distribution — 50 cases, weighted by the twelve jobs

Backbone: the 2026-08-26 market prioritization (State of WordPress Agencies
2026, vendor landscape). Target counts; fill with REAL requests — accrued
`'chat'`-labeled production calls and the owner's own phrasing — never
invented ones. A fabricated case encodes a guess as ground truth and every
future selector gets tuned against it (the spec-claims-propagate failure).

| job | target cases |
|---|---|
| 1 Updates w/ safe rollback | 9 |
| 2 Backups + restore verification | 6 |
| 3 Client reporting | 3 |
| 4 Vulnerability management | 6 |
| 5 Uptime / health | 6 |
| 6 Bulk administration | 5 |
| 7 Security response | 4 |
| 8 Performance | 3 |
| 9 Staging / deploy | 3 |
| 10 Provisioning / migrations | 2 |
| 11 User / access | 2 |
| 12 Content ops / SEO | 1 |

At least ten of the fifty should be `escape-hatch` variants of recall cases.

## Running

```
node tests/eval/b03-tool-selection/run.mjs                 # lexical baseline
node tests/eval/b03-tool-selection/run.mjs --k 12
node tests/eval/b03-tool-selection/run.mjs --selector path/to/selector.mjs
```

A selector module default-exports
`(request, context, defs) => string[]` (ranked tool names; `defs` is
`[{name, description, namespace}]`). The baseline in `run.mjs` mirrors
`search_tools`' lexical scoring (name ×4, partial name ×2, description ×1) —
the thing any candidate must beat.

Jest ignores this directory (`testPathIgnorePatterns: ['/eval/']`); the
runner is invoked manually or from CI as a separate step, like the other
eval suites.
