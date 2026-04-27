# Eval Scorecard: 07-content-search (PARTIAL — auto-scored)

**Date:** 2026-04-23  
**Mode:** mcp  
**Model:** claude-sonnet-4-6  
**Run type:** Automated via claude -p  

## Auto-Scored Metrics

| Metric | Value |
|--------|-------|
| Tool calls | 4 |
| Error events | 0 |
| Duration | 43.3s |
| Has result | yes |

## Token Cost (Exact from API)

| Metric | Value |
|--------|-------|
| Input tokens | 7 |
| Output tokens | 1,313 |
| Cache creation | 35,005 |
| Cache read | 109,643 |
| **Total cost** | **$0.1839** |

## Human Scores Needed

Run: npx ts-node tests/evals/runner/score-eval.ts tests/evals/results/2026-04-23-1641-mcp/07-content-search-transcript.txt

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

## Sites with WooCommerce / E-commerce Content

### Faker Incorporated — richest e-commerce content
This is the standout site with actual editorial and product content beyond just default WooCommerce pages:

| Type | Title | Excerpt |
|------|-------|---------|
| **Post** | How to Get More Out of Your WooCommerce Store | "WooCommerce is the most popular e-commerce platform on the planet — but out of the box, it's just the beginning. Here's how we help our clients squeeze..." |
| **Product** | Custom WooCommerce Store Build | "A fully designed, custom WooCommerce storefront built on Astra — optimized for speed, mobile, and conversions..." |
| **Page** | Cart, Checkout, Shop, My Account | Standard WooCommerce store pages |

### The Curated Shelf, nexus-test-site, nexustestsite1
These three have WooCommerce installed (Cart, Checkout, Shop, My Account pages) but no editorial posts or products beyond the default store scaffolding.

---

## 
```