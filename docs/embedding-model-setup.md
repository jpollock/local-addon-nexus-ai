# Embedding Model Setup

Nexus AI supports two embedding models for semantic search:

- **MiniLM** (default): 22MB, 384 dimensions, 512 token context
- **Nomic**: 522MB, 768 dimensions, 8192 token context

## Switching Models

### Via MCP (Claude Code, API)

```typescript
// Update settings
await tools.call('nexus_update_settings', {
  patch: JSON.stringify({ embeddingModel: 'nomic' })
});

// Verify change
const settings = await tools.call('nexus_get_settings', {});
console.log(settings.embeddingModel); // "nomic"
```

### Via Local UI (when implemented)

the `embeddingModel` setting: `nexus settings set embeddingModel bge-small` (values: `minilm` | `bge-small`)

**Radio buttons:**
- ○ Standard (MiniLM, 22MB) - Fast, good quality
- ○ Premium (Nomic, 522MB) - Best quality, slower ⬇️ 522MB download

### Manual Settings File Edit

```bash
# Settings stored in Local's config
# ~/Library/Application Support/Local/userData.json
```

## After Switching

1. **Restart Local** - Model is loaded at boot time
2. **Re-index all sites** - Different dimensions = incompatible vectors

```bash
# MCP tool
await tools.call('reindex_site', { site: 'Site Name' });

# Or via CLI (when available)
nexus reindex-site "Site Name"
```

**Why re-index is required:**

Vector dimensions must match across all embeddings in a store:
- MiniLM: 384 dimensions
- Nomic: 768 dimensions

Mixing them causes dimension mismatch errors. Re-indexing clears old embeddings and regenerates with the new model.

## Downloading Models

Models are bundled in the addon distribution. If a model is missing:

### Nomic Model

```bash
cd models
mkdir -p nomic-embed-text-v1.5
cd nomic-embed-text-v1.5

# Download model.onnx (522MB)
curl -L https://huggingface.co/nomic-ai/nomic-embed-text-v1.5/resolve/main/onnx/model.onnx -o model.onnx

# Download tokenizer (694KB)
curl -L https://huggingface.co/nomic-ai/nomic-embed-text-v1.5/resolve/main/tokenizer.json -o tokenizer.json

# Extract vocab.txt from tokenizer.json (required for WordPieceTokenizer)
node -e "
const fs = require('fs');
const tokenizer = JSON.parse(fs.readFileSync('tokenizer.json', 'utf-8'));
const vocab = tokenizer.model.vocab;
const sorted = Object.entries(vocab).sort((a, b) => a[1] - b[1]);
const lines = sorted.map(([token, _]) => token);
fs.writeFileSync('vocab.txt', lines.join('\n'));
console.log('Extracted', lines.length, 'tokens');
"
```

### MiniLM Model

Already included in addon. If missing:

```bash
cd models
mkdir -p all-MiniLM-L6-v2-quantized
cd all-MiniLM-L6-v2-quantized

# Download from release assets or HuggingFace
```

## Technical Details

**Model Loading:**

```typescript
// src/main/index.ts
const settings = registryStorage.get(STORAGE_KEYS.SETTINGS);
const modelKey = settings?.embeddingModel ?? 'minilm';
const modelConfig = EMBEDDING_MODELS[modelKey];
const modelsDir = path.join(addonDir, 'models', modelConfig.dir);

const embeddingService = new EmbeddingService(
  modelsDir,
  modelConfig.dimensions,
  modelConfig.contextWindow
);
```

**Model Constants:**

```typescript
// src/common/constants.ts
export const EMBEDDING_MODELS = {
  minilm: {
    dir: 'all-MiniLM-L6-v2-quantized',
    dimensions: 384,
    contextWindow: 256,
  },
  nomic: {
    dir: 'nomic-embed-text-v1.5',
    dimensions: 768,
    contextWindow: 8192,
  },
} as const;
```

## When to Use Nomic

**Upgrade to Nomic when:**
- Large content library (long articles, documentation)
- Search quality is critical (product/service sites)
- Context matters (8K token window captures full articles)
- Disk space available (522MB vs 22MB)

**Keep MiniLM when:**
- Fast install matters
- Disk constrained
- Good-enough quality acceptable
- Small/medium content chunks

## Performance Comparison

See `docs/embedding-model-comparison.md` for Alpine Outfitters test results showing nomic's improved semantic ranking.
