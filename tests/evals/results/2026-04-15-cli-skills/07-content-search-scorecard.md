# Eval Scorecard: 07-content-search (PARTIAL — auto-scored)

**Date:** 2026-04-15  
**Mode:** cli-skills  
**Model:** claude-sonnet-4-6  
**Run type:** Automated via claude -p  

## Auto-Scored Metrics

| Metric | Value |
|--------|-------|
| Tool calls | 0 |
| Error events | 0 |
| Duration | 141.8s |
| Has result | yes |

## Token Cost (Exact from API)

| Metric | Value |
|--------|-------|
| Input tokens | 24 |
| Output tokens | 6,000 |
| Cache creation | 96,709 |
| Cache read | 970,740 |
| **Total cost** | **$0.7440** |

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
Now I have the full picture. Let me compile the results clearly.

Here are your local sites with WooCommerce or e-commerce content:

---

## Sites with WooCommerce / E-Commerce Content

### 1. Faker Incorporated
The most content-rich e-commerce local site. Has an active WooCommerce store plus editorial content:

| Type | Title | Preview |
|------|-------|---------|
| post | **How to Get More Out of Your WooCommerce Store** | "WooCommerce is the most popular e-commerce platform on the planet — but out of the box, it's just the beginning. Here's how we help our clients squeeze every dollar out of their WooCommerce stores..." |
| page | **Shop** | WooCommerce product listing page |
| page | **Cart** | `[woocommerce_cart]` |
| page | **Checkout** | `[woocommerce_checkout]` |
| page | **Services** | Mentions e-commerce strategy in service offerings |

---

### 2. The Curated Shelf
Linked to WPE (`thecuratedshel@production`). Full WooCommerce store:

| Type | Title | Preview |
|------|------
```