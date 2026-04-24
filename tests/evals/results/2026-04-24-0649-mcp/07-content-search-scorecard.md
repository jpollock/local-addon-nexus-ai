# Eval Scorecard: 07-content-search (PARTIAL — auto-scored)

**Date:** 2026-04-24  
**Mode:** mcp  
**Model:** claude-sonnet-4-6  
**Run type:** Automated via claude -p  

## Auto-Scored Metrics

| Metric | Value |
|--------|-------|
| Tool calls | 2 |
| Error events | 0 |
| Duration | 40.7s |
| Has result | yes |

## Token Cost (Exact from API)

| Metric | Value |
|--------|-------|
| Input tokens | 4 |
| Output tokens | 790 |
| Cache creation | 23,610 |
| Cache read | 184,128 |
| **Total cost** | **$0.1556** |

## Human Scores Needed

Run: npx ts-node tests/evals/runner/score-eval.ts tests/evals/results/2026-04-24-0649-mcp/07-content-search-transcript.txt

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

### **Faker Incorporated** — most relevant
This site has actual WooCommerce posts, not just boilerplate pages:

| Post | Type | Relevance |
|------|------|-----------|
| **How to Get More Out of Your WooCommerce Store** | Blog post | 63% |
| **Custom WooCommerce Store Build** | Product | 57% |
| Shop, Cart, Checkout, My account | WC pages | Standard |

The blog post mentions optimizing WooCommerce stores for clients. The product listing is a "Custom WooCommerce Store Build" service offering on an Astra theme.

---

### **Sites with standard WooCommerce pages only**
These sites have WooCommerce installed (Shop/Cart/Checkout/My Account pages) but no unique content about it:

- **The Curated Shelf**
- **nexus-test-site**
- **nexustestsite1**
- **faker-incorporated** (appears to be a duplicate/clone of Faker Incorporated)

---

### **pm-toolkit-hub** — tangentially related
Has PM research con
```