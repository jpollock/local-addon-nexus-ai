# AI Experiments Browser Testing

## Overview

Browser tests that verify the complete AI Experiments functionality with synced credentials:
1. Credentials synced from Local to WordPress
2. AI Experiments enabled globally
3. Individual experiments work correctly
4. AI generation uses synced API keys
5. UI interactions function properly

## Test Coverage

### 1. Credential Sync Verification (2 tests)

**Browser UI Check**
- Navigate to WP AI Client credentials page
- Verify Anthropic API key field populated
- Verify OpenAI API key field populated
- Verify Google AI API key field populated

**WP-CLI Verification**
- Query `ai_client_anthropic_api_key` option
- Verify key exists and matches format (`sk-ant-*`)

### 2. AI Experiments Setup (4 tests)

**Plugin Status**
- Verify AI plugin installed and active
- Check for "Deactivate" link in plugins list

**Global Enable/Disable**
- Navigate to experiments settings page
- Click "Enable Experiments" button
- Verify success notice appears
- Confirm "Disable Experiments" button visible

**Individual Experiments**
- Enable title generation experiment
- Enable excerpt generation experiment
- Verify checkboxes saved correctly

### 3. Title Generation Experiment (2 tests)

**UI Visibility**
- Create new post with content
- Click into title field
- Verify title toolbar appears
- Confirm "Generate" button visible

**AI Generation**
- Click "Generate" button
- Wait for modal to appear
- Verify 3 title options generated
- Select first option
- Confirm title inserted into editor
- **Timeout**: 60 seconds (AI API calls)

### 4. Excerpt Generation Experiment (2 tests)

**UI Visibility**
- Create post with content
- Open post settings sidebar
- Open excerpt panel
- Verify "Generate with AI" button visible

**AI Generation**
- Click generate excerpt button
- Wait for AI processing
- Verify excerpt appears in textarea
- Confirm excerpt is concise (<200 chars)
- **Timeout**: 60 seconds (AI API calls)

### 5. Content Summarization Experiment (2 tests)

**Enable Experiment**
- Navigate to experiments settings
- Enable content summarization
- Verify settings saved

**Block Availability**
- Create new post
- Add content to summarize
- Open block inserter
- Search for "AI Summary" block
- Verify block appears in search results

### 6. Error Handling (2 tests)

**API Error Handling**
- Trigger title generation
- Verify modal appears even if error
- Confirm graceful degradation

**Global Disable**
- Disable experiments globally
- Create new post
- Verify AI UI elements hidden
- Re-enable for subsequent tests

### 7. Provider Selection (1 test)

**Provider Configuration**
- Query `ai_experiment_title-generation_provider` option
- Verify provider is one of: anthropic, openai, google

## Test Architecture

```
Local → Credential Sync → WordPress
    ↓
WordPress AI Client Options
    ↓
AI Experiments Settings
    ↓
Block Editor UI (Title/Excerpt/Summary)
    ↓
AI API Call (Anthropic/OpenAI/Google)
    ↓
Generated Content
    ↓
Inserted into Editor
    ↓
Test Verification ✓
```

## Running Tests

### All AI Experiments Tests
```bash
npm run test:e2e:browser -- --grep "AI Experiments"
```

### Specific Experiment
```bash
# Title generation only
npm run test:e2e:browser -- --grep "Title Generation"

# Excerpt generation only
npm run test:e2e:browser -- --grep "Excerpt Generation"

# Credential sync only
npm run test:e2e:browser -- --grep "Credential Sync"
```

### Interactive Mode
```bash
npm run test:e2e:browser:ui
# Then select AI Experiments tests from UI
```

### Debug Mode
```bash
npm run test:e2e:browser:debug -- --grep "AI Experiments"
```

## Test Data

### Sample Content for Title Generation
```
WordPress is a powerful content management system used by millions
of websites worldwide. It offers flexibility, ease of use, and a
vast ecosystem of plugins and themes.
```

Expected: AI generates 3 relevant titles

### Sample Content for Excerpt Generation
```
WordPress has evolved significantly over the years, transforming
from a simple blogging platform into a comprehensive content
management system. Today, it powers over 40% of all websites on
the internet, offering unparalleled flexibility and customization options.
```

Expected: AI generates concise summary (<200 chars)

## Timeouts

### Standard Tests
- Default timeout: 60 seconds
- Page loads: 10 seconds
- UI elements: 5 seconds

### AI Generation Tests
- Extended timeout: 60 seconds
- Modal appearance: 15 seconds
- AI processing: 30 seconds
- Reason: API calls can take 5-15 seconds

## API Keys Required

Tests require valid API keys synced from Local:

1. **Anthropic** (`ANTHROPIC_API_KEY` in `.env.e2e.local`)
   - Format: `sk-ant-*`
   - Used for: Claude-based experiments

2. **OpenAI** (`OPENAI_API_KEY` in `.env.e2e.local`)
   - Format: `sk-*`
   - Used for: GPT-based experiments

3. **Google AI** (`GOOGLE_AI_API_KEY` in `.env.e2e.local`)
   - Format: varies
   - Used for: Gemini-based experiments

## Prerequisites

### 1. E2E Environment Setup
```bash
# Ensure .env.e2e.local has API keys
cat .env.e2e.local
# Should show:
# ANTHROPIC_API_KEY=sk-ant-...
# OPENAI_API_KEY=sk-...
# GOOGLE_AI_API_KEY=...
```

### 2. Test Site Setup
```bash
# Run E2E setup to create test site and sync credentials
npm run test:e2e -- tests/e2e/setup.ts
```

### 3. AI Plugin Installation
Tests assume `wp_setup_ai` has run successfully, which:
- Installs AI Experiments plugin
- Installs provider plugins (OpenAI, Anthropic)
- Syncs credentials from Local
- Activates necessary plugins

## Test Scenarios

### Scenario 1: Fresh Install
```
1. Create test site
2. Sync credentials from Local
3. Enable AI Experiments globally
4. Enable title generation
5. Create post and generate title
6. Verify AI-generated title inserted
```

### Scenario 2: Multiple Experiments
```
1. Enable title + excerpt generation
2. Create post with content
3. Generate title via AI
4. Generate excerpt via AI
5. Verify both work correctly
```

### Scenario 3: Error Recovery
```
1. Disable experiments globally
2. Verify UI elements hidden
3. Re-enable experiments
4. Verify UI elements reappear
```

## Debugging

### View Generated Content
```typescript
// In test, log the AI-generated content
const title = await titleOptions.first().inputValue();
console.log('AI Generated Title:', title);
```

### Check API Calls
```typescript
// Monitor network requests
page.on('request', request => {
  if (request.url().includes('anthropic') || request.url().includes('openai')) {
    console.log('API Call:', request.url());
  }
});
```

### Verify Credentials
```bash
# Check WordPress options directly
npm run test:e2e:browser -- --grep "Credential Sync"
```

## Known Issues

### 1. API Rate Limits
AI providers have rate limits. If tests fail with 429 errors:
- Wait 1 minute between test runs
- Use different API keys for parallel tests

### 2. Slow AI Generation
Some AI calls can take 10-20 seconds:
- Extended timeouts already configured (60s)
- Tests will retry on timeout

### 3. WordPress Cache
Block editor may cache UI state:
- Tests refresh page between scenarios
- Hard reload if UI doesn't update

### 4. Provider Availability
If a provider is down:
- Tests will fail with API errors
- Check provider status pages
- Tests continue with other providers

## Performance

### Test Duration
- Credential sync: ~5 seconds
- Setup tests: ~10 seconds
- Title generation: ~20-30 seconds (includes AI call)
- Excerpt generation: ~20-30 seconds (includes AI call)
- Full suite: ~3-5 minutes

### Optimization
- Tests run serially to avoid race conditions
- API calls cached when possible
- Reuses same post for multiple checks

## CI/CD Considerations

### Environment Variables
```yaml
env:
  ANTHROPIC_API_KEY: ${{ secrets.ANTHROPIC_API_KEY }}
  OPENAI_API_KEY: ${{ secrets.OPENAI_API_KEY }}
  GOOGLE_AI_API_KEY: ${{ secrets.GOOGLE_AI_API_KEY }}
```

### Rate Limiting
- Add delays between tests in CI
- Use separate API keys for CI
- Consider mocking AI responses for speed

## Future Enhancements

### Additional Tests
- [ ] Alt text generation for images
- [ ] Image generation experiments
- [ ] Content tone adjustment
- [ ] Language translation
- [ ] Multiple provider comparison
- [ ] Custom prompt testing

### Integration Tests
- [ ] Verify experiments work with ACF
- [ ] Test with custom post types
- [ ] Multi-language support
- [ ] User role permissions

## Resources

- [AI Plugin Repo](../../wp-plugins/ai/)
- [AI Plugin E2E Tests](../../wp-plugins/ai/tests/e2e/)
- [WordPress E2E Utils](https://github.com/WordPress/gutenberg/tree/trunk/packages/e2e-test-utils-playwright)
- [Playwright Docs](https://playwright.dev)
