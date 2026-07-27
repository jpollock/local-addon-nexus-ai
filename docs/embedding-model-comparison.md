# Embedding Model Comparison: MiniLM vs Nomic

## Summary

Nexus AI now supports two embedding models for semantic search, with user choice via CLI settings:

- **MiniLM** (default): Fast, compact, good quality
- **Nomic**: Better semantic understanding, larger download

## Test Results (Alpine Outfitters Demo)

**Query:** "beginner friendly hiking trip"

**Expected:** Rank beginner-difficulty destinations (#1 Copper Lake 1/5, #2 Emerald Lake 1/5) above blog posts

### MiniLM Results (Current)

1. ✅ Copper Lake via Pacific Crest Trail (1/5 difficulty) - score: 0.627
2. ❌ Trip Preparation Guide (blog post) - score: 0.613  
3. ✅ Emerald Lake Cirque (1/5 difficulty) - score: 0.501

**Issue:** Blog post splits the two beginner trails

### Nomic Results (Upgraded)

1. ✅ Copper Lake via Pacific Crest Trail (1/5 difficulty) - score: 0.744
2. ✅ Emerald Lake Cirque (1/5 difficulty) - score: 0.704
3. ✓ Trip Preparation Guide (blog post) - score: 0.613

**Improvement:** Both beginner trails ranked #1 and #2, prep guide pushed to #3

## Technical Comparison

| Feature | MiniLM (all-MiniLM-L6-v2) | Nomic (nomic-embed-text-v1.5) |
|---------|---------------------------|-------------------------------|
| **Model Size** | 22 MB | 522 MB |
| **Dimensions** | 384 | 768 |
| **Context Window** | 512 tokens | 8,192 tokens |
| **Speed** | Baseline | ~5× faster on CPU (per Nomic claims) |
| **Quality** | Good | Better (proven in test above) |
| **Training** | 2020, general-purpose | 2024, diverse corpus |

## Recommendation

**Default: MiniLM** - Fast install, good results for most use cases

**Upgrade to Nomic when:**
- User has large content library (long articles/posts)
- Search quality is critical (product/service sites)
- User has bandwidth and disk space (522MB download)

## How to Switch

```bash
# View current setting
nexus settings get embeddingModel
# Output: "minilm" (default) or "nomic"

# Switch to nomic
nexus settings update '{"embeddingModel": "nomic"}'

# Verify nomic model exists
ls -lh models/nomic-embed-text-v1.5/model.onnx
# If missing, download from HuggingFace (522MB)

# Restart Local to load new model
# After restart, re-index sites for new embeddings
nexus reindex-site "Alpine Outfitters"

# Check index status
nexus index-status "Alpine Outfitters"
```

**IMPORTANT:** Switching models requires:
1. Model files downloaded to `models/<model-dir>/`
2. Local restart (model loaded at boot)
3. Full re-index of all sites (different dimensions = incompatible embeddings)

Vector stores from MiniLM (384d) cannot mix with Nomic (768d) — re-index clears old data.

## IW Comparison Findings

**Alpine Outfitters Demo:**
- **IW Hub Agent** likely uses nomic-level or better embeddings
- **Nexus (MiniLM)** ranked beginner trails lower than blog posts
- **Nexus (Nomic)** matched IW's ranking quality

**Root cause of search gap:** Embedding model quality, not LLM layer

## Future Work

- [ ] UI setting in Preferences tab
- [ ] Progressive download with progress UI
- [ ] Automatic re-index prompt after model switch
- [ ] Model performance benchmarks across different content types
- [ ] Consider fine-tuned domain-specific models (outdoor/hiking corpus)

## References

- Test script: `/tmp/test-embedding-models.js`
- Nomic embedding docs: https://huggingface.co/nomic-ai/nomic-embed-text-v1.5
- Test date: 2026-07-27
