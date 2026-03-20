# CLI Bootstrap System

**Date:** 2026-03-20
**Status:** ✅ Implemented

## Overview

The Nexus CLI now includes a comprehensive bootstrap system that automatically:
- Detects if Local is installed
- Checks if Local is running (and starts it if needed)
- Installs the Nexus AI addon if missing
- Activates the addon in Local
- Waits for GraphQL server to be ready
- Establishes connection to Local

This provides a seamless user experience where the CLI "just works" without manual setup.

---

## Architecture

### Bootstrap Flow

```
CLI Start
    ↓
Check for Updates (non-blocking)
    ↓
Bootstrap Phase
    ↓
┌─────────────────────────────────┐
│ 1. Check Local Installed        │
│    ❌ Not found → Error + DL link│
│    ✅ Found → Continue           │
└─────────────────────────────────┘
    ↓
┌─────────────────────────────────┐
│ 2. Ensure Addon Installed       │
│    ❌ Not installed → Install    │
│    ✅ Installed → Continue       │
└─────────────────────────────────┘
    ↓
┌─────────────────────────────────┐
│ 3. Check Addon Activated        │
│    ❌ Not activated → Activate   │
│    ✅ Activated → Continue       │
└─────────────────────────────────┘
    ↓
┌─────────────────────────────────┐
│ 4. Check Local Running          │
│    ❌ Not running → Start Local  │
│    ✅ Running → Continue         │
└─────────────────────────────────┘
    ↓
┌─────────────────────────────────┐
│ 5. Wait for GraphQL Ready       │
│    Poll /graphql endpoint       │
│    Timeout: 30 seconds           │
│    Health check: { __typename }  │
└─────────────────────────────────┘
    ↓
┌─────────────────────────────────┐
│ 6. Read Connection Info         │
│    graphql-connection-info.json │
│    Extract: url, port, authToken│
└─────────────────────────────────┘
    ↓
Ready to Execute Commands
```

---

## Module Structure

```
src/cli/bootstrap/
├── index.ts           # Main bootstrap() orchestration
├── process.ts         # Process detection and lifecycle
├── paths.ts           # Platform-specific paths
├── addon.ts           # Addon installation and activation
└── graphql.ts         # GraphQL readiness polling
```

### `bootstrap/index.ts`

Main orchestrator. Exports:

```typescript
export async function bootstrap(options?: {
  verbose?: boolean;
  skipAddonInstall?: boolean;
  onStatus?: (status: string) => void;
}): Promise<BootstrapResult>

interface BootstrapResult {
  success: boolean;
  connectionInfo?: ConnectionInfo;
  error?: string;
  actions: string[];
}
```

### `bootstrap/process.ts`

Process detection and lifecycle:

```typescript
export async function isLocalRunning(): Promise<boolean>
export async function startLocal(): Promise<void>
export async function stopLocal(): Promise<void>
export async function restartLocal(): Promise<void>
export function isLocalInstalled(): boolean
```

**Cross-platform process detection:**
- **macOS**: `pgrep -f "Local.app"`
- **Windows**: `tasklist /FI "IMAGENAME eq Local.exe"`
- **Linux**: `pgrep -fi "local"`

**Cross-platform launching:**
- **macOS**: `open -a "Local"`
- **Windows**: `start /MIN "" "C:\Program Files\Local\Local.exe"`
- **Linux**: `/opt/Local/local &` (with display check)

### `bootstrap/paths.ts`

Platform-specific paths:

```typescript
export function getLocalPaths(): LocalPaths
export async function ensureLocalExecutable(): Promise<string | null>

interface LocalPaths {
  dataDir: string;                    // Local app data directory
  addonsDir: string;                  // Addons installation directory
  enabledAddonsFile: string;          // enabled-addons.json path
  graphqlConnectionInfoFile: string;  // GraphQL connection info path
  appExecutable: string;              // Local executable path
  appName: string;                    // Process name for detection
}
```

**Platform paths:**

| Platform | Data Dir | App Executable |
|----------|----------|----------------|
| macOS | `~/Library/Application Support/Local` | `/Applications/Local.app` |
| Windows | `%APPDATA%\Local` | `C:\Program Files\Local\Local.exe` |
| Linux | `~/.config/Local` | `/opt/Local/local` (auto-detected) |

**Linux executable detection:**
- Checks custom config: `~/.nexus/config.json`
- Common paths: `/usr/bin/local`, `/opt/Local/local`, etc.
- Interactive prompt if not found

### `bootstrap/addon.ts`

Addon management:

```typescript
export function isAddonInstalled(): boolean
export function isAddonActivated(): boolean
export function activateAddon(): boolean  // Returns true if restart needed
export async function installAddon(options): Promise<InstallResult>
export async function ensureAddon(options): Promise<EnsureResult>
```

**Addon installation logic:**
1. Check if addon directory exists: `addons/@local-nexus-ai`
2. If missing, try bundled addon (production) or symlink (dev mode)
3. Bundled addon: `addon-dist/` in npm package
4. Dev mode: Symlink to `src/` in monorepo

**Addon activation:**
1. Read `enabled-addons.json`
2. Check if `@local/nexus-ai` is `true`
3. If not, modify JSON and write back
4. **Important**: Can't modify while Local is running (Local controls the file)
5. If Local running, must stop → activate → restart

### `bootstrap/graphql.ts`

GraphQL readiness polling:

```typescript
export function readConnectionInfo(): ConnectionInfo | null
export async function waitForGraphQL(
  timeoutMs?: number,
  pollIntervalMs?: number
): Promise<boolean>
```

**Polling logic:**
1. Check if `graphql-connection-info.json` exists
2. Read connection info (url, port, authToken)
3. Send health check query: `{ __typename }`
4. Per-request timeout: 2 seconds (AbortController)
5. Retry every 500ms
6. Global timeout: 30 seconds
7. Return true if GraphQL responds, false if timeout

---

## Version Checking & Updates

### `utils/version.ts`

Version management:

```typescript
export async function fetchLatestVersion(): Promise<string | null>
export function isNewerVersion(latest: string, current: string): boolean
export function getCurrentVersion(): string
export async function checkForUpdates(): Promise<void>
```

**Update notification logic:**
1. On every CLI run, check for updates
2. Cache check result in `~/.nexus-update-check`
3. Cache TTL: 24 hours
4. Non-blocking: Fire and forget
5. If newer version available, show notification:
   ```
   Update available: 0.1.0 → 0.2.0
   Run: nexus update
   ```

### `commands/update.ts`

Self-update command:

```bash
nexus update              # Update to latest
nexus update --check      # Check without updating
```

**Update flow:**
1. Fetch latest version from npm registry
2. Compare with current version
3. Run `npm update -g @local/nexus-cli`
4. Show new version after update

---

## User Experience

### First Run

```bash
$ nexus sites list

🔧 Connecting to Local...
🔧 Addon not installed. Installing...
🔧 Activating addon...
🔧 Starting Local...
🔧 Waiting for GraphQL...
🔧 GraphQL server ready.

Local Sites:
  (no sites yet)
```

### Subsequent Runs (Local Already Running)

```bash
$ nexus sites list

Local Sites:
  mysite (running)
```

### Local Not Running

```bash
$ nexus sites list

🔧 Connecting to Local...
🔧 Starting Local...
🔧 Waiting for GraphQL...
🔧 GraphQL server ready.

Local Sites:
  mysite (stopped)
```

### Update Available

```bash
$ nexus sites list

Update available: 0.1.0 → 0.2.0
Run: nexus update

Local Sites:
  mysite (running)
```

---

## Error Handling

### Local Not Installed

```
❌ Local is not installed. Download from https://localwp.com
```

### GraphQL Timeout

```
❌ Timed out waiting for Local. Is Local running?

Actions taken:
  - Addon not installed. Installing...
  - Activating addon...
  - Starting Local...
  - Waiting for GraphQL...
```

### Addon Install Failed

```
❌ Failed to install addon

Addon not found. Please reinstall the CLI package:
  npm install -g @local/nexus-cli
```

### Linux SSH Session (No Display)

```
The CLI addon is installed but needs to be activated.

Please activate from Local desktop app:
  1. Open Local
  2. Go to Addons
  3. Enable "@local/nexus-ai"

Or restart Local from the desktop to auto-activate.
```

---

## Configuration

### Custom Local Path (Linux)

If Local is installed in a non-standard location:

1. CLI will prompt on first run:
   ```
   ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
   Local application not found

   If Local is installed, please enter the path.
   If not installed, download it from: https://localwp.com
   ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

   Path to Local executable (or press Enter to skip):
   ```

2. Path saved to `~/.nexus/config.json`:
   ```json
   {
     "localExecutablePath": "/custom/path/to/local"
   }
   ```

### Update Check Cache

Location: `~/.nexus-update-check`

```json
{
  "lastCheck": 1710950400000,
  "latestVersion": "0.2.0"
}
```

---

## Bootstrap Bypass

Some commands don't need Local running:

```typescript
const skipBootstrap = process.argv.includes('--version') ||
                       process.argv.includes('-V') ||
                       process.argv.includes('update');
```

Commands that skip bootstrap:
- `nexus --version` / `nexus -V`
- `nexus update`
- `nexus update --check`

---

## Development Mode

**Detection:**
- Production: Addon found at `addon-dist/` (bundled in npm package)
- Dev mode: Addon found at `src/main/` (monorepo structure)

**Dev mode behavior:**
1. CLI detects it's running from source (not installed globally)
2. Creates symlink instead of copying: `addons/@local-nexus-ai → src/`
3. Changes to source immediately reflected (no reinstall needed)
4. Addon activation still required

**Enabling dev mode:**
```bash
cd /Users/jeremy.pollock/development/wpengine/local-addon-nexus-ai
npm link
nexus sites list  # Auto-detects dev mode, creates symlink
```

---

## Testing

### Unit Tests

Location: `tests/unit/cli/bootstrap.test.ts`

Tests:
- ✅ Platform-specific paths (macOS, Windows, Linux)
- ✅ Local installation detection
- ✅ Connection info reading
- ✅ Addon installation detection
- ✅ Addon activation detection
- ✅ Error handling (invalid JSON, missing files)

Run tests:
```bash
npm test tests/unit/cli/bootstrap.test.ts
```

### Integration Tests

Manual testing checklist:
- [ ] Fresh install (no Local installed)
- [ ] Local installed but not running
- [ ] Local running but addon not installed
- [ ] Addon installed but not activated
- [ ] Addon activated, Local not running
- [ ] Everything ready (should be instant)
- [ ] Update available notification
- [ ] `nexus update` self-update
- [ ] Linux custom path prompt
- [ ] SSH session without display

---

## Performance

### Timing Benchmarks

| Scenario | Time |
|----------|------|
| Everything ready | ~50ms |
| Local not running → start → wait | ~8-12s |
| Addon not installed → install → activate → restart | ~15-20s |
| First run (no Local) | Error (instant) |

### Optimization Strategies

1. **Non-blocking update check**: Doesn't slow down CLI
2. **24h cache**: Avoids hammering npm registry
3. **Parallel checks**: Process detection + file reads
4. **Smart restart logic**: Only restart if addon just activated
5. **Skip bootstrap for simple commands**: `--version`, `update`

---

## Security Considerations

### File Permissions

- `~/.nexus/config.json`: Mode 0600 (owner read/write only)
- Config directory: Mode 0700 (owner access only)

### Process Safety

- **No `sudo` required**: All operations in user space
- **No privileged APIs**: Just file reads and process spawning
- **Addon sandboxing**: Local controls addon execution

### Network Safety

- **Local traffic only**: GraphQL server is `127.0.0.1`
- **No external requests** (except npm registry for version check)
- **Version check is optional**: Failure is silent

---

## Troubleshooting

### "Timed out waiting for Local"

**Causes:**
- Local failed to start (no display, permissions)
- GraphQL server didn't initialize
- Firewall blocking localhost:50001

**Debug:**
```bash
DEBUG=true nexus sites list
```

### "Addon not found"

**Causes:**
- npm package incomplete
- Symlink creation failed (dev mode)

**Fix:**
```bash
npm install -g @local/nexus-cli --force
```

### Addon Won't Activate (Linux SSH)

**Cause:** Can't start Local GUI from SSH session

**Fix:** Activate from desktop:
1. Log into desktop
2. Open Local
3. Go to Addons
4. Enable "Nexus AI"
5. Return to SSH session

### Update Check Fails Silently

**Expected behavior:** Network errors don't interrupt CLI

**To force update check:**
```bash
nexus update --check
```

---

## Migration from Previous Version

### Before Bootstrap System

```bash
# User had to:
1. Start Local manually
2. Install addon manually
3. Activate addon manually
4. Then run CLI
```

### After Bootstrap System

```bash
# User just runs:
nexus sites list
# Everything else is automatic
```

### Breaking Changes

None. Bootstrap is transparent. Old workflows still work.

---

## Future Enhancements

### Considered but Not Implemented (Yet)

1. **Offline mode**: Cache GraphQL schema, work without Local
2. **Auto-addon-update**: Update addon when CLI updates
3. **Multi-Local support**: Choose which Local instance to connect to
4. **Windows service detection**: Check if Local service is running
5. **Addon health check**: Verify addon is functioning correctly

### Phase 4 (Future)

See `docs/CLI_MISSING_BEHAVIORS.md` for potential enhancements.

---

## References

- Design spec: `docs/CLI_DESIGN_SPEC.md`
- Missing behaviors analysis: `docs/CLI_MISSING_BEHAVIORS.md`
- Reference implementation: `/Users/jeremy.pollock/development/wpengine/local/cli/local-addon-cli-mcp`
- Tests: `tests/unit/cli/bootstrap.test.ts`
