# Eval Scorecard: 07-content-search (PARTIAL — auto-scored)

**Date:** 2026-04-23  
**Mode:** cli-skills  
**Model:** claude-sonnet-4-6  
**Run type:** Automated via claude -p  

## Auto-Scored Metrics

| Metric | Value |
|--------|-------|
| Tool calls | 7 |
| Error events | 0 |
| Duration | 36.2s |
| Has result | yes |

## Token Cost (Exact from API)

| Metric | Value |
|--------|-------|
| Input tokens | 8 |
| Output tokens | 1,141 |
| Cache creation | 42,351 |
| Cache read | 196,337 |
| **Total cost** | **$0.2349** |

## Human Scores Needed

Run: npx ts-node tests/evals/runner/score-eval.ts tests/evals/results/2026-04-23-1152-cli-skills/07-content-search-transcript.txt

| Dimension | Score | Weight | Notes |
|-----------|-------|--------|-------|
| Task completed (auto) | 100 | 40% | Got a result |
| Steps correct | TBD | 30% | Human review |
| Friction | TBD | 20% | Human review |
| Output clarity | TBD | 10% | Human review |
| **Auto partial** | **40.0** | | Steps/friction/clarity = TBD |

## Result Preview

```
Here's what I found across your local sites:

---

## WooCommerce / E-commerce Content

### Sites with actual WooCommerce content (posts/pages with real text):

**Faker Incorporated** — the richest match, with dedicated WooCommerce content:
- **"How to Get More Out of Your WooCommerce Store"** (post, score 0.52) — article about e-commerce optimization and squeezing more out of WooCommerce stores
- **"Services"** (page, score 0.52) — mentions digital strategy and e-commerce in the service portfolio
- **"Shop"** page + **"Cart"** page — WooCommerce storefront pages

**The Curated Shelf** — has a **Shop** page (WooCommerce store)

**faker-incorporated** — has **Shop** and **Cart** pages (separate from "Faker Incorporated" above — likely a different local site with a similar theme)

**nexustestsite1** and **nexus-test-site** — both have **Shop** pages

---

### Large number of WPE-pulled sites:
Many of your WPE-synced sites (20+) have WooCommerce's standard `[woocommerce_my_account]` and `
```