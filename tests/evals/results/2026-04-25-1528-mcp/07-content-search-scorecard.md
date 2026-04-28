# Eval Scorecard: 07-content-search (PARTIAL — auto-scored)

**Date:** 2026-04-25  
**Mode:** mcp  
**Model:** claude-sonnet-4-6  
**Run type:** Automated via claude -p  

## Auto-Scored Metrics

| Metric | Value |
|--------|-------|
| Tool calls | 2 |
| Error events | 0 |
| Duration | 30.7s |
| Has result | yes |

## Token Cost (Exact from API)

| Metric | Value |
|--------|-------|
| Input tokens | 4 |
| Output tokens | 764 |
| Cache creation | 125,035 |
| Cache read | 105,894 |
| **Total cost** | **$0.5121** |

## Human Scores Needed

Run: npx ts-node tests/evals/runner/score-eval.ts tests/evals/results/2026-04-25-1528-mcp/07-content-search-transcript.txt

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

## Sites with WooCommerce / E-Commerce Content

### 1. Faker Incorporated — most relevant
This is the richest WooCommerce site with actual content:

| Post | Type | Excerpt |
|------|------|---------|
| **Shop** | page | Standard WooCommerce shop page |
| **How to Get More Out of Your WooCommerce Store** | post | *"WooCommerce is the most popular e-commerce platform on the planet — but out of the box, it's just the beginning. Here's how we help our clients squeeze..."* |
| **Custom WooCommerce Store Build** | product | *"A fully designed, custom WooCommerce storefront built on Astra — optimized for speed, mobile, and conv..."* |
| **Cart** | page | `[woocommerce_cart]` shortcode |
| **Checkout** | page | `[woocommerce_checkout]` shortcode |
| **My account** | page | `[woocommerce_my_account]` shortcode |

### 2. The Curated Shelf, nexus-test-site, nexustestsite1
All have WooCommerce core pages (Shop, Cart, My account) with `[woocommerc
```