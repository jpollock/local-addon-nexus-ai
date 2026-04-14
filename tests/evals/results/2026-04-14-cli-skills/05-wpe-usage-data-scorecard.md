# Eval Scorecard: 05-wpe-usage-data

**Date:** 2026-04-14  
**Mode:** cli-skills  
**Model:** claude-sonnet-4-6  
**Weighted Score:** 93.0/100

## Auto-Extracted Metrics

| Metric | Value |
|--------|-------|
| Tool calls | 15 |
| Error events | 2 |
| Retries | 0 |

## Token Cost Estimate (Plan 3)

| Metric | Value |
|--------|-------|
| Input tokens | 1,326 |
| Output tokens | 224 |
| Total tokens | 1,550 |
| Estimated cost | $0.0073 |

### Token Breakdown

| Component | Tokens |
|-----------|--------|
| Tool calls | 256 |
| Tool results | 735 |
| Skill prompts | 0 |
| Conversation | 558 |

## Human Scores

| Dimension | Score | Weight |
|-----------|-------|--------|
| Task completed | 100 | 40% |
| Steps correct | 90 | 30% |
| Friction (100=zero) | 85 | 20% |
| Output clarity | 90 | 10% |
| **Weighted total** | **93.0** | |

## Reviewer Notes

Skill auto-invoked correctly. All 10 accounts queried. 404 on btwpe handled gracefully. Zero retries. Correctly diagnosed billing period lag.

## Transcript

```
EVAL TRANSCRIPT
Case: 05-wpe-usage-data
Mode: cli-skills
Date: 2026-04-14
Session: Live session — Jeremy Pollock

USER PROMPT:
"can you get usage data for my WPE sites"

---

⏺ Skill(nexus-wpe)
  ⎿  Successfully loaded skill · nexus-wpe · 1 tool allowed

⏺ I'll pull account-level usage data for all 10 accounts in parallel.

⏺ Bash(nexus wpe accounts --json 2>&1)
  ⎿  [{"id":"41b8c1d0-3084-4430-81f0-8d95a2c6182d","name":"devrel"},
     {"id":"142eeed6-2b43-42bb-96b3-a327b2ff7eef","name":"getflywheel"},
     {"id":"1d071342-5591-4ddb-8fd7-e7190674fd88","name":"jpollock911"},
     {"id":"b97e432b-c10a-4f0a-9ce7-55cedd575099","name":"w7579"},
     {"id":"fec28ece-0d02-4d99-831a-e2ed7acefffd","name":"esmv7us1l20jdr"},
     {"id":"c5e3787e-bea8-4164-96c7-dfbfbd9f6664","name":"goldenecomm"},
     {"id":"effc36bd-8de2-4105-a021-6d1755661cb7","name":"btwpe"},
     {"id":"111e0292-9560-4214-a8e9-e3ae5306a393","name":"qawpeproduct"},
     {"id":"6d5f288a-62c5-4b45-bee8-50ebd02b66b5","name":"esmy9dign4hoqz"},
     {"id":"1706440b-b146-4b97-a5f6-134bbaf6f1a4","name":"esm5z2bl7u8vqk"}]

⏺ I'll use wpe_account_usage on all 10 accounts in parallel for April 2026.

⏺ Bash(nexus wpe account-usage 41b8c1d0-3084-4430-81f0-8d95a2c6182d 2>&1)
  ⎿  Account: 41b8c1d0-3084-4430-81f0-8d95a2c6182d — April 2026
     ──────────────────────────────────────────
       Visits (total):    0
       Bandwidth:         0 B
       File storage:      0 B
       DB storage:        0 B

⏺ Bash(nexus wpe account-usage 142eeed6-2b43-42bb-96b3-a327b2ff7eef 2>&1)
  ⎿  Account: 142eeed6-2b43-42bb-96b3-a327b2ff7eef — April 2026
     ──────────────────────────────────────────
       Visits (total):    0
       Bandwidth:         0 B
       File storage:      0 B
       DB storage:        0 B

⏺ Bash(nexus wpe account-usage 1d071342-5591-4ddb-8fd7-e7190674fd88 2>&1)
  ⎿  Account: 1d071342-5591-4ddb-8fd7-e7190674fd88 — April 2026
     ──────────────────────────────────────────
       Visits (total):    0
       Ba
... [truncated]
```