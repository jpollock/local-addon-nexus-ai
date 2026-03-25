# CLI E2E Tests

**Separate test suite for the Nexus CLI that runs against production Local.**

## Why Separate?

The main E2E test suite (`tests/e2e/`) starts Local from **source** (development build from `flywheel-local`). This is great for testing the addon's MCP server, but it doesn't write `graphql-connection-info.json`, which the CLI needs to connect.

The CLI tests need to run against **production Local** (`/Applications/Local.app`) because:

1. **GraphQL Connection**: CLI uses Local's GraphQL API, which requires `graphql-connection-info.json`
2. **Production Environment**: Tests real-world CLI usage against installed Local
3. **No Conflicts**: Main E2E tests can fully control their Local instance without interference

## Requirements

Before running CLI E2E tests:

1. **Production Local must be running** (start `/Applications/Local.app`)
2. **Nexus AI addon must be installed and enabled** in production Local
3. **At least one WordPress site** should exist (for WP-CLI tests)

## Running Tests

```bash
# Run all CLI E2E tests
npm run test:cli-e2e

# Run with verbose output
npm run test:cli-e2e -- --verbose

# Run a specific test file
npm run test:cli-e2e -- 01-cli-basic
```

## What Gets Tested

- **Basic Commands**: `sites list`, `--help`, `--version`
- **WordPress Commands**: `wp plugin list`, `wp core version`
- **Error Handling**: Invalid commands, nonexistent sites
- **Output Formatting**: Plain text and JSON output
- **Exit Codes**: Proper success/failure codes

## Test Structure

```
tests/e2e-cli/
├── jest.cli-e2e.config.js  # Jest configuration
├── setup.ts                 # Global setup (checks Local is running)
├── teardown.ts              # Global teardown
├── jest.setup.ts            # Test timeout configuration
├── 01-cli-basic.cli-e2e.test.ts  # Basic CLI tests
└── README.md               # This file
```

## How It Works

1. **Setup** checks that production Local is running and GraphQL is accessible
2. **Tests** execute the `nexus` CLI binary and validate output
3. **Teardown** cleans up (Local is left running)

## Comparison with Main E2E

| Feature | Main E2E (`tests/e2e/`) | CLI E2E (`tests/e2e-cli/`) |
|---------|------------------------|---------------------------|
| **Local Build** | Development (source) | Production (app) |
| **Connection** | MCP HTTP (port 10800) | GraphQL (dynamic port) |
| **What's Tested** | MCP tools, addon functionality | CLI commands |
| **Setup** | Starts Local from source | Requires running production Local |
| **Duration** | ~10 minutes (full suite) | ~1 minute |

## Troubleshooting

### "Production Local is not running"

**Problem**: Setup can't find `graphql-connection-info.json`

**Solution**: Start Local from `/Applications/Local.app` (not from terminal source)

### "Cannot connect to Local GraphQL"

**Problem**: Connection info exists but GraphQL isn't responding

**Solutions**:
1. Restart Local
2. Check Local is fully loaded (not stuck on splash screen)
3. Verify addon is enabled in Local settings

### "No running sites available"

**Problem**: WP-CLI tests are skipped

**Solution**: Start at least one WordPress site in Local before running tests

## CI/CD Integration

For CI/CD pipelines:

1. **Headless Local**: Use `Local --headless` to run Local without GUI
2. **Pre-setup**: Install addon and create test sites in CI setup phase
3. **Separate Job**: Run CLI E2E tests in a separate CI job from main E2E tests

Example GitHub Actions:

```yaml
cli-e2e-tests:
  runs-on: macos-latest
  steps:
    - uses: actions/checkout@v3
    - name: Install Local
      run: brew install --cask local
    - name: Start Local
      run: /Applications/Local.app/Contents/MacOS/Local --headless &
    - name: Wait for Local
      run: sleep 30
    - name: Run CLI E2E Tests
      run: npm run test:cli-e2e
```
