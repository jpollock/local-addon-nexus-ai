# Eval Scorecard: 07-content-search (PARTIAL — auto-scored)

**Date:** 2026-04-23  
**Mode:** cli-skills  
**Model:** claude-sonnet-4-6  
**Run type:** Automated via claude -p  

## Auto-Scored Metrics

| Metric | Value |
|--------|-------|
| Tool calls | 2 |
| Error events | 0 |
| Duration | 25.6s |
| Has result | yes |

## Token Cost (Exact from API)

| Metric | Value |
|--------|-------|
| Input tokens | 4 |
| Output tokens | 703 |
| Cache creation | 15,883 |
| Cache read | 66,547 |
| **Total cost** | **$0.0901** |

## Human Scores Needed

Run: npx ts-node tests/evals/runner/score-eval.ts tests/evals/results/2026-04-23-1535-cli-skills/07-content-search-transcript.txt

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

### Named local sites with actual e-commerce content

| Site | Post/Page | Type | Snippet |
|------|-----------|------|---------|
| **Faker Incorporated** | "How to Get More Out of Your WooCommerce Store" | post | "WooCommerce is the most popular e-commerce platform on the planet — but out of the box, it's just the beginning. Here's how we help our clients squeeze every dollar..." |
| **Faker Incorporated** | "Services" | page | General digital services page mentioning e-commerce strategy |
| **The Curated Shelf** | "Shop" | page | Has a WooCommerce shop |
| **faker-incorporated** | "Shop" + "Cart" | pages | WooCommerce shop pages |
| **nexustestsite1** | "Shop" | page | WooCommerce shop page |
| **nexus-test-site** | "Shop" | page | WooCommerce shop page |

### WPE-synced sites
Many `wpe-*` sites have WooCommerce installed (they all have "My account" and "Cart" pages with WooCommerce sho
```