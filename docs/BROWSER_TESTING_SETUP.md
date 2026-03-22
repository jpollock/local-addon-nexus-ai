# Browser Testing Setup Guide

## Quick Start

```bash
# 1. Install dependencies
npm install --save-dev @playwright/test @wordpress/e2e-test-utils-playwright

# 2. Install browsers
npx playwright install chromium

# 3. Run browser tests
npm run test:e2e:browser
```

## What Gets Tested

Browser tests verify the **complete user journey** through WordPress:

### Event Flow (Test 29)
```
User clicks "Publish" in WP Admin
    ↓
Plugin sends HTTP event to Local
    ↓
Local processes event async
    ↓
Content indexed + embedded
    ↓
Searchable via semantic search
```

### AI Experiments (Test 30)
```
Local syncs credentials → WordPress
    ↓
User enables AI Experiments
    ↓
User creates post with content
    ↓
User clicks "Generate Title"
    ↓
AI API call (Anthropic/OpenAI/Google)
    ↓
AI-generated titles appear
    ↓
User selects and inserts title
```

## Test Scenarios

### Event Flow Tests (29-wordpress-browser.e2e.test.ts)

#### 1. Plugin Configuration
- ✅ Verify plugin installed and active
- ✅ Check webhook URL configured
- ✅ Validate site ID in MU plugin

#### 2. Content Creation
- ✅ Create post in block editor
- ✅ Verify event sent to Local
- ✅ Confirm content in graph database
- ✅ Test semantic search works

#### 3. Content Updates
- ✅ Edit existing post
- ✅ Verify update event sent
- ✅ Confirm content re-indexed

#### 4. Frontend Health
- ✅ Site loads without errors
- ✅ REST API accessible

#### 5. Error Handling
- ✅ Network interruption graceful degradation

### AI Experiments Tests (30-ai-experiments-browser.e2e.test.ts)

#### 6. Credential Sync
- ✅ Verify API keys synced from Local
- ✅ Check Anthropic, OpenAI, Google credentials
- ✅ Validate via browser UI and wp-cli

#### 7. Experiments Setup
- ✅ AI plugin active
- ✅ Enable experiments globally
- ✅ Enable individual experiments

#### 8. Title Generation
- ✅ UI appears in block editor
- ✅ Generate button works
- ✅ 3 AI-generated options appear
- ✅ Selected title inserts correctly

#### 9. Excerpt Generation
- ✅ Generate button in excerpt panel
- ✅ AI generates concise summary
- ✅ Excerpt inserted in post meta

#### 10. Error Handling
- ✅ Graceful API error handling
- ✅ UI hidden when experiments disabled

## File Structure

```
tests/e2e/
├── 29-wordpress-browser.e2e.test.ts   ← Browser test suite
├── playwright.config.ts                ← Playwright config
├── BROWSER_TESTING.md                  ← Detailed docs
└── helpers/
    └── environment.ts                  ← Shared test helpers
```

## Dependencies

### Required
- `@playwright/test` - Browser automation framework
- `@wordpress/e2e-test-utils-playwright` - WordPress-specific helpers

### Fixtures Provided

```typescript
test('example', async ({ admin, editor, page }) => {
  // admin  - Navigate WP admin pages
  // editor - Interact with block editor
  // page   - Playwright Page object
});
```

## Running Tests

### All Tests
```bash
npm run test:e2e:browser
```

### Interactive UI Mode
```bash
npm run test:e2e:browser:ui
```

### Debug Mode (Step Through)
```bash
npm run test:e2e:browser:debug
```

### Specific Test
```bash
npx playwright test --config tests/e2e/playwright.config.ts --grep "plugin active"
```

### Headed Mode (Watch Browser)
```bash
npx playwright test --config tests/e2e/playwright.config.ts --headed
```

## Integration with Jest E2E Suite

Browser tests **complement** the existing Jest E2E suite:

| Test Type | Framework | Use Case |
|-----------|-----------|----------|
| MCP Tools | Jest | API-level testing (create site, run wp-cli, etc.) |
| Event Flow | Jest | Verify event processing without browser |
| **Browser** | **Playwright** | **Full user journey through WordPress UI** |

## Example Test

```typescript
test('should index content after publish', async ({ admin, editor, page }) => {
  // 1. Create post in WordPress
  await admin.createNewPost({ postType: 'post' });
  await editor.canvas.locator('.editor-post-title__input').fill('Test Post');
  await editor.publishPost();

  // 2. Verify via MCP tool
  const result = await client.callTool('search_site_content', {
    site: siteName,
    query: 'Test Post',
  });

  // 3. Assert content found
  expect(result.content[0].text).toContain('Found');
});
```

## Debugging

### View HTML Report
```bash
npx playwright show-report playwright-report
```

### View Trace
```bash
npx playwright show-trace trace.zip
```

### Screenshots
Failed tests automatically capture screenshots to `test-results/`

## CI/CD

Add to GitHub Actions:

```yaml
- name: Install Playwright
  run: npx playwright install --with-deps chromium

- name: Run Browser Tests
  run: npm run test:e2e:browser
```

## Troubleshooting

### "Browser not installed"
```bash
npx playwright install chromium
```

### "Site not found"
Ensure Local is running with test site created:
```bash
npm run test:e2e -- tests/e2e/setup.ts
```

### Tests timeout
Increase in `playwright.config.ts`:
```typescript
timeout: 120000, // 2 minutes
```

### Login issues
WordPress admin login uses default credentials:
- Username: `admin`
- Password: `admin`

These are set automatically by `local_create_site` tool.

## Performance

- Serial execution (1 worker) to avoid race conditions
- Average test: 5-10 seconds
- Full suite: ~2-3 minutes
- Slower than Jest but tests real user interactions

## Next Steps

1. **Install dependencies**: `npm install --save-dev @playwright/test @wordpress/e2e-test-utils-playwright`
2. **Install browsers**: `npx playwright install chromium`
3. **Run POC test**: `npm run test:e2e:browser`
4. **Review results**: `npx playwright show-report`
5. **Expand coverage**: Add more scenarios to `29-wordpress-browser.e2e.test.ts`

## Resources

- [Playwright Docs](https://playwright.dev)
- [WordPress E2E Utils](https://github.com/WordPress/gutenberg/tree/trunk/packages/e2e-test-utils-playwright)
- [Local Addon Testing](../tests/e2e/README.md)
