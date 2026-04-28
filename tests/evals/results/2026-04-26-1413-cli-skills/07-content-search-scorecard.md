# Eval Scorecard: 07-content-search (PARTIAL — auto-scored)

**Date:** 2026-04-26  
**Mode:** cli-skills  
**Model:** claude-sonnet-4-6  
**Run type:** Automated via claude -p  

## Auto-Scored Metrics

| Metric | Value |
|--------|-------|
| Tool calls | 2 |
| Error events | 0 |
| Duration | 33.0s |
| Has result | yes |

## Token Cost (Exact from API)

| Metric | Value |
|--------|-------|
| Input tokens | 5 |
| Output tokens | 576 |
| Cache creation | 26,753 |
| Cache read | 290,938 |
| **Total cost** | **$0.1963** |

## Human Scores Needed

Run: npx ts-node tests/evals/runner/score-eval.ts tests/evals/results/2026-04-26-1413-cli-skills/07-content-search-transcript.txt

| Dimension | Score | Weight | Notes |
|-----------|-------|--------|-------|
| Task completed (auto) | 100 | 40% | Got a result |
| Steps correct | TBD | 30% | Human review |
| Friction | TBD | 20% | Human review |
| Output clarity | TBD | 10% | Human review |
| **Auto partial** | **40.0** | | Steps/friction/clarity = TBD |

## Result Preview

```
Here's what was found across your local sites:

---

**1 site with real e-commerce content:**

**Faker Incorporated** — `How to Get More Out of Your WooCommerce Store` (post, score: 0.67)
> "WooCommerce is the most popular e-commerce platform on the planet — but out of the box, it's just the beginning. Here's how we help our clients squeeze every dollar out of their WooCommerce stores..."

This is the only site with actual authored content about WooCommerce/e-commerce.

---

**Many sites with default WooCommerce boilerplate pages:**

All the `wpe-*` sites matched on auto-generated WooCommerce pages — **Cart** (`[woocommerce_cart]`) and **My account** (`[woocommerce_my_account]`). These are default pages WooCommerce creates on install, not real content.

---

**Summary:** Only **Faker Incorporated** has meaningful WooCommerce content. The rest are WPE-linked installs that happen to have WooCommerce installed (evidenced by the default shortcode pages), but no authored posts or pages abou
```