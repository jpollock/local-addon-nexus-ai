# Eval Scorecard: 07-content-search (PARTIAL — auto-scored)

**Date:** 2026-04-23  
**Mode:** cli-skills  
**Model:** claude-sonnet-4-6  
**Run type:** Automated via claude -p  

## Auto-Scored Metrics

| Metric | Value |
|--------|-------|
| Tool calls | 8 |
| Error events | 0 |
| Duration | 52.7s |
| Has result | yes |

## Token Cost (Exact from API)

| Metric | Value |
|--------|-------|
| Input tokens | 11 |
| Output tokens | 1,704 |
| Cache creation | 33,216 |
| Cache read | 346,432 |
| **Total cost** | **$0.2541** |

## Human Scores Needed

Run: npx ts-node tests/evals/runner/score-eval.ts tests/evals/results/2026-04-23-1001-cli-skills/07-content-search-transcript.txt

| Dimension | Score | Weight | Notes |
|-----------|-------|--------|-------|
| Task completed (auto) | 100 | 40% | Got a result |
| Steps correct | TBD | 30% | Human review |
| Friction | TBD | 20% | Human review |
| Output clarity | TBD | 10% | Human review |
| **Auto partial** | **40.0** | | Steps/friction/clarity = TBD |

## Result Preview

```
Now I have a clear picture. Here's what your local sites have in terms of WooCommerce/e-commerce content:

---

## Local Sites with WooCommerce / E-commerce Content

### 1. Faker Incorporated — most substantive content
- **"How to Get More Out of Your WooCommerce Store"** (post, score 0.52)
  > *"WooCommerce is the most popular e-commerce platform on the planet — but out of the box, it's just the beginning. Here's how we help our clients squeeze every dollar out of their WooCommerce stores..."*
- **"Services"** page (score 0.52) — references digital strategy, likely mentions e-commerce
- **"Shop"** page — WooCommerce store page

### 2. The Curated Shelf
- **"Shop"** page (score 0.51) — WooCommerce shop page

### 3. faker-incorporated
- **"Shop"** page + **"Cart"** page with `[woocommerce_cart]` shortcode

### 4. nexustestsite1
- **"Shop"** page

### 5. nexus-test-site
- **"Shop"** page

---

**Bottom line:** The richest e-commerce content is on **Faker Incorporated**, which has an actu
```