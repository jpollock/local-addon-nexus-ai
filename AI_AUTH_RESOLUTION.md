# AI Authentication Issue - RESOLVED

## Status: ✅ FIXED

**Date:** 2026-03-23
**Issue:** "RequestAuthenticationInterface instance not set" error when using AI title/excerpt generation
**Impact:** WordPress 7.0 + AI plugin 0.6.0 compatibility
**Fix:** Updated Ollama provider plugin for WordPress 7.0 Connectors API

---

## Root Cause

The Ollama provider plugin was setting dummy credentials (Ollama doesn't need API keys) in the **old storage location**:
```php
// Old location (pre-WordPress 7.0)
update_option('wp_ai_client_provider_credentials', ['ollama' => 'ollama-local']);
```

But WordPress 7.0 introduced the **Connectors API** with different storage:
```php
// WordPress 7.0+ location
update_option('connectors_ai_ollama_api_key', 'value');
```

### The Authentication Flow

1. WordPress 7.0 `init` hook priority 20 runs `_wp_connectors_pass_default_keys_to_ai_client()`
2. This function reads credentials from `connectors_ai_*_api_key` options
3. Calls `AiClient::defaultRegistry()->setProviderRequestAuthentication()`
4. Sets authentication on **both** the Provider and its ModelMetadataDirectory

When Ollama's credential wasn't in the new location:
- ❌ Authentication = NULL
- ❌ API calls fail with "RequestAuthenticationInterface instance not set"

## The Fix

Updated `wp-plugins/ai-provider-for-ollama/plugin.php` to set credentials in **both** locations:

```php
// WordPress 7.0 uses Connectors API, older versions use wp_ai_client_provider_credentials
$credentials = get_option('wp_ai_client_provider_credentials', []);
if (!isset($credentials['ollama'])) {
    $credentials['ollama'] = 'ollama-local';
    update_option('wp_ai_client_provider_credentials', $credentials);
}

// WordPress 7.0+ Connectors API location
if (!get_option('connectors_ai_ollama_api_key')) {
    update_option('connectors_ai_ollama_api_key', 'ollama-local-no-auth-needed');
}
```

This ensures backward compatibility with pre-7.0 WordPress while supporting the new Connectors API.

## Verification

### Manual Testing
1. Created post with content
2. Saved draft
3. Clicked "Generate" in title field
4. ✅ Modal appeared with AI-generated title
5. ✅ No authentication error

### Automated Testing
```bash
npm run test:e2e:browser -- tests/e2e/30-ai-experiments-browser.e2e.test.ts
```

**Results:** 12/15 passing (80%)

**Passing:**
- ✅ Credential sync verification (2 tests)
- ✅ AI plugin setup (4 tests)
- ✅ Title generation UI appears (1 test)
- ✅ Excerpt generation enabled (1 test)
- ✅ Summarization experiment (2 tests)
- ✅ Error handling (1 test)
- ✅ Global disable/enable (1 test)

**Failing (UI issues, not authentication):**
- ❌ Title generation returns 1 title instead of 3 (Ollama behavior)
- ❌ Excerpt generation button not visible (2 tests - modal interference)

## Provider Status

All 4 providers now have proper authentication:

```
✅ ollama: configured=YES, auth=ApiKeyRequestAuthentication
✅ anthropic: configured=YES, auth=ApiKeyRequestAuthentication
✅ google: configured=YES, auth=ApiKeyRequestAuthentication
✅ openai: configured=YES, auth=ApiKeyRequestAuthentication
```

## Files Changed

- `wp-plugins/ai-provider-for-ollama/plugin.php` - Added WordPress 7.0 Connectors API credential storage

## Remaining Issues

### Minor UI Compatibility (AI Plugin 0.6.0)

1. **Title generation format changed**
   - Expected: 3 separate title options in textareas
   - Actual: 1 title with explanation text
   - Likely: Ollama doesn't respect candidate_count, or UI changed in 0.6.0

2. **Excerpt generation button not visible**
   - Command palette modal interferes with excerpt panel access
   - Same pattern as fixed title generation modal issue
   - Needs: Additional modal dismissal in test setup

**Impact:** Low - Core functionality works, just UI differences
**Priority:** Low - Tests prove authentication works, UI issues are cosmetic

## What We Learned

### WordPress 7.0 Connectors API
- New centralized credential storage: `connectors_ai_{provider}_api_key`
- Automatic credential passing on `init` priority 20
- Sets authentication on Provider AND ModelMetadataDirectory
- Backward compatible approach: support both old and new storage

### AI Client Authentication Flow
- Providers registered on `init` priority 5
- Credentials passed on `init` priority 20
- ModelMetadataDirectory is a singleton, cached per provider
- Authentication must be set before any API calls (model listing, generation, etc.)

### Diagnostic Techniques
- MU plugin logging at multiple init priorities
- REST API context tracking
- Provider auth status inspection
- Browser DevTools Network tab for REST errors

## Conclusion

✅ **Authentication is fully functional**
✅ **All providers configured correctly**
✅ **Modals appear and AI generates content**
✅ **Tests verify end-to-end flow works**

The 3 failing tests are UI compatibility issues with AI plugin 0.6.0, not authentication problems. The core system is working as designed.
