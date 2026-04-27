# Eval Scorecard: 07-content-search (PARTIAL — auto-scored)

**Date:** 2026-04-23  
**Mode:** cli-skills  
**Model:** claude-sonnet-4-6  
**Run type:** Automated via claude -p  

## Auto-Scored Metrics

| Metric | Value |
|--------|-------|
| Tool calls | 7 |
| Error events | 0 |
| Duration | 37.0s |
| Has result | yes |

## Token Cost (Exact from API)

| Metric | Value |
|--------|-------|
| Input tokens | 8 |
| Output tokens | 1,427 |
| Cache creation | 42,435 |
| Cache read | 196,461 |
| **Total cost** | **$0.2395** |

## Human Scores Needed

Run: npx ts-node tests/evals/runner/score-eval.ts tests/evals/results/2026-04-23-1144-cli-skills/07-content-search-transcript.txt

| Dimension | Score | Weight | Notes |
|-----------|-------|--------|-------|
| Task completed (auto) | 100 | 40% | Got a result |
| Steps correct | TBD | 30% | Human review |
| Friction | TBD | 20% | Human review |
| Output clarity | TBD | 10% | Human review |
| **Auto partial** | **40.0** | | Steps/friction/clarity = TBD |

## Result Preview

```
Here's what your local sites contain around WooCommerce and e-commerce:

**Sites with real content (not just default WooCommerce pages):**

| Site | Post/Page | Type | Snippet |
|------|-----------|------|---------|
| **Faker Incorporated** | How to Get More Out of Your WooCommerce Store | Post | "WooCommerce is the most popular e-commerce platform on the planet — but out of the box, it's just the beginning. Here's how we help our clients squeeze every dollar out of their WooCommerce stores." |
| **Faker Incorporated** | Services | Page | "...every stage of your digital journey. What We Offer Digital Strategy Roadmaps..." |
| **Faker Incorporated** | Shop | Page | WooCommerce shop page |
| **faker-incorporated** | Shop + Cart | Pages | WooCommerce shop/cart |
| **The Curated Shelf** | Shop | Page | WooCommerce shop page |
| **nexustestsite1** | Shop | Page | WooCommerce shop page |
| **nexus-test-site** | Shop | Page | WooCommerce shop page |

**The standout result** is **Faker Incorpo
```