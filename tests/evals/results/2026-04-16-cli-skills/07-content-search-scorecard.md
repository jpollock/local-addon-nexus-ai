# Eval Scorecard: 07-content-search (PARTIAL — auto-scored)

**Date:** 2026-04-16  
**Mode:** cli-skills  
**Model:** claude-sonnet-4-6  
**Run type:** Automated via claude -p  

## Auto-Scored Metrics

| Metric | Value |
|--------|-------|
| Tool calls | 5 |
| Error events | 0 |
| Duration | 33.9s |
| Has result | yes |

## Token Cost (Exact from API)

| Metric | Value |
|--------|-------|
| Input tokens | 7 |
| Output tokens | 968 |
| Cache creation | 39,411 |
| Cache read | 147,053 |
| **Total cost** | **$0.2064** |

## Human Scores Needed

Run: npx ts-node tests/evals/runner/score-eval.ts tests/evals/results/2026-04-16-cli-skills/07-content-search-transcript.txt

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

**Sites with WooCommerce/e-commerce content:**

**Faker Incorporated** — most relevant, actively uses WooCommerce:
- `Checkout` page — `[woocommerce_checkout]` shortcode
- `Cart` page — `[woocommerce_cart]` shortcode
- `My account` page — `[woocommerce_my_account]` shortcode
- `Shop` page
- **Post: "How to Get More Out of Your WooCommerce Store"** (score 0.64–0.52) — substantive editorial content about WooCommerce as an e-commerce platform

**faker-incorporated** (likely a separate local variant):
- Same WooCommerce pages: Checkout, Cart, My account, Shop

**The Curated Shelf** — also has WooCommerce:
- My account, Shop, Checkout pages

**nexus-test-site** — basic WooCommerce pages:
- My account, Shop, Checkout

**frostscape** — tangential e-commerce mentions in blog posts about web design/digital agencies (lower relevance)

**pm-toolkit-hub** — mentions e-commerce in PM/research guides (not actual WooCommerce)

**Most relevant post:** `Fak
```