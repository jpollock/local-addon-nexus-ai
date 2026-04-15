# Eval Scorecard: 07-content-search (PARTIAL — auto-scored)

**Date:** 2026-04-15  
**Mode:** cli-skills  
**Model:** claude-sonnet-4-6  
**Run type:** Automated via claude -p  

## Auto-Scored Metrics

| Metric | Value |
|--------|-------|
| Tool calls | 20 |
| Error events | 0 |
| Duration | 95.7s |
| Has result | yes |

## Token Cost (Exact from API)

| Metric | Value |
|--------|-------|
| Input tokens | 16 |
| Output tokens | 3,754 |
| Cache creation | 73,032 |
| Cache read | 535,524 |
| **Total cost** | **$0.4909** |

## Human Scores Needed

Run: npx ts-node tests/evals/runner/score-eval.ts tests/evals/results/2026-04-15-cli-skills/07-content-search-transcript.txt

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

## Local Sites with WooCommerce / E-Commerce Content

### **Faker Incorporated** — most substantive content
| Post/Page | Type | Snippet |
|---|---|---|
| **How to Get More Out of Your WooCommerce Store** | post | "WooCommerce is the most popular e-commerce platform on the planet — but out of the box, it's just the beginning. Here's how we help our clients squeeze every dollar out of their WooCommerce stores..." |
| **Custom WooCommerce Store Build** | product | "A fully designed, custom WooCommerce storefront built on Astra — optimized for speed, mobile, and conversion. Includes up to 20 products configured..." |
| **Services** | page | Mentions digital strategy and e-commerce services |
| Shop / Cart / Checkout | pages | Standard WooCommerce pages |

### **faker-incorporated** (lowercase slug — appears to be a separate/older instance)
- Shop, Cart, Checkout pages

### **The Curated Shelf**
- Shop and Checkout pages (WooCommerce scaff
```