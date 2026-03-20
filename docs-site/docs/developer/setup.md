---
title: Development Setup
description: Complete guide to setting up your Nexus AI development environment
keywords: [development, setup, contributing, build, environment, developer]
---

# Development Setup

Complete guide to setting up your development environment for contributing to Nexus AI.

## Prerequisites

Before you begin, ensure you have:

### Required

- **Node.js 18+** ([download](https://nodejs.org))
  ```bash
  node --version  # Should be 18.x or higher
  ```

- **npm 9+** (comes with Node.js)
  ```bash
  npm --version  # Should be 9.x or higher
  ```

- **Git** ([download](https://git-scm.com))
  ```bash
  git --version
  ```

- **Local by Flywheel** ([download](https://localwp.com))
  - Required for addon development and testing
  - Must have at least one WordPress site created

### Optional but Recommended

- **Ollama** ([download](https://ollama.com)) - For embedding generation
  ```bash
  ollama --version
  ```

- **jq** - For JSON parsing in scripts
  ```bash
  # macOS
  brew install jq

  # Linux
  apt-get install jq
  ```

- **VS Code** ([download](https://code.visualstudio.com)) - Recommended editor
  - Extensions: ESLint, Prettier, TypeScript

## Repository Setup

### 1. Fork and Clone

```bash
# Fork the repository on GitHub
# Then clone your fork

git clone git@github.com:YOUR-USERNAME/local-addon-nexus-ai.git
cd local-addon-nexus-ai

# Add upstream remote
git remote add upstream git@github.com:jpollock/local-addon-nexus-ai.git
```

### 2. Install Dependencies

```bash
# Install all dependencies
npm install

# This installs:
# - TypeScript and build tools
# - Testing frameworks (Jest, Testing Library)
# - Linters and formatters (ESLint, Prettier)
# - All production dependencies
```

**Important:** After `npm install`, you need to rebuild native modules for Local:

```bash
# Rebuild better-sqlite3 for Electron
npm run rebuild
```

### 3. Verify Installation

```bash
# Check that TypeScript compiles
npm run build

# Run tests
npm test

# Check linting
npm run lint
```

If all commands succeed, you're ready to develop!

## Project Structure

```
local-addon-nexus-ai/
├── src/
│   ├── main/                  # Electron main process (addon backend)
│   │   ├── index.ts          # Main entry point
│   │   ├── ipc-handlers.ts   # IPC message handlers
│   │   └── services/         # Core services
│   │       ├── site-scanner.ts
│   │       ├── vector-search.ts
│   │       └── wpe-client.ts
│   ├── renderer/              # React UI (addon frontend)
│   │   ├── app.tsx           # Main app component
│   │   ├── components/       # React components
│   │   └── hooks/            # React hooks
│   ├── cli/                   # CLI and MCP server
│   │   ├── index.ts          # CLI entry point
│   │   ├── mcp-server.ts     # MCP server
│   │   └── tools/            # MCP tool implementations
│   └── shared/                # Shared code (CLI + addon)
│       ├── db/               # Database layer
│       ├── types/            # TypeScript types
│       └── utils/            # Utilities
├── tests/                     # Test files
│   ├── unit/
│   ├── integration/
│   └── e2e/
├── docs-site/                 # Documentation (MkDocs)
├── dist/                      # Build output (gitignored)
├── package.json
├── tsconfig.json
└── README.md
```

## Development Workflow

### Building

```bash
# Build everything
npm run build

# Build CLI only
npm run build:cli

# Build addon only
npm run build:addon

# Watch mode (auto-rebuild on changes)
npm run watch

# Clean build artifacts
npm run clean
```

**Build outputs:**

- **CLI:** `dist/cli/index.js` (executable)
- **Addon:** `dist/addon/` (Electron app)

### Testing

```bash
# Run all tests
npm test

# Run specific test file
npm test -- site-scanner.test.ts

# Run tests in watch mode
npm test -- --watch

# Run with coverage
npm test -- --coverage

# Run only unit tests
npm run test:unit

# Run only integration tests
npm run test:integration
```

### Linting and Formatting

```bash
# Check linting
npm run lint

# Auto-fix linting issues
npm run lint:fix

# Format code
npm run format

# Check formatting (CI)
npm run format:check
```

### Local Development

#### Running the CLI

```bash
# Build first
npm run build:cli

# Run CLI locally
node dist/cli/index.js --version
node dist/cli/index.js list
node dist/cli/index.js scan

# Or link globally for testing
npm link
nexus --version
```

#### Running the Addon

```bash
# Build addon
npm run build:addon

# Copy to Local addons directory
npm run install:addon

# Restart Local
# The addon should appear in Local's addon list
```

**Addon installation locations:**

- **macOS:** `~/Library/Application Support/Local/addons/`
- **Windows:** `%APPDATA%\Local\addons\`
- **Linux:** `~/.config/Local/addons/`

#### Hot Reload (Addon)

For faster iteration during addon development:

```bash
# Terminal 1: Watch mode
npm run watch:addon

# Terminal 2: Auto-copy to Local
npm run dev:addon

# Make changes to addon code
# → Auto-builds
# → Auto-copies to Local
# → Restart Local to see changes
```

## Testing Your Changes

### 1. Unit Tests

Test individual functions and modules:

```typescript
// tests/unit/site-scanner.test.ts
import { scanSite } from '../src/main/services/site-scanner';

describe('scanSite', () => {
  it('should scan a WordPress site', async () => {
    const result = await scanSite({
      path: '/path/to/site',
      name: 'test-site'
    });

    expect(result.documents).toBeGreaterThan(0);
    expect(result.status).toBe('completed');
  });
});
```

Run:
```bash
npm test -- site-scanner.test.ts
```

### 2. Integration Tests

Test multiple components working together:

```typescript
// tests/integration/search.test.ts
import { indexSite, searchContent } from '../src/shared/db';

describe('Search Integration', () => {
  it('should index and search content', async () => {
    // Index test data
    await indexSite('test-site', testData);

    // Search
    const results = await searchContent('test query');

    expect(results).toHaveLength(greaterThan(0));
  });
});
```

### 3. E2E Tests

Test the full application flow:

```typescript
// tests/e2e/cli.test.ts
import { execSync } from 'child_process';

describe('CLI E2E', () => {
  it('should list sites', () => {
    const output = execSync('nexus list').toString();
    expect(output).toContain('Local Sites');
  });
});
```

### 4. Manual Testing

**CLI:**
```bash
# Build
npm run build:cli

# Test commands
nexus list
nexus scan
nexus search "test"
```

**Addon:**
```bash
# Build and install
npm run build:addon
npm run install:addon

# Restart Local
# Open Local → Nexus AI sidebar
# Test UI interactions
```

## Working with Native Modules

Nexus AI uses `better-sqlite3`, a native Node.js module that requires compilation.

### The Challenge

- **Tests** run in system Node.js (MODULE_VERSION 127)
- **Local** runs in Electron (MODULE_VERSION 136)
- **Different binaries required** for each environment

### The Workflow

```bash
# For tests (system Node)
npm install

# For Local (Electron)
npm run rebuild
```

**Commands:**

```bash
# Rebuild for Electron (Local)
npm run rebuild

# This runs:
# electron-rebuild -f -w better-sqlite3
```

**When to rebuild:**

- ✅ After `npm install`
- ✅ After switching branches
- ✅ Before loading addon in Local
- ✅ After Node.js version changes

**Troubleshooting:**

If you see `NODE_MODULE_VERSION` errors:

```bash
# Clean and rebuild
rm -rf node_modules
npm install
npm run rebuild
```

## Environment Variables

Create a `.env` file for development:

```bash
# .env (not committed to git)

# Database path
NEXUS_DB_PATH=~/.nexus/nexus-dev.db

# Enable debug logging
NEXUS_DEBUG=true

# Disable telemetry in development
NEXUS_TELEMETRY=false

# Ollama endpoint
OLLAMA_HOST=http://localhost:11434

# WP Engine API (for testing)
WPE_API_BASE_URL=https://api.wpengineapi.com/v1
```

**Load in code:**

```typescript
import dotenv from 'dotenv';
dotenv.config();

const dbPath = process.env.NEXUS_DB_PATH || '~/.nexus/nexus.db';
```

## Debugging

### CLI Debugging

**VS Code launch configuration:**

```json
// .vscode/launch.json
{
  "version": "0.2.0",
  "configurations": [
    {
      "type": "node",
      "request": "launch",
      "name": "Debug CLI",
      "program": "${workspaceFolder}/dist/cli/index.js",
      "args": ["list"],
      "env": {
        "NEXUS_DEBUG": "true"
      },
      "sourceMaps": true,
      "outFiles": ["${workspaceFolder}/dist/**/*.js"]
    }
  ]
}
```

**Command line debugging:**

```bash
# Node.js built-in debugger
node --inspect-brk dist/cli/index.js list

# Then open chrome://inspect in Chrome
```

### Addon Debugging

**Enable DevTools in Local:**

1. Open Local
2. Go to Preferences → Advanced
3. Enable "Show DevTools"
4. Restart Local
5. Right-click addon → Inspect Element

**React DevTools:**

Install React DevTools extension in Electron:

```bash
# In Local's DevTools console
require('electron').remote.BrowserWindow.addDevToolsExtension(
  '/path/to/react-devtools'
)
```

### Logging

```typescript
// Use debug logger
import debug from 'debug';

const log = debug('nexus:scanner');

log('Scanning site %s', siteName);
log('Found %d documents', count);

// Enable all logs
export DEBUG=nexus:*

// Enable specific module
export DEBUG=nexus:scanner
```

## Common Development Tasks

### Adding a New MCP Tool

1. **Create tool file:**
   ```typescript
   // src/cli/tools/my-new-tool.ts
   export const myNewTool = {
     name: 'my_new_tool',
     description: 'Does something useful',
     inputSchema: {
       type: 'object',
       properties: {
         site_id: { type: 'string' }
       },
       required: ['site_id']
     },
     handler: async (params: { site_id: string }) => {
       // Implementation
       return {
         content: [{ type: 'text', text: 'Success!' }]
       };
     }
   };
   ```

2. **Register tool:**
   ```typescript
   // src/cli/tool-registry.ts
   import { myNewTool } from './tools/my-new-tool';

   registry.register(myNewTool);
   ```

3. **Add tests:**
   ```typescript
   // tests/unit/my-new-tool.test.ts
   describe('myNewTool', () => {
     it('should work', async () => {
       const result = await myNewTool.handler({ site_id: 'test' });
       expect(result.content[0].text).toBe('Success!');
     });
   });
   ```

4. **Update docs:**
   - Add to `docs/mcp-tools/` category
   - Update `docs/mcp-tools/index.md`

### Adding a UI Component

1. **Create component:**
   ```typescript
   // src/renderer/components/MyComponent.tsx
   import React from 'react';

   export class MyComponent extends React.Component {
     render() {
       return React.createElement('div', null, 'Hello!');
     }
   }
   ```

2. **Add to parent:**
   ```typescript
   // src/renderer/app.tsx
   import { MyComponent } from './components/MyComponent';

   // In render()
   React.createElement(MyComponent, null)
   ```

3. **Add tests:**
   ```typescript
   // tests/unit/MyComponent.test.tsx
   import { render } from '@testing-library/react';
   import { MyComponent } from '../src/renderer/components/MyComponent';

   test('renders', () => {
     const { getByText } = render(<MyComponent />);
     expect(getByText('Hello!')).toBeInTheDocument();
   });
   ```

### Modifying the Database Schema

1. **Create migration:**
   ```typescript
   // src/shared/db/migrations/003-add-new-table.ts
   export function up(db: Database) {
     db.exec(`
       CREATE TABLE new_table (
         id INTEGER PRIMARY KEY,
         name TEXT NOT NULL
       )
     `);
   }

   export function down(db: Database) {
     db.exec('DROP TABLE new_table');
   }
   ```

2. **Update schema version:**
   ```typescript
   // src/shared/db/index.ts
   const SCHEMA_VERSION = 3; // Increment
   ```

3. **Test migration:**
   ```bash
   # Delete test database
   rm ~/.nexus/nexus-dev.db

   # Run migrations
   npm run build
   nexus list  # Triggers migration
   ```

## Troubleshooting

### "Module not found" errors

```bash
# Clean install
rm -rf node_modules
rm package-lock.json
npm install
npm run rebuild
```

### "Cannot find module 'better-sqlite3'"

```bash
# Rebuild native module
npm run rebuild
```

### "Port already in use" (MCP server)

```bash
# Find and kill process
lsof -ti:3000 | xargs kill -9
```

### Tests fail with database errors

```bash
# Use separate test database
export NEXUS_DB_PATH=~/.nexus/nexus-test.db
npm test
```

### Addon doesn't appear in Local

```bash
# Verify installation
ls -la ~/Library/Application\ Support/Local/addons/

# Check Local logs
tail -f ~/Library/Logs/Local/main.log

# Reinstall addon
npm run install:addon
# Restart Local completely (Quit, not just close)
```

### TypeScript errors

```bash
# Regenerate types
npm run build

# Check tsconfig
npx tsc --noEmit
```

## Best Practices

### Code Style

- ✅ Use TypeScript for type safety
- ✅ Follow existing code patterns
- ✅ Write tests for new features
- ✅ Use ESLint and Prettier
- ✅ Document complex logic
- ❌ Don't commit `console.log()`
- ❌ Don't commit commented-out code
- ❌ Don't ignore TypeScript errors

### Commits

```bash
# Good commit messages
git commit -m "feat: add semantic search to CLI"
git commit -m "fix: handle empty scan results"
git commit -m "docs: update API reference"

# Use conventional commits
# feat:, fix:, docs:, test:, refactor:, chore:
```

### Pull Requests

1. **Create feature branch:**
   ```bash
   git checkout -b feature/my-feature
   ```

2. **Make changes and commit:**
   ```bash
   git add .
   git commit -m "feat: add my feature"
   ```

3. **Keep up to date:**
   ```bash
   git fetch upstream
   git rebase upstream/main
   ```

4. **Push and create PR:**
   ```bash
   git push origin feature/my-feature
   # Create PR on GitHub
   ```

5. **PR checklist:**
   - [ ] Tests pass (`npm test`)
   - [ ] Linting passes (`npm run lint`)
   - [ ] TypeScript compiles (`npm run build`)
   - [ ] Documentation updated
   - [ ] Commits are clean

## Next Steps

Now that your environment is set up:

- **[Project Structure](project-structure.md)** - Understand the codebase
- **[Building CLI](building-cli.md)** - CLI development guide
- **[Building Addon](building-addon.md)** - Addon development guide
- **[Testing Guide](testing-cli.md)** - Testing best practices
- **[Contributing](contributing.md)** - Contribution guidelines

## Getting Help

- **GitHub Issues:** [Report bugs](https://github.com/jpollock/local-addon-nexus-ai/issues)
- **Discussions:** [Ask questions](https://github.com/jpollock/local-addon-nexus-ai/discussions)
- **Documentation:** [Full docs](../index.md)

---

**Ready to contribute?** Check out the [good first issues](https://github.com/jpollock/local-addon-nexus-ai/issues?q=is%3Aissue+is%3Aopen+label%3A%22good+first+issue%22) to get started!
