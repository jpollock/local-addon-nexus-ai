# Eval Scorecard: 07-content-search (PARTIAL — auto-scored)

**Date:** 2026-04-23  
**Mode:** cli-skills  
**Model:** claude-sonnet-4-6  
**Run type:** Automated via claude -p  

## Auto-Scored Metrics

| Metric | Value |
|--------|-------|
| Tool calls | 2 |
| Error events | 0 |
| Duration | 29.1s |
| Has result | yes |

## Token Cost (Exact from API)

| Metric | Value |
|--------|-------|
| Input tokens | 4 |
| Output tokens | 818 |
| Cache creation | 41,699 |
| Cache read | 39,109 |
| **Total cost** | **$0.1804** |

## Human Scores Needed

Run: npx ts-node tests/evals/runner/score-eval.ts tests/evals/results/2026-04-23-1532-cli-skills/07-content-search-transcript.txt

| Dimension | Score | Weight | Notes |
|-----------|-------|--------|-------|
| Task completed (auto) | 100 | 40% | Got a result |
| Steps correct | TBD | 30% | Human review |
| Friction | TBD | 20% | Human review |
| Output clarity | TBD | 10% | Human review |
| **Auto partial** | **40.0** | | Steps/friction/clarity = TBD |

## Result Preview

```
Here's what I found:

## Sites with WooCommerce / E-Commerce Content

### Most Relevant: Named Local Sites

**Faker Incorporated** — highest signal, has actual editorial content:
- **"How to Get More Out of Your WooCommerce Store"** (post) — explicitly about WooCommerce as an e-commerce platform, with advice on squeezing revenue from WooCommerce stores
- **"Services"** (page) — references digital strategy with e-commerce context
- **"Shop"** (page) — active WooCommerce shop
- **"Cart"** (page) — WooCommerce cart shortcode

**The Curated Shelf** — has a **Shop** page (WooCommerce store setup)

**faker-incorporated** / **Faker Incorporated** (appear to be two separate installs) — both have WooCommerce Shop + Cart pages

**nexustestsite1** and **nexus-test-site** — both have Shop pages (WooCommerce present)

### WPE-synced sites (many)
A large number of `wpe-*` installs have WooCommerce's standard pages (My Account, Cart) — these are real WPE environments pulled locally with WooCommerce a
```