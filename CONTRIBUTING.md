# Contributing to Nexus AI

Thank you for your interest in contributing! This guide will help you get started.

## Development Setup

### Prerequisites

- **Node.js 22.x** (required for compatibility with Local)
- **Local by Flywheel** installed
- **Xcode Command Line Tools** (macOS only): `xcode-select --install`
- **Git**

### Initial Setup

1. **Clone the repository:**
   ```bash
   git clone https://github.com/wpengine/local-addon-nexus-ai.git
   cd local-addon-nexus-ai
   ```

2. **Install dependencies:**
   ```bash
   npm install
   ```

3. **Rebuild native modules for Electron:**
   ```bash
   npm run rebuild
   ```

   **Important:** Always run `npm run rebuild` after `npm install` before loading in Local. See [docs/NATIVE_MODULES.md](docs/NATIVE_MODULES.md) for details.

4. **Load addon in Local:**
   - Open Local
   - **Add-ons → Installed → Enable "Local Add-on Dev Mode"**
   - **File → Add Add-on Manually**
   - Select the `local-addon-nexus-ai` directory
   - Restart Local

### Development Workflow

```bash
# Run tests
npm test

# Run tests in watch mode
npm test -- --watch

# Run linter
npm run lint

# Fix lint issues
npm run lint -- --fix

# Build TypeScript (automatic in watch mode)
npm run build

# Watch mode (rebuild on file changes)
npm run watch
```

### After Code Changes

1. **Reload addon in Local:**
   - Close and restart Local, OR
   - In Local's addon panel, disable/re-enable Nexus AI

2. **Verify changes:**
   - Test functionality
   - Check console for errors
   - Review logs

## Project Structure

```
local-addon-nexus-ai/
├── src/
│   ├── main/                 # Main process (Electron)
│   │   ├── ipc-handlers.ts  # IPC channel handlers
│   │   ├── ai-gateway/      # AI Gateway server
│   │   ├── content/         # Content indexing
│   │   ├── mcp/             # MCP server & tools
│   │   ├── storage/         # SQLite database
│   │   └── utils/           # Utilities
│   ├── renderer/            # Renderer process (React UI)
│   │   └── components/      # React components
│   └── common/              # Shared code
│       ├── constants.ts     # IPC channels, storage keys
│       ├── types.ts         # TypeScript interfaces
│       └── schemas.ts       # Zod validation schemas
├── tests/
│   ├── unit/               # Unit tests
│   ├── integration/        # Integration tests
│   └── performance/        # Performance benchmarks
├── docs/                   # Documentation
│   ├── user-guide/         # User documentation
│   ├── api/                # API reference
│   ├── architecture/       # Architecture docs
│   └── development/        # Development guides
└── wp-plugins/             # Bundled WordPress plugins
```

## Coding Standards

### TypeScript

- **Strict mode enabled** - all types must be explicit
- **No `any` types** without good reason
- **Use interfaces** for object shapes
- **Prefer `const`** over `let`
- **Use async/await** over raw promises

### React Components

**IMPORTANT:** Local uses an older version of React. You MUST:
- **Use class components** (no functional components)
- **Use `React.createElement()`** (no JSX)
- **No hooks** (useState, useEffect, etc. - not available)

Example:
```typescript
// ✅ GOOD (class-based, no JSX)
export class MyComponent extends React.Component {
  render() {
    return React.createElement('div', { className: 'my-class' },
      React.createElement('h1', {}, 'Hello World')
    );
  }
}

// ❌ BAD (functional component, hooks, JSX)
export function MyComponent() {
  const [state, setState] = useState(0); // ❌ Hooks not available
  return <div><h1>Hello</h1></div>;      // ❌ JSX not supported
}
```

### Naming Conventions

- **Files:** `kebab-case.ts`
- **Classes:** `PascalCase`
- **Functions:** `camelCase`
- **Constants:** `UPPER_SNAKE_CASE`
- **Interfaces:** `PascalCase` (no `I` prefix)
- **Types:** `PascalCase`

### IPC Channels

All IPC channel names must be defined in `src/common/constants.ts`:

```typescript
export const IPC_CHANNELS = {
  MY_NEW_FEATURE: 'nexus-ai:my-new-feature',
  // ...
};
```

### Storage Keys

All storage keys must be defined in `src/common/constants.ts`:

```typescript
export const STORAGE_KEYS = {
  MY_DATA: 'nexus_my_data',
  // ...
};
```

## Adding Features

### New IPC Handler

1. **Define channel in `src/common/constants.ts`:**
   ```typescript
   export const IPC_CHANNELS = {
     MY_FEATURE: 'nexus-ai:my-feature',
   };
   ```

2. **Add schema in `src/common/schemas.ts`:**
   ```typescript
   export const MyFeatureSchema = z.object({
     siteId: SiteIdSchema,
     option: z.string(),
   });
   ```

3. **Add handler in `src/main/ipc-handlers.ts`:**
   ```typescript
   import { validateInput } from '../common/schemas';

   ipcMain.handle(IPC_CHANNELS.MY_FEATURE, async (event, params) => {
     try {
       const validated = validateInput(MyFeatureSchema, params);
       const result = await myFeature(validated);
       return { success: true, result };
     } catch (error) {
       return {
         success: false,
         error: error instanceof Error ? error.message : 'Unknown error'
       };
     }
   });
   ```

4. **Add tests in `tests/unit/ipc-handlers/`:**
   ```typescript
   describe('MY_FEATURE handler', () => {
     it('should validate inputs', () => {
       expect(() => validateInput(MyFeatureSchema, {})).toThrow();
     });

     it('should return success on valid input', async () => {
       const result = await myFeature({ siteId: '...', option: '...' });
       expect(result.success).toBe(true);
     });
   });
   ```

### New React Component

1. **Create in `src/renderer/components/`:**
   ```typescript
   export class MyPanel extends React.Component<MyPanelProps, MyPanelState> {
     state: MyPanelState = {
       loading: false,
     };

     componentDidMount() {
       this.loadData();
     }

     loadData = async () => {
       this.setState({ loading: true });
       const result = await this.props.electron.ipcRenderer.invoke(
         IPC_CHANNELS.MY_FEATURE
       );
       this.setState({ loading: false, data: result.data });
     };

     render() {
       return React.createElement('div', {},
         this.state.loading ? 'Loading...' : this.state.data
       );
     }
   }
   ```

2. **Import and use in parent component**

### New MCP Tool

1. **Add to appropriate module in `src/main/mcp/modules/`**

2. **Follow MCP tool schema:**
   ```typescript
   {
     name: 'my_tool',
     description: 'Clear description of what tool does',
     inputSchema: {
       type: 'object',
       properties: {
         param: { type: 'string', description: 'Parameter description' }
       },
       required: ['param']
     }
   }
   ```

3. **Add handler function**

4. **Add tests**

## Testing

### Unit Tests

```bash
npm test
```

- Test pure functions, utilities, transformations
- Mock external dependencies
- Fast, isolated, deterministic

### Integration Tests

```bash
npm run test:integration
```

- Test end-to-end flows
- Require Local running
- May create test sites
- Slower, more realistic

### Writing Tests

**Tests must not depend on the machine running them.** CI runs on Linux; most
contributors are on macOS. A test that reads the developer's home directory,
inherits the host's `process.platform`, or uses a path that exists on only one
OS will pass locally and fail — or hang — in CI. Real examples from this
repository, all of which passed on macOS for months:

- reading `~/Library/Application Support/...` for a file that exists only
  because Local is installed — mock the module that reads it
- calling a function that branches on `process.platform` without pinning the
  platform, so the assertion silently tested the other branch
- using `/proc/nonexistent` as an "unwritable path" — macOS has no `/proc`, so
  it fails fast, while on Linux `fs.mkdirSync('/proc/...', {recursive: true})`
  **blocks forever** and hangs the whole suite

For an unwritable path, put a *file* where a directory must be: that is a type
error rather than a permission check, so it behaves identically everywhere and
is unaffected by running as root (which CI containers often do).

```typescript
describe('MyFeature', () => {
  describe('validation', () => {
    it('should accept valid input', () => {
      expect(() => validate(validInput)).not.toThrow();
    });

    it('should reject invalid input', () => {
      expect(() => validate(invalidInput)).toThrow('Validation failed');
    });
  });

  describe('execution', () => {
    it('should perform operation successfully', async () => {
      const result = await myFeature(validInput);
      expect(result.success).toBe(true);
      expect(result.data).toBeDefined();
    });

    it('should handle errors gracefully', async () => {
      const result = await myFeature(errorInput);
      expect(result.success).toBe(false);
      expect(result.error).toBeDefined();
    });
  });
});
```

### Test Coverage

Run with coverage:
```bash
npm test -- --coverage
```

Aim for:
- **80%+ overall coverage**
- **100% for critical paths** (validation, security, data integrity)
- **Less critical for UI rendering**

## Commit Guidelines

### Commit Messages

Follow [Conventional Commits](https://www.conventionalcommits.org/):

```
<type>(<scope>): <subject>

<body>

<footer>
```

**Types:**
- `feat`: New feature
- `fix`: Bug fix
- `docs`: Documentation changes
- `refactor`: Code refactoring
- `test`: Adding tests
- `chore`: Build/tooling changes

**Examples:**
```
feat(ai-gateway): add caller tracking for plugin attribution

Adds automatic detection of which WordPress plugin, theme, or core
feature made each AI request. Enables cost analysis and debugging.

- MU plugin template with backtrace detection
- Caller headers injected into gateway requests
- Aggregated "By Caller" analytics panel
```

```
fix(bulk-ops): prevent concurrent execution on same site

Prevents race condition when running multiple bulk operations
that target the same site simultaneously.

Closes #123
```

### Branches

This repository runs **develop / main**, adopted 2026-09-12:

| branch | what it is |
|---|---|
| `develop` | Integration branch, and the repository default. All work lands here. |
| `main` | The released line. Only ever receives a merge from `develop`, and every commit on it corresponds to a published version. |

**Branch from `develop` and open PRs against `develop`.** Because it is the
default branch, GitHub selects it automatically — you would have to change the
base deliberately to target `main`.

Releases are tagged on `main`. See *Release Process* below.

### Branch Naming

- `feat/my-feature` - New feature
- `fix/bug-description` - Bug fix
- `docs/what-changed` - Documentation
- `refactor/what-changed` - Refactoring

### Pull Requests

1. **Create feature branch** from `develop`
2. **Make changes** with clear commits
3. **Add tests** for new functionality
4. **Update documentation** if needed
5. **Run tests:** `npm test`
6. **Run linter:** `npm run lint`
7. **Push branch** to GitHub
8. **Create PR** with description:
   - What changed
   - Why (reference issue if applicable)
   - How to test
   - Screenshots (if UI changes)

## Security

### Reporting Security Issues

**DO NOT** open public issues for security vulnerabilities.

Email security@wpengine.com with:
- Description of vulnerability
- Steps to reproduce
- Potential impact

### Security Best Practices

1. **Never log credentials:**
   - Use `redactCredentials()` on all logs
   - Import from `src/main/mcp/security/credential-redaction.ts`

2. **Validate all inputs:**
   - Use Zod schemas from `src/common/schemas.ts`
   - Never trust renderer process data

3. **Sanitize WP-CLI args:**
   - Use `sanitizeWpCliArg()` from `src/main/utils/validators.ts`
   - Prevent command injection

4. **Audit destructive operations:**
   - Use `AuditLogger` from `src/main/audit/AuditLogger.ts`
   - Log all remote operations

## Release Process

Pushing a `v*` tag is the release. `.github/workflows/package.yml` then builds
four platform tarballs, signs them, uploads to R2, creates the GitHub Release
and publishes to npm — **do not do those steps by hand.** Everything in the
workflow is gated on `startsWith(github.ref, 'refs/tags/v')`, so nothing
publishes until the tag exists.

1. **Update `CHANGELOG.md`** on `develop` — move `[Unreleased]` into a dated
   version heading and leave a fresh empty `[Unreleased]`.
2. **Rehearse the build first:** run `package.yml` via `workflow_dispatch`
   against `develop`. Every publishing step is tag-gated, so this builds all
   four platforms and publishes nothing. It is the only way to find a
   packaging problem *before* a tag exists — and it has earned its keep:
   colon-bearing paths that Windows cannot check out, a missing `.npmrc` in the
   staging copy, and Unix-only commands in the build scripts were each caught
   this way, and each would otherwise have failed a release after the tag was
   already pushed.
3. **Bump the version** with `npm version <x.y.z> --no-git-tag-version`. The
   `--no-git-tag-version` matters: the tag belongs on `main`, not on `develop`
   where the bump is committed.
4. **Push `develop`** and let CI pass.
5. **Fast-forward `main`:** `git checkout main && git merge --ff-only develop`,
   then push. `main` should equal `develop` exactly.
6. **Tag on `main`** and push the tag:
   `git tag -a vX.Y.Z -m "..." && git push origin vX.Y.Z`
7. **Watch the run.** If `publish-npm` fails, the tarballs, signatures, GitHub
   Release and `latest.json` have all already succeeded — in-app updates work
   and only the npm copy is missing. Re-running that one job is enough; no
   re-tag, no rebuild.

## Getting Help

- **Questions:** Open a GitHub Discussion
- **Bugs:** Open a GitHub Issue
- **Chat:** WP Engine internal Slack (`#local-addon-nexus-ai`)

## License

See [LICENSE](LICENSE) file.
