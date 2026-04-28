# Eval Scorecard: 07-content-search (PARTIAL — auto-scored)

**Date:** 2026-04-26  
**Mode:** mcp  
**Model:** claude-sonnet-4-6  
**Run type:** Automated via claude -p  

## Auto-Scored Metrics

| Metric | Value |
|--------|-------|
| Tool calls | 7 |
| Error events | 0 |
| Duration | 143.2s |
| Has result | yes |

## Token Cost (Exact from API)

| Metric | Value |
|--------|-------|
| Input tokens | 11 |
| Output tokens | 6,642 |
| Cache creation | 181,003 |
| Cache read | 504,175 |
| **Total cost** | **$0.9297** |

## Human Scores Needed

Run: npx ts-node tests/evals/runner/score-eval.ts tests/evals/results/2026-04-26-1531-mcp/07-content-search-transcript.txt

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

## Sites with WooCommerce / E-commerce Content

### Faker Incorporated — Most relevant
The only site with substantive WooCommerce-specific content beyond default pages:

- **"How to Get More Out of Your WooCommerce Store"** (post, 78% match) — A blog post about squeezing value out of WooCommerce; mentions it as the "most popular e-commerce platform on the planet" and describes client optimization strategies
- **"Custom WooCommerce Store Build"** (product, 51%) — A service product listing for a custom WooCommerce storefront built on Astra, optimized for speed, mobile, and conversion, including up to 20 products
- Standard WooCommerce pages: Shop, Cart, Checkout, My Account

### The Curated Shelf
Standard WooCommerce store setup — Shop, Cart ("currently empty"), My Account. No custom posts about e-commerce.

### nexus-test-site / nexustestsite1
Same pattern — default WooCommerce pages (Shop, Cart, My Account) but no editorial content about e-
```