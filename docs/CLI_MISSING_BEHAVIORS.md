# CLI Missing Behaviors - Analysis

**Date:** 2026-03-20
**Reference:** `/Users/jeremy.pollock/development/wpengine/local/cli/local-addon-cli-mcp`

## Summary

Analyzed the `local-addon-cli-mcp` reference implementation to identify CLI behavioral patterns not present in Nexus AI. Found **7 critical missing features** that should be implemented.

---

## 1. Auto-Start Local ⚠️ CRITICAL

### Current State (Nexus)
- CLI fails immediately if Local isn't running
- Error: "Local is not running. Please start Local first."
- User must manually open Local app

### Reference Implementation
**Location:** `packages/cli/src/bootstrap/index.ts`

```typescript
export async function isLocalRunning(): Promise<boolean> {
  if (process.platform === 'darwin') {
    const { stdout } = await execAsync(`pgrep -f "Local.app"`);
    return stdout.trim().length > 0;
  } else if (process.platform === 'win32') {
    const { stdout } = await execAsync(`tasklist /FI "IMAGENAME eq Local.exe"`);
    return stdout.includes('Local.exe');
  } else {
    // Linux
    const { stdout } = await execAsync(`pgrep -fi "local"`);
    return stdout.trim().length > 0;
  }
}

export async function startLocal(): Promise<void> {
  if (process.platform === 'darwin') {
    await execAsync(`open -a "Local"`);
  } else if (process.platform === 'win32') {
    await execAsync(`start /MIN "" "${paths.appExecutable}"`);
  } else {
    // Linux
    if (!hasDisplay()) {
      console.error('Cannot start Local: no display available (SSH session?)');
      return;
    }
    await execAsync(`${executable} &`);
  }
}
```

### What to Implement
1. Process detection (cross-platform)
2. Auto-launch Local if not running
3. Handle edge cases:
   - Linux SSH sessions (no display)
   - Already running
   - Failed to start

### Files to Create
- `src/cli/bootstrap/process.ts` - Process detection and launching
- `src/cli/bootstrap/paths.ts` - Platform-specific paths

---

## 2. Version Checking & Update Notifications ⚠️ IMPORTANT

### Current State (Nexus)
- No version checking
- Users don't know if updates are available
- Manual `npm install -g` required

### Reference Implementation
**Location:** `packages/cli/src/index.ts`

```typescript
const UPDATE_CHECK_FILE = path.join(os.homedir(), '.lwp-update-check');
const UPDATE_CHECK_INTERVAL = 24 * 60 * 60 * 1000; // 24 hours

async function fetchLatestVersion(): Promise<string | null> {
  const response = await fetch(`https://registry.npmjs.org/${PACKAGE_NAME}/latest`);
  if (response.ok) {
    const data = await response.json();
    return data.version;
  }
  return null;
}

async function checkForUpdates(): Promise<void> {
  const cache = readUpdateCache();
  const now = Date.now();

  // Skip if checked recently
  if (cache && now - cache.lastCheck < UPDATE_CHECK_INTERVAL) {
    if (cache.latestVersion && isNewerVersion(cache.latestVersion, CURRENT_VERSION)) {
      console.log(`\n\x1b[33mUpdate available: ${CURRENT_VERSION} → ${cache.latestVersion}\x1b[0m`);
      console.log(`Run: \x1b[36mnexus update\x1b[0m\n`);
    }
    return;
  }

  // Non-blocking check (fire and forget)
  fetchLatestVersion()
    .then((latestVersion) => {
      writeUpdateCache({ lastCheck: now, latestVersion });
      if (latestVersion && isNewerVersion(latestVersion, CURRENT_VERSION)) {
        console.log(`\n\x1b[33mUpdate available: ${CURRENT_VERSION} → ${latestVersion}\x1b[0m`);
      }
    })
    .catch(() => {});
}
```

### What to Implement
1. Check npm registry on every CLI run (with 24h cache)
2. Show update notification if newer version available
3. Non-blocking (don't slow down CLI)
4. Cache to avoid hammering npm registry

### Files to Create
- `src/cli/utils/version.ts` - Version checking and comparison
- Cache file: `~/.nexus-update-check`

---

## 3. Self-Update Command ⚠️ IMPORTANT

### Current State (Nexus)
- No `nexus update` command
- Users must remember `npm install -g @local/nexus-cli`

### Reference Implementation
**Location:** `packages/cli/src/index.ts`

```typescript
program
  .command('update')
  .description('Update the CLI to the latest version')
  .option('--check', 'Only check for updates, do not install')
  .action(async (options) => {
    if (options.check) {
      const spinner = ora('Checking for updates...').start();
      const latestVersion = await fetchLatestVersion();

      if (isNewerVersion(latestVersion, CURRENT_VERSION)) {
        spinner.succeed(`Update available: ${CURRENT_VERSION} → ${latestVersion}`);
        console.log(`\nRun \x1b[36mnexus update\x1b[0m to install`);
      } else {
        spinner.succeed(`You're on the latest version (${CURRENT_VERSION})`);
      }
      return;
    }

    const spinner = ora('Updating CLI...').start();
    try {
      execSync(`npm update -g ${PACKAGE_NAME}`, { stdio: 'pipe' });
      spinner.succeed('CLI updated successfully');

      const newVersion = await fetchLatestVersion();
      if (newVersion) {
        console.log(`\nUpdated to version ${newVersion}`);
      }
    } catch (error) {
      spinner.fail('Update failed');
      console.error('Try running: npm update -g ' + PACKAGE_NAME);
    }
  });
```

### What to Implement
1. `nexus update` - Self-update command
2. `nexus update --check` - Check without updating
3. Show spinner during update
4. Verify new version after update

### Files to Modify
- `src/cli/index.ts` - Add update command

---

## 4. Bootstrap System ⚠️ CRITICAL

### Current State (Nexus)
- GraphQL client tries to connect immediately
- Fails if Local isn't ready
- No retry logic
- No startup sequence

### Reference Implementation
**Location:** `packages/cli/src/bootstrap/index.ts`

```typescript
export async function bootstrap(options?: {
  verbose?: boolean;
  skipAddonInstall?: boolean;
  onStatus?: (status: string) => void;
}): Promise<BootstrapResult> {
  const actions: string[] = [];

  // 1. Check if Local is installed
  if (!isLocalInstalled()) {
    return {
      success: false,
      error: 'Local is not installed. Download from https://localwp.com',
      actions,
    };
  }

  // 2. Ensure addon is installed and activated
  const addonResult = await ensureAddon({ onStatus: log });
  if (!addonResult.success) {
    return { success: false, error: addonResult.error, actions };
  }

  // 3. Check if Local is running
  const running = await isLocalRunning();

  // 4. Restart if addon just activated, or start if not running
  if (addonResult.needsRestart && running) {
    log('Restarting Local to activate addon...');
    await restartLocal();
  } else if (!running) {
    log('Starting Local...');
    await startLocal();
  }

  // 5. Wait for GraphQL server
  log('Waiting for GraphQL...');
  const ready = await waitForGraphQL();

  if (!ready) {
    return {
      success: false,
      error: 'Timed out waiting for Local. Is Local running?',
      actions,
    };
  }

  // 6. Read connection info
  const connectionInfo = readConnectionInfo();
  if (!connectionInfo) {
    return { success: false, error: 'Could not read GraphQL connection info.', actions };
  }

  return { success: true, connectionInfo, actions };
}
```

### What to Implement
1. Comprehensive startup sequence
2. Check → Install → Activate → Start → Wait → Connect
3. Progress messages for each step
4. Graceful error handling at each step

### Files to Create
- `src/cli/bootstrap/index.ts` - Main bootstrap orchestration

---

## 5. GraphQL Readiness Polling ⚠️ CRITICAL

### Current State (Nexus)
- GraphQL client tries to connect once
- Fails immediately if server not ready
- No retry or wait logic

### Reference Implementation
**Location:** `packages/cli/src/bootstrap/index.ts`

```typescript
export async function waitForGraphQL(
  timeoutMs: number = 30000,
  pollIntervalMs: number = 500
): Promise<boolean> {
  const start = Date.now();

  while (Date.now() - start < timeoutMs) {
    const connectionInfo = readConnectionInfo();

    if (connectionInfo) {
      try {
        const controller = new AbortController();
        const requestTimeout = setTimeout(() => controller.abort(), 2000);

        const response = await fetch(connectionInfo.url, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${connectionInfo.authToken}`,
          },
          body: JSON.stringify({ query: '{ __typename }' }),
          signal: controller.signal,
        });

        clearTimeout(requestTimeout);

        if (response.ok) {
          return true; // Ready!
        }
      } catch {
        // Server not ready yet
      }
    }

    await delay(pollIntervalMs);
  }

  return false; // Timeout
}
```

### What to Implement
1. Poll GraphQL endpoint until ready
2. 30-second timeout (configurable)
3. Health check query: `{ __typename }`
4. Per-request timeout (2s) with AbortController

### Files to Create
- `src/cli/bootstrap/graphql.ts` - GraphQL waiting logic

---

## 6. Addon Auto-Install & Activation ⚠️ CRITICAL

### Current State (Nexus)
- Assumes addon is already installed
- No auto-installation
- No auto-activation

### Reference Implementation
**Location:** `packages/cli/src/bootstrap/index.ts`

```typescript
export async function ensureAddon(options?: {
  onStatus?: (status: string) => void;
}): Promise<{ success: boolean; error?: string; needsRestart: boolean }> {
  // Check if addon is installed
  if (!isAddonInstalled()) {
    log('Addon not installed. Installing...');
    const result = await installAddon(options);
    if (!result.success) {
      return result;
    }
    return { success: true, needsRestart: true };
  }

  // Check if addon is activated
  if (!isAddonActivated()) {
    const running = await isLocalRunning();

    if (running) {
      // Can't modify enabled-addons.json while Local is running
      log('Stopping Local to activate addon...');
      await stopLocal();
      await delay(2000);
      log('Activating addon...');
      activateAddon();
      return { success: true, needsRestart: true };
    } else {
      // Safe to modify enabled-addons.json
      log('Activating addon...');
      const needsRestart = activateAddon();
      return { success: true, needsRestart };
    }
  }

  return { success: true, needsRestart: false };
}

function activateAddon(): boolean {
  const paths = getLocalPaths();
  let enabledAddons: Record<string, boolean> = {};

  if (fs.existsSync(paths.enabledAddonsFile)) {
    const content = fs.readFileSync(paths.enabledAddonsFile, 'utf-8');
    enabledAddons = JSON.parse(content);
  }

  // Check if already activated
  if (enabledAddons[ADDON_ENABLED_KEY] === true) {
    return false; // No restart needed
  }

  // Activate
  enabledAddons[ADDON_ENABLED_KEY] = true;
  fs.writeFileSync(paths.enabledAddonsFile, JSON.stringify(enabledAddons, null, 2));

  return true; // Restart needed
}
```

### What to Implement
1. Check if addon installed (`addons/nexus-ai` directory exists)
2. Auto-install if missing (copy from bundled or symlink for dev)
3. Check if addon activated (`enabled-addons.json`)
4. Auto-activate if not enabled
5. Restart Local if needed to load addon

### Files to Create
- `src/cli/bootstrap/addon.ts` - Addon management

---

## 7. Cross-Platform Path Handling 📝 ENHANCEMENT

### Current State (Nexus)
- Basic platform detection
- Hardcoded paths

### Reference Implementation
**Location:** `packages/cli/src/bootstrap/paths.ts`

```typescript
export function getLocalPaths(): LocalPaths {
  const platform = process.platform;
  const home = os.homedir();

  switch (platform) {
    case 'darwin':
      const dataDir = path.join(home, 'Library', 'Application Support', 'Local');
      return {
        dataDir,
        addonsDir: path.join(dataDir, 'addons'),
        enabledAddonsFile: path.join(dataDir, 'enabled-addons.json'),
        graphqlConnectionInfoFile: path.join(dataDir, 'graphql-connection-info.json'),
        appExecutable: '/Applications/Local.app',
        appName: 'Local',
      };

    case 'win32':
      const appData = process.env.APPDATA || path.join(home, 'AppData', 'Roaming');
      const dataDir = path.join(appData, 'Local');
      const programFiles = process.env['ProgramFiles'] || 'C:\\Program Files';
      return {
        dataDir,
        addonsDir: path.join(dataDir, 'addons'),
        enabledAddonsFile: path.join(dataDir, 'enabled-addons.json'),
        graphqlConnectionInfoFile: path.join(dataDir, 'graphql-connection-info.json'),
        appExecutable: path.join(programFiles, 'Local', 'Local.exe'),
        appName: 'Local.exe',
      };

    case 'linux':
      const dataDir = path.join(home, '.config', 'Local');
      const appExecutable = findLinuxExecutable() || '/opt/Local/local';
      return {
        dataDir,
        addonsDir: path.join(dataDir, 'addons'),
        enabledAddonsFile: path.join(dataDir, 'enabled-addons.json'),
        graphqlConnectionInfoFile: path.join(dataDir, 'graphql-connection-info.json'),
        appExecutable,
        appName: 'local',
      };

    default:
      throw new Error(`Unsupported platform: ${platform}`);
  }
}

// Linux-specific: prompt for executable path if not found
async function ensureLocalExecutable(): Promise<string | null> {
  if (process.platform !== 'linux') {
    return getLocalPaths().appExecutable;
  }

  const found = findLinuxExecutable();
  if (found) return found;

  // Interactive prompt for Linux users
  return promptForLocalPath();
}
```

### What to Implement
1. Enhanced path detection (already mostly done)
2. Linux executable prompt (nice to have)
3. Custom path configuration (~/.nexus/config.json)

### Files to Modify
- `src/cli/bootstrap/paths.ts` - Enhanced path handling

---

## Implementation Priority

### Phase 1: Critical (Must Have)
1. ✅ **Bootstrap System** - Orchestrates everything
2. ✅ **Auto-Start Local** - Don't fail if Local not running
3. ✅ **GraphQL Readiness Polling** - Wait for server to be ready
4. ✅ **Addon Auto-Install/Activation** - Ensure addon is loaded

### Phase 2: Important (Should Have)
5. ✅ **Version Checking** - Notify users of updates
6. ✅ **Self-Update Command** - `nexus update`

### Phase 3: Enhancement (Nice to Have)
7. 📝 **Linux Executable Prompt** - Better Linux support

---

## File Structure to Create

```
src/cli/bootstrap/
├── index.ts           # Main bootstrap() orchestration
├── process.ts         # isLocalRunning(), startLocal(), stopLocal()
├── paths.ts           # getLocalPaths() - platform-specific paths
├── addon.ts           # ensureAddon(), installAddon(), activateAddon()
└── graphql.ts         # waitForGraphQL() - readiness polling

src/cli/utils/
└── version.ts         # fetchLatestVersion(), checkForUpdates()

src/cli/commands/
└── update.ts          # nexus update command

src/cli/index.ts       # Modified to call bootstrap() and checkForUpdates()
```

---

## Key Takeaways

### What Reference Does Better
1. **Resilient startup** - Handles every edge case gracefully
2. **User experience** - Auto-fixes problems without user intervention
3. **Self-maintaining** - Updates itself, installs addon, starts Local
4. **Clear error messages** - Tells users exactly what to do

### What Nexus Currently Lacks
1. **No auto-recovery** - Fails fast instead of trying to fix
2. **No self-update** - Users must manually update
3. **No addon management** - Assumes addon is ready
4. **No startup sequence** - Just tries to connect

### Migration Path
1. Create `src/cli/bootstrap/` directory structure
2. Port process detection and launching from reference
3. Port addon installation and activation logic
4. Port GraphQL waiting logic
5. Add version checking and update command
6. Update `src/cli/index.ts` to use bootstrap system
7. Update `src/cli/utils/graphql.ts` to use polling

---

## Testing Strategy

### Bootstrap System Tests
- [ ] Local not installed → Clear error
- [ ] Local not running → Auto-starts
- [ ] Addon not installed → Auto-installs
- [ ] Addon not activated → Auto-activates and restarts
- [ ] GraphQL not ready → Waits up to 30s
- [ ] GraphQL timeout → Clear error

### Version Check Tests
- [ ] First run → Checks npm registry
- [ ] Subsequent runs (< 24h) → Uses cache
- [ ] Subsequent runs (> 24h) → Checks registry again
- [ ] Update available → Shows notification
- [ ] Already latest → No notification
- [ ] Network error → Silently fails

### Update Command Tests
- [ ] `nexus update` → Runs npm update
- [ ] `nexus update --check` → Dry run
- [ ] Update succeeds → Shows new version
- [ ] Update fails → Shows manual command

---

## References

- Reference implementation: `/Users/jeremy.pollock/development/wpengine/local/cli/local-addon-cli-mcp`
- Key files:
  - `packages/cli/src/bootstrap/index.ts`
  - `packages/cli/src/bootstrap/paths.ts`
  - `packages/cli/src/index.ts`
- Design spec: `docs/rfcs/002-cli-architecture.md`
