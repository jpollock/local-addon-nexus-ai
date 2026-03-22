# E2E Full Setup - Production-Ready Testing

**Philosophy:** Test the REAL production flow, not a minimal/mocked version.

**Target:** Complete AI setup with:
- ✅ AI Experiments plugin
- ✅ Real API keys (Anthropic, OpenAI, etc.)
- ✅ Ollama provider plugin
- ✅ ACF PRO with abilities enabled
- ✅ Full webhook/event flow

**No skips.** Test what users will actually use.

---

## What We Need

### 1. Bundled Plugins

**Current state:**
```
wp-plugins/
├── ai/                          ✅ Have it
├── ai-provider-for-ollama/      ✅ Have it
└── nexus-ai-connector/          ✅ Have it
```

**Missing:**
```
wp-plugins/
└── advanced-custom-fields-pro/  ❌ Need to add
```

**Action:** Get ACF PRO plugin files and add to `wp-plugins/`

**Options:**
1. Download from ACF PRO account (https://www.advancedcustomfields.com/my-account/)
2. Copy from existing Local site that has it
3. Use ACF PRO license to download via CLI

### 2. API Keys Configuration

**Current:** E2E setup doesn't configure API keys

**Needed:** Set API keys in registry storage before running tests

**Implementation:**

**File:** `tests/e2e/setup.ts`

```typescript
import { STORAGE_KEYS } from '../../src/common/constants';

module.exports = async function globalSetup() {
  // ... existing setup

  // Configure API keys for full testing
  console.log('[E2E Setup] Configuring API keys...');

  const apiKeys: Record<string, string> = {};

  // Anthropic (Claude)
  if (process.env.ANTHROPIC_API_KEY) {
    apiKeys.anthropic = process.env.ANTHROPIC_API_KEY;
    console.log('[E2E Setup] Anthropic API key configured');
  } else {
    console.warn('[E2E Setup] ANTHROPIC_API_KEY not set - provider tests will be limited');
  }

  // OpenAI
  if (process.env.OPENAI_API_KEY) {
    apiKeys.openai = process.env.OPENAI_API_KEY;
    console.log('[E2E Setup] OpenAI API key configured');
  } else {
    console.warn('[E2E Setup] OPENAI_API_KEY not set - provider tests will be limited');
  }

  // Google (Gemini)
  if (process.env.GOOGLE_API_KEY) {
    apiKeys.google = process.env.GOOGLE_API_KEY;
    console.log('[E2E Setup] Google API key configured');
  }

  // Store in registry
  if (Object.keys(apiKeys).length > 0) {
    // Access the registry storage directly
    const { getRegistryStorage } = require('../../src/main/content/IndexRegistry');
    const storage = getRegistryStorage();
    storage.set(STORAGE_KEYS.API_KEYS, apiKeys);
    console.log(`[E2E Setup] Configured ${Object.keys(apiKeys).length} API key(s)`);
  } else {
    console.warn('[E2E Setup] No API keys configured - some tests will skip');
  }

  // ... rest of setup
};
```

**Environment setup:**

**File:** `.env.e2e` (create this)

```bash
# E2E Test Environment Variables
# Copy to .env.e2e.local and fill in your keys (gitignored)

# Required for full AI setup testing
ANTHROPIC_API_KEY=sk-ant-...
OPENAI_API_KEY=sk-...

# Optional
GOOGLE_API_KEY=...

# Ollama (should be auto-detected if running)
# OLLAMA_HOST=http://localhost:11434
```

**File:** `.gitignore` (update)

```
.env.e2e.local
```

### 3. ACF PRO Installation

**Approach 1: Bundle in wp-plugins/** (RECOMMENDED)

```bash
# Get ACF PRO plugin
# Download from: https://www.advancedcustomfields.com/my-account/

# Extract to:
wp-plugins/advanced-custom-fields-pro/
  ├── acf.php
  ├── includes/
  ├── assets/
  └── ...
```

Then update `setup-ai.ts` to install ACF PRO before checking for it:

```typescript
// New step before Step 5 in setup-ai.ts

// Step 4b: Install ACF PRO if not present
let acfProPlugin: 'installed' | 'already_active' | 'skipped' = 'skipped';

const existingAcf = findPlugin(plugins, 'advanced-custom-fields-pro');

if (!existingAcf && aiPlugin !== 'failed') {
  try {
    const sitePluginsDir = await getSitePluginsDir(siteId, localServices);
    if (sitePluginsDir) {
      const site = localServices.resolveSiteObject(siteId) as any;
      validatePluginPath(sitePluginsDir, site.paths.webRoot);

      const pluginDest = path.join(sitePluginsDir, 'advanced-custom-fields-pro');
      const pluginSource = path.join(WP_PLUGINS_ROOT, 'advanced-custom-fields-pro');

      if (fs.existsSync(pluginSource)) {
        logger.info(`${tag} Installing ACF PRO on site ${siteId}`);
        fs.cpSync(pluginSource, pluginDest, { recursive: true });

        const result = await localServices.wpCliRun(
          siteId,
          ['plugin', 'activate', 'advanced-custom-fields-pro']
        );

        if (result.success) {
          acfProPlugin = 'installed';
          logger.info(`${tag} ACF PRO installed on site ${siteId}`);
        }
      } else {
        logger.info(`${tag} ACF PRO not bundled, skipping (source: ${pluginSource})`);
      }
    }
  } catch (err) {
    logger.error(`${tag} ACF PRO installation failed: ${err}`);
  }
} else if (existingAcf && existingAcf.status === 'active') {
  acfProPlugin = 'already_active';
}
```

**Approach 2: License Key Installation**

If we have the license key in env vars:

```typescript
if (!existingAcf && process.env.ACF_PRO_LICENSE) {
  // Download via license key
  const downloadUrl = `https://connect.advancedcustomfields.com/v2/plugins/download?...`;
  // Install via wp-cli
}
```

### 4. Enable Ollama in Tests

**File:** `tests/e2e/15-setup-ai.e2e.test.ts`

Update to enable Ollama:

```typescript
it('wp_setup_ai completes on the test site', async () => {
  const client = getClient();

  // Check if Ollama is running
  const ollamaResult = await client.callTool('list_ollama_models');
  const ollamaAvailable = !ollamaResult.isError;

  // Call setup with Ollama enabled
  const result = await client.callTool('wp_setup_ai', {
    site: testSite.name,
    enable_ollama: ollamaAvailable,  // Pass through to setup
  });

  expectSuccess(result);

  const resultText = resultText(result);

  // Expect full setup, not skips
  expect(resultText).toContain('AI Experiments plugin');

  if (ollamaAvailable) {
    expect(resultText).toContain('Ollama provider');
  }

  // Check for API keys if configured
  const hasApiKeys = process.env.ANTHROPIC_API_KEY || process.env.OPENAI_API_KEY;
  if (hasApiKeys) {
    expect(resultText).toMatch(/API key.*synced/i);
  }

  // Check for ACF PRO if bundled
  const acfBundled = fs.existsSync(
    path.join(__dirname, '../../wp-plugins/advanced-custom-fields-pro')
  );
  if (acfBundled) {
    expect(resultText).toMatch(/ACF abilities/i);
  }
});
```

---

## Setup Checklist

### Prerequisites

- [ ] ACF PRO plugin files in `wp-plugins/advanced-custom-fields-pro/`
- [ ] `.env.e2e.local` with real API keys
- [ ] Ollama running (`ollama serve`)
- [ ] Local running

### Code Changes

**1. Update `setup-ai.ts`:**
- [ ] Install AI plugin from bundled source (not WordPress.org)
- [ ] Install ACF PRO from bundled source (if available)
- [ ] Accept `enable_ollama` parameter from MCP tool call

**2. Update E2E setup:**
- [ ] Load API keys from environment
- [ ] Store in registry storage
- [ ] Log what's configured

**3. Update tests:**
- [ ] Call `wp_setup_ai` with `enable_ollama: true`
- [ ] Verify full setup (not skipped steps)
- [ ] Check webhooks registered
- [ ] Verify credentials synced

### Expected Test Results

**With full configuration:**

```
Setup for AI succeeded on "nexus-e2e-test":
  AI Plugin: installed ✓
  Provider Plugins: installed ✓ (anthropic, openai)
  Ollama Provider: installed ✓
  AI Experiments: enabled ✓
  Credentials: synced ✓ (2 API keys)
  ACF Abilities: enabled ✓
```

**All tests should PASS, not skip:**
- ✅ AI setup tests (3 tests)
- ✅ Event processing tests (1 test)
- ✅ WordPress events tests (3 tests)
- ✅ Graph deletion tests (3 tests)

**Total: 10 tests fully passing with real setup**

---

## Implementation Steps

### Step 1: Get ACF PRO (15 min)

**Option A: Download from account**
1. Go to https://www.advancedcustomfields.com/my-account/
2. Download latest ACF PRO
3. Extract to `wp-plugins/advanced-custom-fields-pro/`

**Option B: Copy from existing site**
```bash
# Find a Local site that has ACF PRO
SITE_PATH="/Users/jeremy.pollock/Library/Application Support/Local/run/<site-id>/app/public"

# Copy to wp-plugins
cp -r "$SITE_PATH/wp-content/plugins/advanced-custom-fields-pro" wp-plugins/
```

**Verify:**
```bash
ls -la wp-plugins/advanced-custom-fields-pro/acf.php
```

### Step 2: Configure API Keys (10 min)

```bash
# Create environment file
cp .env.e2e .env.e2e.local

# Edit and add your keys
code .env.e2e.local

# Add to .gitignore if not already there
echo ".env.e2e.local" >> .gitignore
```

### Step 3: Update setup-ai.ts (1 hour)

Make 3 changes:

1. **AI Experiments plugin** - copy from bundled instead of downloading
2. **ACF PRO** - copy from bundled if available
3. **MCP tool parameter** - accept `enable_ollama` from tool call

### Step 4: Update E2E setup (30 min)

1. Load `.env.e2e.local` in setup
2. Configure API keys in registry storage
3. Log what's available

### Step 5: Update tests (30 min)

1. Pass `enable_ollama: true` to setup
2. Update assertions to expect success, not skips
3. Verify webhooks, credentials, abilities

### Step 6: Test (30 min)

```bash
# Start Ollama
ollama serve

# Run AI setup tests
npm run test:e2e -- tests/e2e/15-setup-ai.e2e.test.ts

# Run event processing (should pass now)
npm run test:e2e -- tests/e2e/16-event-processing.e2e.test.ts
npm run test:e2e -- tests/e2e/18-wordpress-events.e2e.test.ts
npm run test:e2e -- tests/e2e/19-graph-deletion.e2e.test.ts
```

**Expected: All 10 tests pass with full setup**

---

## Total Effort

- Get ACF PRO: 15 min
- Configure environment: 10 min
- Update setup-ai.ts: 1 hour
- Update E2E setup: 30 min
- Update tests: 30 min
- Testing: 30 min

**Total: ~3 hours for full production-ready setup**

---

## Next Steps

1. **Get ACF PRO** - Which option do you prefer?
   - Download from your ACF account?
   - Copy from an existing Local site?
   - I can guide you through either

2. **API Keys** - Do you want to:
   - Use environment variables (recommended)?
   - Store them differently?

3. **Ready to implement?** Once we have ACF PRO, I can start coding the updates.

---

This gives you a **real E2E test suite** that validates the actual production flow, not a minimal/mocked version. No more skips - just real testing.

What's your preference for getting ACF PRO into the wp-plugins directory?
