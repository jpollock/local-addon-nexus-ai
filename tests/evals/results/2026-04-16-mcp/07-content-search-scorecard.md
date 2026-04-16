# Eval Scorecard: 07-content-search (PARTIAL — auto-scored)

**Date:** 2026-04-16  
**Mode:** mcp  
**Model:** claude-sonnet-4-6  
**Run type:** Automated via claude -p  

## Auto-Scored Metrics

| Metric | Value |
|--------|-------|
| Tool calls | 3 |
| Error events | 0 |
| Duration | 29.9s |
| Has result | yes |

## Token Cost (Exact from API)

| Metric | Value |
|--------|-------|
| Input tokens | 10 |
| Output tokens | 791 |
| Cache creation | 41,068 |
| Cache read | 117,622 |
| **Total cost** | **$0.2012** |

## Human Scores Needed

Run: npx ts-node tests/evals/runner/score-eval.ts tests/evals/results/2026-04-16-mcp/07-content-search-transcript.txt

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

**Faker Incorporated** — most WooCommerce-rich site
- **"How to Get More Out of Your WooCommerce Store"** (post, score: 0.66) — highest relevance hit, talks about WooCommerce as an e-commerce platform
- **"Custom WooCommerce Store Build"** (product, score: 0.53) — a WooCommerce product listing for a storefront build service
- Standard WooCommerce pages: Shop, Cart, Checkout, My Account

**The Curated Shelf** — WooCommerce store
- Standard WooCommerce pages: Shop, Cart, My Account — no custom posts with e-commerce content

**nexus-test-site** — WooCommerce store
- Same pattern: Shop, Cart, My Account pages only

**pm-toolkit-hub** — tangentially related
- **"Customer Segments"** (pm_guide, score: 0.40) — mentions e-commerce site owners as a customer segment
- A few PM session posts referencing e-commerce context

---

**Key takeaway:** "Faker Incorporated" is the only site with actual WooCommerce-focused *content* (a blog post + product
```