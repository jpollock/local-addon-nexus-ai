# Eval Scorecard: 07-content-search (PARTIAL — auto-scored)

**Date:** 2026-04-25  
**Mode:** cli-skills  
**Model:** claude-sonnet-4-6  
**Run type:** Automated via claude -p  

## Auto-Scored Metrics

| Metric | Value |
|--------|-------|
| Tool calls | 2 |
| Error events | 0 |
| Duration | 34.1s |
| Has result | yes |

## Token Cost (Exact from API)

| Metric | Value |
|--------|-------|
| Input tokens | 4 |
| Output tokens | 870 |
| Cache creation | 14,801 |
| Cache read | 140,433 |
| **Total cost** | **$0.1107** |

## Human Scores Needed

Run: npx ts-node tests/evals/runner/score-eval.ts tests/evals/results/2026-04-25-1600-cli-skills/07-content-search-transcript.txt

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

### **Faker Incorporated** — most substantive content
| Post/Page | Type | Preview |
|-----------|------|---------|
| **How to Get More Out of Your WooCommerce Store** | post | "WooCommerce is the most popular e-commerce platform on the planet — but out of the box, it's just the beginning. Here's how we help our clients squeeze every dollar out of their WooCommerce stores..." |
| **Services** | page | Mentions digital strategy and services relevant to e-commerce |
| **Shop** | page | WooCommerce shop page |
| **Cart** | page | `[woocommerce_cart]` |

This site has the most meaningful e-commerce content — an actual blog post about WooCommerce strategy.

### **The Curated Shelf**
- **Shop** page (Score: 0.51) — active WooCommerce storefront

### **nexustestsite1** and **nexus-test-site**
- **Shop** pages only — standard WooCommerce setup, no unique content

### **WPE-prefixed sites (many)**
```