# WordPress Browser Testing

## Overview

Browser-based E2E tests that verify the complete user journey:
1. User creates content in WordPress admin
2. Nexus AI Connector plugin sends events to Local
3. Local processes events and indexes content
4. Content becomes searchable via MCP tools

## Setup

### 1. Install Dependencies

```bash
npm install --save-dev \
  @playwright/test@latest \
  @wordpress/e2e-test-utils-playwright@latest
```

### 2. Install Playwright Browsers

```bash
npx playwright install chromium
```

### 3. Ensure Local is Running

These tests require Local to be running with the Nexus AI addon loaded:

```bash
# From flywheel-local directory
npm start
```

## Running Tests

### Run All Browser Tests

```bash
npm run test:e2e:browser
```

### Run with UI Mode (Interactive)

```bash
npx playwright test --config tests/e2e/playwright.config.ts --ui
```

### Run Specific Test

```bash
npx playwright test --config tests/e2e/playwright.config.ts --grep "should send event when creating post"
```

### Debug Mode

```bash
npx playwright test --config tests/e2e/playwright.config.ts --debug
```

## Test Structure

### Test File: `29-wordpress-browser.e2e.test.ts`

```typescript
test.describe('Plugin Installation', () => {
  test('should have plugin active', async ({ admin, page }) => {
    // Uses WordPress helpers: admin, editor, page
  });
});
```

### Available Fixtures

From `@wordpress/e2e-test-utils-playwright`:
- `admin` - Admin navigation helpers
- `editor` - Block editor helpers
- `page` - Playwright Page object
- `request` - Playwright Request object
- `requestUtils` - WordPress REST API helpers

### MCP Tool Integration

Tests combine browser automation with MCP tools:

```typescript
// Create post in browser
await editor.publishPost();

// Verify via MCP tool
const result = await client.callTool('get_graph_content', {
  site: siteName,
  post_id: postId,
});
```

## Test Scenarios

### ✅ Implemented

1. **Plugin Installation**
   - Verify plugin installed and active
   - Check configuration constants

2. **Content Creation → Event Flow**
   - Create post in block editor
   - Verify event sent to Local
   - Confirm content indexed
   - Test search functionality

3. **Content Updates**
   - Update existing post
   - Verify update event sent
   - Confirm content re-indexed

4. **Frontend Verification**
   - Site loads without errors
   - REST API accessible

5. **Error Handling**
   - Network interruption handling

### 🚧 Potential Future Tests

1. **ACF Integration**
   - Create post with ACF fields
   - Verify ACF data in events

2. **Media Upload**
   - Upload image via media library
   - Verify media event sent

3. **Multi-User**
   - Different user roles creating content
   - Author ID captured correctly

4. **Custom Post Types**
   - Create CPT entries
   - Verify CPT events

5. **Classic Editor**
   - Test with classic editor enabled
   - Compare event payloads

## Debugging

### View Test Reports

```bash
npx playwright show-report playwright-report
```

### Slow Motion Mode

```bash
npx playwright test --config tests/e2e/playwright.config.ts --headed --slow-mo=1000
```

### Trace Viewer

```bash
npx playwright show-trace trace.zip
```

## Known Issues

### WordPress Hooks in Browser Actions

WordPress hooks fire automatically for browser actions (unlike WP-CLI). However, we still manually trigger events via `wp eval` in tests to ensure deterministic timing.

In production, the `save_post` hook fires automatically when users publish/update posts.

### Timing Considerations

- Event processing is async (~1-2 seconds)
- Embedding generation takes ~1-3 seconds
- Tests poll for completion rather than using fixed delays

## Architecture

```
WordPress Admin (Browser)
    ↓ User creates post
Nexus AI Connector Plugin
    ↓ Fires save_post hook
    ↓ Sends HTTP POST to Local
Local HTTP Interface
    ↓ Queues event
Event Processor
    ↓ Extracts content
    ↓ Generates embeddings
Vector Store (LanceDB)
    ↓ Stores embeddings
Search (MCP Tool)
    ↓ Semantic search
Test Verification ✓
```

## CI/CD Integration

These tests can run in CI with headless browsers:

```yaml
# .github/workflows/e2e-browser.yml
- name: Run Browser Tests
  run: |
    npm run test:e2e:browser -- --reporter=github
```

## Performance

- Tests run serially (1 worker) to avoid WordPress race conditions
- Average test duration: 5-10 seconds
- Full suite: ~2-3 minutes

## Troubleshooting

### Test Fails with "Site not found"

Ensure test site is created and running:
```bash
npm run test:e2e -- tests/e2e/setup.ts
```

### Browser Doesn't Launch

Install browsers:
```bash
npx playwright install
```

### Tests Timeout

Increase timeout in `playwright.config.ts`:
```typescript
timeout: 120000, // 2 minutes
```

### WordPress Login Issues

Clear browser storage state:
```bash
rm -rf tests/e2e/.auth
```
