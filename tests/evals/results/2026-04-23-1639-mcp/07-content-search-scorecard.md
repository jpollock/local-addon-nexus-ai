# Eval Scorecard: 07-content-search (PARTIAL — auto-scored)

**Date:** 2026-04-23  
**Mode:** mcp  
**Model:** claude-sonnet-4-6  
**Run type:** Automated via claude -p  

## Auto-Scored Metrics

| Metric | Value |
|--------|-------|
| Tool calls | 2 |
| Error events | 0 |
| Duration | 34.4s |
| Has result | yes |

## Token Cost (Exact from API)

| Metric | Value |
|--------|-------|
| Input tokens | 4 |
| Output tokens | 823 |
| Cache creation | 18,093 |
| Cache read | 67,499 |
| **Total cost** | **$0.1005** |

## Human Scores Needed

Run: npx ts-node tests/evals/runner/score-eval.ts tests/evals/results/2026-04-23-1639-mcp/07-content-search-transcript.txt

| Dimension | Score | Weight | Notes |
|-----------|-------|--------|-------|
| Task completed (auto) | 100 | 40% | Got a result |
| Steps correct | TBD | 30% | Human review |
| Friction | TBD | 20% | Human review |
| Output clarity | TBD | 10% | Human review |
| **Auto partial** | **40.0** | | Steps/friction/clarity = TBD |

## Result Preview

```
Here's a summary of what I found across your local sites:

---

## Sites with WooCommerce / E-commerce Content

### **Faker Incorporated** — richest WooCommerce content
This is your most substantive e-commerce site. It has actual written content, not just WooCommerce boilerplate pages:

| Post/Page | Type | Highlight |
|---|---|---|
| **How to Get More Out of Your WooCommerce Store** | Post | Article about maximizing WooCommerce — "the most popular e-commerce platform on the planet" |
| **Custom WooCommerce Store Build** | Product | A sellable service: custom storefront on Astra, optimized for speed + mobile |
| **Services** | Page | Digital strategy + implementation services |
| **Shop / Cart / Checkout / My Account** | Pages | Full WooCommerce page set installed |

> Note: "Faker Incorporated" appears 3 times in results — this looks like the same site indexed under multiple names (possibly clones or environment variants).

### **The Curated Shelf** — WooCommerce store skeleton
Has th
```