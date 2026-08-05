# External Host Metadata Refresh (L1+L2) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give external SSH hosts the same L1+L2 metadata WP Engine installs get — WP version, plugins, themes, PHP version, site URL, users, post counts, settings — collected on an opt-in interval, so they stop appearing empty in fleet views and become health-scoreable.

**Architecture:** A new `ExternalRefreshScheduler` mirrors `WpeRefreshScheduler`'s shape (idempotent start/stop/restart, staleness threshold, settings-reactive) but routes through `resolveTransport` rather than WP Engine's SSH bridge. Because external SSH has no `ControlMaster`, the 16 individual WP-CLI calls WP Engine makes are collapsed into 4 batched remote commands using indexed delimiters. Collection, writing, and scheduling live in three separate files so each is testable without the others.

**Tech Stack:** TypeScript, better-sqlite3 (graph DB), Jest, `p-limit` (already a dependency), Zod (settings schema).

## Global Constraints

- **Nothing is ever written to the user's remote server.** Every command this plan adds is read-only. No `wp option update`, no file writes, no installs.
- **No SSH key material is stored.** The `~/.ssh/config` alias remains the only credential path.
- **`src/main/transport/ssh-args.ts` is the only place an SSH invocation or remote command is constructed.** The batch builder goes there for that reason.
- **Never add `-F /dev/null` to an external SSH builder.** WPE passes it deliberately; external depends entirely on the user's SSH config. See that file's inverted-rule docblock.
- **Do not add `ControlMaster` to `buildExternalSshArgs`.** Shared hosting commonly caps `MaxSessions`, a command-line `-o` overrides the user's own config, and `ControlPersist` would hold a socket open to a third party's production server. Batching (Task 1) exists so this is unnecessary.
- **`resolveTransport` is the only router.** No target resolution, no command blocklist, no `isOperationAllowed` call in any new file.
- **Read-only paths are not audited.** Nothing in this plan mutates a remote resource; do **not** call `auditDirectOperation` anywhere.
- **The honesty rule: a value that did not parse is written NULL — never a default, never `0`, never `false`.** `php_version` in particular must never fall back to `'8.0'`; that fabrication was removed from the health path last week and must not re-enter through a writer.
- **A failed host keeps its existing data.** An unreachable server must never zero or NULL rows a previous successful cycle wrote.
- `better-sqlite3` is built for the **system-Node** ABI, so `npx jest` works. Do **not** run `npm run rebuild` until a task explicitly asks for a live check.
- **Baseline: 12 failing suites, 22 failures, 3576 passing.** Compare failing suite **names**, not counts.

---

## File Structure

| File | Responsibility |
|---|---|
| `src/main/transport/ssh-args.ts` *(modify)* | Add `WP_CLI_BATCH_DELIMITER`, `buildExternalWpCliBatch()`, `parseWpCliBatchOutput()`. Builder and parser share one wire format, so they live together. |
| `src/main/transport/ExternalSshTransport.ts` *(modify)* | Add `runWpCliBatch()` — one SSH round trip, N wp commands. |
| `src/main/startup/collectExternalHostData.ts` *(create)* | The four batches → one typed `ExternalHostData`. Knows WP-CLI, knows nothing about the DB or timers. |
| `src/main/startup/writeExternalHostData.ts` *(create)* | `ExternalHostData` → graph rows. Owns the honesty rule. Knows the DB, knows nothing about SSH. |
| `src/main/startup/ExternalRefreshScheduler.ts` *(create)* | Timer, staleness selection, concurrency, never-throw. Orchestrates the two above. |
| `src/common/types.ts`, `src/common/schemas.ts` *(modify)* | Two new settings. |
| `src/main/index.ts` *(modify)* | Construct, start, and make settings-reactive. |
| `src/cli/commands/host.ts` *(modify)* | `nexus host refresh <alias>`. |
| `src/main/ipc-handlers.ts` *(modify)* | Data Completeness counts external. |
| `src/main/graphql/resolvers.ts` *(modify)* | Health scoring becomes conditional on data presence. |

---

### Task 1: Batched WP-CLI over one SSH connection

**Files:**
- Modify: `src/main/transport/ssh-args.ts` (add after `buildExternalWpCliCommand`, ~`:166`)
- Modify: `src/main/transport/ExternalSshTransport.ts` (add method after `runWpCli`, ~`:88`)
- Test: `tests/unit/transport/wp-cli-batch.test.ts` *(create)*

**Interfaces:**
- Consumes: `buildExternalWpCliCommand(args: string[], wpPath?: string, wpCliBin?: string): string` and `escapeShellArg(arg: string): string`, both existing in `ssh-args.ts`.
- Produces:
  - `WP_CLI_BATCH_DELIMITER = '<<<NEXUS:'` (constant)
  - `buildExternalWpCliBatch(commands: string[][], wpPath?: string, wpCliBin?: string): string`
  - `parseWpCliBatchOutput(stdout: string, expectedCount: number): (string | null)[]`
  - `ExternalSshTransport.runWpCliBatch(commands: string[][]): Promise<(string | null)[]>`

**Why batching.** `buildExternalSshArgs` sets no `ControlMaster`, so each `runWpCli` is a full SSH handshake. WP Engine makes 16 calls per site and survives it only because its builder multiplexes. See Global Constraints for why we do not copy that.

**Parse contract, and why it is indexed.** Sub-commands are separated by `echo '<<<NEXUS:N>>>'` where N is the 1-based index of the command that just ran. Parsing keys off those indices, not off position in the split. A sub-command that fails prints nothing to stdout but its delimiter still runs, so its section is an empty string → `null`. If a delimiter is missing entirely (host died mid-stream), every section from that point on is `null` rather than shifted onto the wrong field.

A compound command's exit status is only the last sub-command's, so **nothing may gate on the exit code.** Correctness comes from the parse.

- [ ] **Step 1: Write the failing tests**

```ts
// tests/unit/transport/wp-cli-batch.test.ts
import {
  buildExternalWpCliBatch,
  parseWpCliBatchOutput,
} from '../../../src/main/transport/ssh-args';

describe('buildExternalWpCliBatch', () => {
  it('joins commands with indexed delimiters', () => {
    const cmd = buildExternalWpCliBatch([['core', 'version'], ['option', 'get', 'siteurl']]);
    expect(cmd).toBe(
      "wp core version; echo '<<<NEXUS:1>>>'; wp option get siteurl; echo '<<<NEXUS:2>>>'"
    );
  });

  it('applies --path and an explicit wp binary to every command', () => {
    const cmd = buildExternalWpCliBatch([['core', 'version'], ['cli', 'version']], '/var/www', '/usr/local/bin/wp');
    expect(cmd).toContain("'/usr/local/bin/wp' --path='/var/www' core version");
    expect(cmd).toContain("'/usr/local/bin/wp' --path='/var/www' cli version");
  });

  it('escapes arguments — a crafted option name cannot inject a command', () => {
    const cmd = buildExternalWpCliBatch([['option', 'get', "x'; rm -rf /; echo '"]]);
    expect(cmd).not.toMatch(/;\s*rm -rf/);
    expect(cmd).toContain("'x'\\''; rm -rf /; echo '\\'''");
  });

  it('returns an empty string for no commands', () => {
    expect(buildExternalWpCliBatch([])).toBe('');
  });
});

describe('parseWpCliBatchOutput', () => {
  it('splits sections by index', () => {
    const out = "6.8.0\n<<<NEXUS:1>>>\nhttps://example.com\n<<<NEXUS:2>>>\n";
    expect(parseWpCliBatchOutput(out, 2)).toEqual(['6.8.0', 'https://example.com']);
  });

  it('returns null for a sub-command that produced no output', () => {
    const out = "6.8.0\n<<<NEXUS:1>>>\n<<<NEXUS:2>>>\nadmin@example.com\n<<<NEXUS:3>>>\n";
    expect(parseWpCliBatchOutput(out, 3)).toEqual(['6.8.0', null, 'admin@example.com']);
  });

  it('preserves multi-line output within a section', () => {
    const out = "line1\nline2\n<<<NEXUS:1>>>\n";
    expect(parseWpCliBatchOutput(out, 1)).toEqual(['line1\nline2']);
  });

  it('nulls trailing sections when the stream is truncated, never shifts them', () => {
    const out = "6.8.0\n<<<NEXUS:1>>>\nhttps://example.com\n";  // delimiter 2 never arrived
    expect(parseWpCliBatchOutput(out, 3)).toEqual(['6.8.0', null, null]);
  });

  it('nulls a section whose delimiter is missing but keeps later indexed ones', () => {
    const out = "a\n<<<NEXUS:1>>>\nb\n<<<NEXUS:3>>>\n";  // 2 never emitted
    expect(parseWpCliBatchOutput(out, 3)).toEqual(['a', null, 'b']);
  });

  it('returns all nulls for empty output', () => {
    expect(parseWpCliBatchOutput('', 2)).toEqual([null, null]);
  });
});
```

- [ ] **Step 2: Run and verify they fail**

Run: `npx jest tests/unit/transport/wp-cli-batch.test.ts`
Expected: FAIL — `buildExternalWpCliBatch is not a function`.

- [ ] **Step 3: Implement the builder and parser**

Add to `src/main/transport/ssh-args.ts`, immediately after `buildExternalWpCliCommand`:

```ts
/**
 * Delimiter prefix for batched WP-CLI output. The full marker is
 * `<<<NEXUS:N>>>` where N is the 1-based index of the command that just ran.
 *
 * Indexed, not bare, on purpose: a sub-command that fails prints nothing, and a
 * host that dies mid-stream stops emitting entirely. With bare delimiters both
 * cases would shift every later section onto the wrong field. With indices the
 * parser can leave the gap as null.
 */
export const WP_CLI_BATCH_DELIMITER = '<<<NEXUS:';

/**
 * Several WP-CLI commands as ONE remote command, so they cost one SSH
 * handshake instead of N.
 *
 * buildExternalSshArgs sets no ControlMaster (see its docblock — forcing
 * multiplexing onto an arbitrary host is not safe the way it is onto WP
 * Engine), so without batching a 16-command refresh would be 16 full
 * handshakes.
 *
 * Every argument goes through escapeShellArg via buildExternalWpCliCommand.
 * The command set is fixed and closed at the call site; no caller-supplied
 * string reaches the shell unescaped.
 */
export function buildExternalWpCliBatch(
  commands: string[][],
  wpPath?: string,
  wpCliBin?: string,
): string {
  if (commands.length === 0) return '';
  return commands
    .map((args, i) =>
      `${buildExternalWpCliCommand(args, wpPath, wpCliBin)}; echo '${WP_CLI_BATCH_DELIMITER}${i + 1}>>>'`)
    .join('; ');
}

/**
 * Split batched stdout back into one entry per command.
 *
 * Returns exactly `expectedCount` entries. An entry is null when its
 * sub-command produced no output, or when its delimiter never arrived because
 * the connection dropped. Never returns fewer entries and never shifts output
 * from one command onto another — a wrong-but-plausible value is worse than a
 * missing one.
 *
 * The batch's exit code is only the LAST sub-command's, so callers must not
 * gate on it. This parse is the source of truth.
 */
export function parseWpCliBatchOutput(
  stdout: string,
  expectedCount: number,
): (string | null)[] {
  const sections: (string | null)[] = new Array(expectedCount).fill(null);
  if (!stdout) return sections;

  // Capture the index from each marker so gaps stay gaps.
  const markerRe = new RegExp(`^${WP_CLI_BATCH_DELIMITER.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(\\d+)>>>$`);
  let buffer: string[] = [];

  for (const line of stdout.split('\n')) {
    const m = line.trim().match(markerRe);
    if (m) {
      const idx = parseInt(m[1], 10) - 1;
      const text = buffer.join('\n').trim();
      if (idx >= 0 && idx < expectedCount) {
        sections[idx] = text === '' ? null : text;
      }
      buffer = [];
      continue;
    }
    buffer.push(line);
  }

  return sections;
}
```

- [ ] **Step 4: Add the transport method**

In `src/main/transport/ExternalSshTransport.ts`, import `buildExternalWpCliBatch` and `parseWpCliBatchOutput` alongside the existing imports, then add after `runWpCli`:

```ts
  /**
   * Run several WP-CLI commands in ONE SSH round trip.
   *
   * Returns one entry per command, null where that command produced nothing.
   * Deliberately does not surface the exit code: a compound command's status is
   * only its last sub-command's, so it says nothing useful about the others.
   * A connection-level failure returns all nulls, which callers must treat as
   * "collected nothing" and NOT as "the site has nothing".
   */
  async runWpCliBatch(commands: string[][]): Promise<(string | null)[]> {
    if (commands.length === 0) return [];
    const remote = buildExternalWpCliBatch(commands, this.wpPath, this.wpCliBin);
    const res = await runSsh(this.alias, remote);
    if (res.spawnError !== undefined) return new Array(commands.length).fill(null);
    return parseWpCliBatchOutput(res.stdout, commands.length);
  }
```

- [ ] **Step 5: Run tests**

Run: `npx jest tests/unit/transport/ && npx tsc --noEmit`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/main/transport/ssh-args.ts src/main/transport/ExternalSshTransport.ts tests/unit/transport/wp-cli-batch.test.ts
git commit -m "feat(transport): batch WP-CLI commands into one SSH round trip"
```

---

### Task 2: Collect L1+L2 data from an external host

**Files:**
- Create: `src/main/startup/collectExternalHostData.ts`
- Test: `tests/unit/startup/collectExternalHostData.test.ts` *(create)*

**Interfaces:**
- Consumes: `runWpCliBatch(commands: string[][]): Promise<(string | null)[]>` from Task 1.
- Produces:
  - `interface ExternalHostData` (below)
  - `collectExternalHostData(runner: BatchRunner, logger: CollectLogger): Promise<ExternalHostData>`
  - `type BatchRunner = { runWpCliBatch(commands: string[][]): Promise<(string | null)[]> }`

This file knows WP-CLI and nothing about the database or timers. Depending on a `BatchRunner` shape rather than `ExternalSshTransport` keeps the tests free of SSH.

**Every field is optional.** A field absent from the result means "not collected", which Task 3 turns into NULL. There is no sentinel and no default.

- [ ] **Step 1: Write the failing tests**

```ts
// tests/unit/startup/collectExternalHostData.test.ts
import { collectExternalHostData } from '../../../src/main/startup/collectExternalHostData';

const logger = { info: jest.fn(), warn: jest.fn(), error: jest.fn() };

/** Answers each batch in order with the supplied section arrays. */
function runner(...batches: (string | null)[][]) {
  const queue = [...batches];
  return {
    runWpCliBatch: jest.fn(async (cmds: string[][]) => {
      const next = queue.shift();
      return next ?? new Array(cmds.length).fill(null);
    }),
  };
}

describe('collectExternalHostData', () => {
  it('parses PHP version from wp --info JSON', async () => {
    const scalars = new Array(18).fill(null);
    scalars[0] = '6.8.0';
    scalars[1] = JSON.stringify({ php_version: '8.2.10', wp_cli_version: '2.9.0' });
    const data = await collectExternalHostData(runner(scalars), logger);
    expect(data.wpVersion).toBe('6.8.0');
    expect(data.phpVersion).toBe('8.2.10');
  });

  it('falls back to the plain-text "PHP version:" line on older WP-CLI', async () => {
    const scalars = new Array(18).fill(null);
    scalars[1] = 'OS:\tLinux\nPHP binary:\t/usr/bin/php8.1\nPHP version:\t8.1.27\nWP-CLI version:\t2.7.1';
    const data = await collectExternalHostData(runner(scalars), logger);
    expect(data.phpVersion).toBe('8.1.27');
  });

  it('leaves phpVersion undefined when neither form parses — never a default', async () => {
    const scalars = new Array(18).fill(null);
    scalars[1] = 'total gibberish';
    const data = await collectExternalHostData(runner(scalars), logger);
    expect(data.phpVersion).toBeUndefined();
    expect(data).not.toHaveProperty('phpVersion', '8.0');
  });

  it('never mistakes the WP-CLI version for the PHP version', async () => {
    const scalars = new Array(18).fill(null);
    scalars[1] = 'WP-CLI version:\t2.9.0';
    const data = await collectExternalHostData(runner(scalars), logger);
    expect(data.phpVersion).toBeUndefined();
  });

  it('parses plugins and themes as JSON with active status', async () => {
    const plugins = [JSON.stringify([
      { name: 'akismet', title: 'Akismet', version: '5.3', status: 'active' },
      { name: 'hello', title: 'Hello Dolly', version: '1.7', status: 'inactive' },
    ])];
    const themes = [JSON.stringify([{ name: 'twentytwentyfour', title: 'TT4', version: '1.0', status: 'active' }])];
    const data = await collectExternalHostData(
      runner(new Array(18).fill(null), plugins, themes), logger);
    expect(data.plugins).toEqual([
      { slug: 'akismet', name: 'Akismet', version: '5.3', isActive: true },
      { slug: 'hello', name: 'Hello Dolly', version: '1.7', isActive: false },
    ]);
    expect(data.themes).toEqual([
      { slug: 'twentytwentyfour', name: 'TT4', version: '1.0', isActive: true },
    ]);
  });

  it('leaves plugins undefined — NOT an empty array — when the batch returned nothing', async () => {
    const data = await collectExternalHostData(runner(new Array(18).fill(null), [null], [null]), logger);
    expect(data.plugins).toBeUndefined();
    expect(data.themes).toBeUndefined();
  });

  it('distinguishes a genuinely empty plugin list from a failed one', async () => {
    const data = await collectExternalHostData(
      runner(new Array(18).fill(null), ['[]'], [null]), logger);
    expect(data.plugins).toEqual([]);
    expect(data.themes).toBeUndefined();
  });

  it('parses counts as numbers and leaves unparseable ones undefined, never 0', async () => {
    const counts = ['42', '17', JSON.stringify([{ post_modified: '2026-01-15 10:30:00' }]), '5', '2', 'not-a-number'];
    const data = await collectExternalHostData(
      runner(new Array(18).fill(null), [null], [null], counts), logger);
    expect(data.postCount).toBe(42);
    expect(data.userCount).toBe(5);
    expect(data.editorCount).toBeUndefined();
  });

  it('collects the 11 settings options into settingsJson, omitting ones that did not answer', async () => {
    const scalars = new Array(18).fill(null);
    scalars[5] = 'My Blog';        // blogname
    scalars[6] = 'Just another';   // blogdescription
    const data = await collectExternalHostData(runner(scalars), logger);
    expect(JSON.parse(data.settingsJson!)).toEqual({ blogname: 'My Blog', blogdescription: 'Just another' });
  });

  it('omits settingsJson entirely when no option answered', async () => {
    const data = await collectExternalHostData(runner(new Array(18).fill(null)), logger);
    expect(data.settingsJson).toBeUndefined();
  });

  it('makes exactly four SSH round trips', async () => {
    const r = runner();
    await collectExternalHostData(r, logger);
    expect(r.runWpCliBatch).toHaveBeenCalledTimes(4);
  });
});
```

- [ ] **Step 2: Run and verify they fail**

Run: `npx jest tests/unit/startup/collectExternalHostData.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement**

```ts
// src/main/startup/collectExternalHostData.ts

/** Anything that can run a batch. Narrower than ExternalSshTransport so tests need no SSH. */
export type BatchRunner = {
  runWpCliBatch(commands: string[][]): Promise<(string | null)[]>;
};

export type CollectLogger = {
  info: (...args: any[]) => void;
  warn: (...args: any[]) => void;
  error: (...args: any[]) => void;
};

export interface ExternalPluginRecord {
  slug: string;
  name: string;
  version: string | null;
  isActive: boolean;
}

/**
 * L1+L2 data collected from one external host.
 *
 * EVERY field is optional, and absent means "not collected" — never "zero" and
 * never "empty". writeExternalHostData turns absent into NULL and leaves the
 * previous value alone. An empty ARRAY, by contrast, is a real answer: the host
 * genuinely reports no plugins.
 */
export interface ExternalHostData {
  wpVersion?: string;
  phpVersion?: string;
  siteUrl?: string;
  adminEmail?: string;
  activeTheme?: string;
  settingsJson?: string;
  plugins?: ExternalPluginRecord[];
  themes?: ExternalPluginRecord[];
  postCount?: number;
  postCountPosts?: number;
  lastPostAt?: number;
  userCount?: number;
  adminCount?: number;
  editorCount?: number;
}

/** The 11 options WpeRefreshScheduler collects into settings_json. Same list, same order. */
const SETTINGS_OPTIONS = [
  'blogname', 'blogdescription', 'blog_public', 'show_on_front', 'posts_per_page',
  'default_comment_status', 'permalink_structure', 'timezone_string',
  'users_can_register', 'default_role', 'WPLANG',
] as const;

function num(section: string | null | undefined): number | undefined {
  if (section == null) return undefined;
  const n = Number(section.trim());
  return Number.isFinite(n) ? n : undefined;
}

/**
 * PHP version from `wp --info`.
 *
 * Prefers --format=json. Older WP-CLI rejects --format on --info and prints
 * tab-separated lines, so fall back to the `PHP version:` label. Anchored to
 * that exact label so `WP-CLI version:` can never be mistaken for it.
 * Returns undefined when neither form parses — never a default.
 */
export function parsePhpVersion(section: string | null): string | undefined {
  if (!section) return undefined;
  const text = section.trim();
  try {
    const parsed = JSON.parse(text);
    if (parsed && typeof parsed.php_version === 'string') return parsed.php_version;
  } catch { /* not JSON — fall through to the text form */ }
  const m = text.match(/^PHP version:\s*(\S+)/mi);
  return m ? m[1] : undefined;
}

function parseInventory(section: string | null): ExternalPluginRecord[] | undefined {
  if (section == null) return undefined;
  try {
    const rows = JSON.parse(section);
    if (!Array.isArray(rows)) return undefined;
    return rows.map((r: any) => ({
      slug: String(r.name ?? ''),
      name: String(r.title ?? r.name ?? ''),
      version: r.version ? String(r.version) : null,
      isActive: r.status === 'active',
    }));
  } catch {
    return undefined;
  }
}

/**
 * Collect L1+L2 from one external host in four SSH round trips.
 *
 * Mirrors WpeRefreshScheduler's data set. WP Engine reads php_version from
 * CAPI, which has no external equivalent, and `wp eval` is blocked by
 * REMOTE_POLICY — hence `wp --info`, which also answers on a host whose
 * WordPress install is broken because it does not bootstrap WordPress.
 *
 * Never throws. A batch that fails yields nulls, which become absent fields.
 */
export async function collectExternalHostData(
  runner: BatchRunner,
  logger: CollectLogger,
): Promise<ExternalHostData> {
  const data: ExternalHostData = {};

  // ── Batch A: scalars (18 commands, 1 connection) ─────────────────────────
  const scalarCommands: string[][] = [
    ['core', 'version'],
    ['--info', '--format=json'],
    ['option', 'get', 'siteurl'],
    ['option', 'get', 'admin_email'],
    ['option', 'get', 'stylesheet'],
    ...SETTINGS_OPTIONS.map((o) => ['option', 'get', o]),
    ['config', 'get', 'DISALLOW_FILE_EDIT'],
    ['config', 'get', 'WP_DEBUG'],
  ];
  const s = await runner.runWpCliBatch(scalarCommands);
  if (s[0]) data.wpVersion = s[0].trim();
  const php = parsePhpVersion(s[1]);
  if (php) data.phpVersion = php;
  if (s[2]) data.siteUrl = s[2].trim();
  if (s[3]) data.adminEmail = s[3].trim();
  if (s[4]) data.activeTheme = s[4].trim();

  const settings: Record<string, string> = {};
  SETTINGS_OPTIONS.forEach((opt, i) => {
    const v = s[5 + i];
    if (v != null && v.trim() !== '') settings[opt] = v.trim();
  });
  const fileEdit = s[5 + SETTINGS_OPTIONS.length];
  const wpDebug = s[6 + SETTINGS_OPTIONS.length];
  if (fileEdit != null && fileEdit.trim() !== '') settings.DISALLOW_FILE_EDIT = fileEdit.trim();
  if (wpDebug != null && wpDebug.trim() !== '') settings.WP_DEBUG = wpDebug.trim();
  if (Object.keys(settings).length > 0) data.settingsJson = JSON.stringify(settings);

  // ── Batch B: plugins ─────────────────────────────────────────────────────
  const [pluginJson] = await runner.runWpCliBatch([
    ['plugin', 'list', '--format=json', '--fields=name,title,version,status'],
  ]);
  const plugins = parseInventory(pluginJson);
  if (plugins) data.plugins = plugins;

  // ── Batch C: themes ──────────────────────────────────────────────────────
  const [themeJson] = await runner.runWpCliBatch([
    ['theme', 'list', '--format=json', '--fields=name,title,version,status'],
  ]);
  const themes = parseInventory(themeJson);
  if (themes) data.themes = themes;

  // ── Batch D: counts ──────────────────────────────────────────────────────
  const c = await runner.runWpCliBatch([
    ['post', 'list', '--post_status=publish', '--format=count'],
    ['post', 'list', '--post_type=post', '--post_status=publish', '--format=count'],
    ['post', 'list', '--post_status=publish', '--orderby=modified', '--posts-per-page=1',
      '--fields=post_modified', '--format=json'],
    ['user', 'list', '--format=count'],
    ['user', 'list', '--role=administrator', '--format=count'],
    ['user', 'list', '--role=editor', '--format=count'],
  ]);
  const postCount = num(c[0]);
  if (postCount !== undefined) data.postCount = postCount;
  const postCountPosts = num(c[1]);
  if (postCountPosts !== undefined) data.postCountPosts = postCountPosts;
  if (c[2]) {
    try {
      const rows = JSON.parse(c[2]);
      const modified = Array.isArray(rows) && rows[0]?.post_modified;
      if (modified) {
        const ts = Date.parse(String(modified).replace(' ', 'T') + 'Z');
        if (Number.isFinite(ts)) data.lastPostAt = ts;
      }
    } catch { /* leave absent */ }
  }
  const userCount = num(c[3]);
  if (userCount !== undefined) data.userCount = userCount;
  const adminCount = num(c[4]);
  if (adminCount !== undefined) data.adminCount = adminCount;
  const editorCount = num(c[5]);
  if (editorCount !== undefined) data.editorCount = editorCount;

  logger.info(
    `[collectExternalHostData] wp=${data.wpVersion ?? '?'} php=${data.phpVersion ?? '?'} `
    + `plugins=${data.plugins?.length ?? '?'} themes=${data.themes?.length ?? '?'}`
  );
  return data;
}
```

- [ ] **Step 4: Run tests**

Run: `npx jest tests/unit/startup/collectExternalHostData.test.ts && npx tsc --noEmit`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/main/startup/collectExternalHostData.ts tests/unit/startup/collectExternalHostData.test.ts
git commit -m "feat(external): collect L1+L2 host data in four batched SSH calls"
```

---

### Task 3: Write collected data to the graph, honestly

**Files:**
- Create: `src/main/startup/writeExternalHostData.ts`
- Test: `tests/unit/startup/writeExternalHostData.test.ts` *(create)*

**Interfaces:**
- Consumes: `ExternalHostData` from Task 2; `GraphService.upsertSite`, `.upsertPlugin`, `.upsertTheme`.
- Produces: `writeExternalHostData(graphService: GraphWriter, siteId: string, alias: string, data: ExternalHostData, now: number): Promise<void>`

**This file owns the honesty rule.** It is the last place a fabricated value could enter the database, so the tests here are the ones that matter most.

Rules, in order of importance:

1. A field absent from `ExternalHostData` is **not written at all** — the column keeps whatever a previous successful cycle put there. It is not set to NULL, not to `0`, not to a default.
2. `php_version` never becomes `'8.0'`.
3. `domain` is never overwritten with the alias. The lazy sighting upsert already guards this (`tool-registry.ts:53`); this writer must too.
4. `ssh_last_sync_at` is stamped only when *something* was collected. A completely empty result means the host was unreachable, and stamping it would suppress the retry until the next staleness window.

**Plugin/theme rows on a successful collection replace the previous set** — a plugin deleted on the host must disappear here. But that only applies when `data.plugins` is present; absent means the batch failed and the existing rows stand.

`Plugin` and `Theme` in `src/main/events/types.ts` both take `{site_id, slug, name, version, is_active, author, created_at, updated_at}`; `author` is not collected, so pass `null`.

- [ ] **Step 1: Write the failing tests**

```ts
// tests/unit/startup/writeExternalHostData.test.ts
import { writeExternalHostData } from '../../../src/main/startup/writeExternalHostData';

function graph(existingDomain = 'real.example.com') {
  const rows = new Map<string, any>();
  rows.set('ssh:myhost', { id: 'ssh:myhost', domain: existingDomain, php_version: '8.1.0' });
  return {
    upsertSite: jest.fn(async (site: any) => { rows.set(site.id, { ...rows.get(site.id), ...site }); }),
    upsertPlugin: jest.fn(async () => 1),
    upsertTheme: jest.fn(async () => 1),
    getDb: () => ({
      prepare: (sql: string) => ({
        get: () => rows.get('ssh:myhost'),
        run: (...a: any[]) => { (graphDeletes as any).push([sql, a]); },
        all: () => [],
      }),
    }),
    _rows: rows,
  };
}
let graphDeletes: any[] = [];
beforeEach(() => { graphDeletes = []; });

const NOW = 1_800_000_000_000;

describe('writeExternalHostData — the honesty rule', () => {
  it('does not write php_version at all when it was not collected', async () => {
    const g = graph();
    await writeExternalHostData(g as any, 'ssh:myhost', 'myhost', { wpVersion: '6.8.0' }, NOW);
    const written = g.upsertSite.mock.calls[0][0];
    expect(written).not.toHaveProperty('php_version');
    expect(g._rows.get('ssh:myhost').php_version).toBe('8.1.0'); // prior value survives
  });

  it('never substitutes 8.0 for a missing php_version', async () => {
    const g = graph();
    await writeExternalHostData(g as any, 'ssh:myhost', 'myhost', {}, NOW);
    const written = g.upsertSite.mock.calls[0]?.[0] ?? {};
    expect(written.php_version).not.toBe('8.0');
  });

  it('writes a collected php_version', async () => {
    const g = graph();
    await writeExternalHostData(g as any, 'ssh:myhost', 'myhost', { phpVersion: '8.3.1' }, NOW);
    expect(g.upsertSite.mock.calls[0][0].php_version).toBe('8.3.1');
  });

  it('never overwrites a real domain with the alias', async () => {
    const g = graph('real.example.com');
    await writeExternalHostData(g as any, 'ssh:myhost', 'myhost', { wpVersion: '6.8.0' }, NOW);
    const written = g.upsertSite.mock.calls[0][0];
    expect(written.domain).toBe('real.example.com');
    expect(written.domain).not.toBe('myhost');
  });

  it('does not write a count of 0 when the count was not collected', async () => {
    const g = graph();
    await writeExternalHostData(g as any, 'ssh:myhost', 'myhost', { wpVersion: '6.8.0' }, NOW);
    const written = g.upsertSite.mock.calls[0][0];
    expect(written).not.toHaveProperty('post_count');
    expect(written).not.toHaveProperty('user_count');
  });

  it('writes a genuine zero count', async () => {
    const g = graph();
    await writeExternalHostData(g as any, 'ssh:myhost', 'myhost', { postCount: 0 }, NOW);
    expect(g.upsertSite.mock.calls[0][0].post_count).toBe(0);
  });

  it('does not stamp ssh_last_sync_at when nothing was collected', async () => {
    const g = graph();
    await writeExternalHostData(g as any, 'ssh:myhost', 'myhost', {}, NOW);
    expect(g.upsertSite).not.toHaveBeenCalled();
  });

  it('stamps ssh_last_sync_at when something was collected', async () => {
    const g = graph();
    await writeExternalHostData(g as any, 'ssh:myhost', 'myhost', { wpVersion: '6.8.0' }, NOW);
    expect(g.upsertSite.mock.calls[0][0].ssh_last_sync_at).toBe(NOW);
  });

  it('writes plugin and theme rows when collected', async () => {
    const g = graph();
    await writeExternalHostData(g as any, 'ssh:myhost', 'myhost', {
      plugins: [{ slug: 'akismet', name: 'Akismet', version: '5.3', isActive: true }],
      themes:  [{ slug: 'tt4', name: 'TT4', version: '1.0', isActive: true }],
    }, NOW);
    expect(g.upsertPlugin).toHaveBeenCalledWith(expect.objectContaining({
      site_id: 'ssh:myhost', slug: 'akismet', name: 'Akismet', version: '5.3', is_active: true, author: null,
    }));
    expect(g.upsertTheme).toHaveBeenCalledWith(expect.objectContaining({ site_id: 'ssh:myhost', slug: 'tt4' }));
  });

  it('leaves existing plugin rows alone when the plugin batch failed', async () => {
    const g = graph();
    await writeExternalHostData(g as any, 'ssh:myhost', 'myhost', { wpVersion: '6.8.0' }, NOW);
    expect(g.upsertPlugin).not.toHaveBeenCalled();
    expect(graphDeletes.filter(([sql]) => /DELETE FROM plugins/i.test(sql))).toHaveLength(0);
  });

  it('removes plugins that no longer exist on the host', async () => {
    const g = graph();
    await writeExternalHostData(g as any, 'ssh:myhost', 'myhost', { plugins: [] }, NOW);
    expect(graphDeletes.some(([sql]) => /DELETE FROM plugins/i.test(sql))).toBe(true);
  });
});
```

- [ ] **Step 2: Run and verify they fail**

Run: `npx jest tests/unit/startup/writeExternalHostData.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement**

```ts
// src/main/startup/writeExternalHostData.ts
import type { ExternalHostData } from './collectExternalHostData';

export type GraphWriter = {
  upsertSite(site: Record<string, unknown>): Promise<unknown>;
  upsertPlugin(plugin: Record<string, unknown>): Promise<unknown>;
  upsertTheme(theme: Record<string, unknown>): Promise<unknown>;
  getDb?: () => any;
};

/**
 * Persist collected L1+L2 data for one external host.
 *
 * THE HONESTY RULE, which this file exists to enforce:
 * a field absent from `data` is NOT WRITTEN. It does not become NULL, 0, false
 * or a default — the column keeps whatever the last successful cycle put there.
 * An unreachable host must never look like a host with no plugins and no PHP.
 *
 * php_version in particular must never fall back to '8.0'. That fabrication was
 * removed from the health-scoring path and this writer is the other door it
 * could come back through.
 */
export async function writeExternalHostData(
  graphService: GraphWriter,
  siteId: string,
  alias: string,
  data: ExternalHostData,
  now: number,
): Promise<void> {
  const collectedAnything = Object.keys(data).length > 0;
  if (!collectedAnything) {
    // Unreachable or wholly unparseable. Do not stamp ssh_last_sync_at — doing so
    // would suppress the retry until the next staleness window elapses.
    return;
  }

  // Preserve a real domain. A sighting-era row may still carry the alias; only
  // replace it when we have something better, never the other way round.
  let domain: string | undefined;
  try {
    const db = graphService.getDb?.();
    const existing = db?.prepare('SELECT domain FROM sites WHERE id=?').get(siteId) as
      { domain?: string } | undefined;
    if (existing?.domain && existing.domain !== alias) domain = existing.domain;
  } catch { /* graph not ready — omit domain rather than guess */ }
  if (data.siteUrl) {
    try {
      const host = new URL(data.siteUrl).hostname;
      if (host) domain = host;
    } catch { /* not a URL — keep whatever we had */ }
  }

  const row: Record<string, unknown> = {
    id: siteId,
    name: alias,
    source: 'external',
    host: 'external',
    is_active: true,
    updated_at: now,
    ssh_last_sync_at: now,
  };
  if (domain !== undefined) row.domain = domain;
  if (data.wpVersion !== undefined) row.wp_version = data.wpVersion;
  if (data.phpVersion !== undefined) row.php_version = data.phpVersion;
  if (data.siteUrl !== undefined) row.site_url = data.siteUrl;
  if (data.adminEmail !== undefined) row.admin_email = data.adminEmail;
  if (data.activeTheme !== undefined) row.active_theme = data.activeTheme;
  if (data.settingsJson !== undefined) row.settings_json = data.settingsJson;
  if (data.postCount !== undefined) row.post_count = data.postCount;
  if (data.lastPostAt !== undefined) row.last_post_at = data.lastPostAt;
  if (data.userCount !== undefined) row.user_count = data.userCount;
  if (data.postCountPosts !== undefined) {
    row.post_count_by_type = JSON.stringify({ post: data.postCountPosts });
  }
  if (data.adminCount !== undefined || data.editorCount !== undefined) {
    const byRole: Record<string, number> = {};
    if (data.adminCount !== undefined) byRole.administrator = data.adminCount;
    if (data.editorCount !== undefined) byRole.editor = data.editorCount;
    row.user_count_by_role = JSON.stringify(byRole);
  }

  await graphService.upsertSite(row);

  // Inventories replace the previous set ONLY when this cycle collected one.
  // `undefined` means the batch failed; `[]` means the host really has none.
  const db = graphService.getDb?.();
  if (data.plugins !== undefined) {
    try { db?.prepare('DELETE FROM plugins WHERE site_id=?').run(siteId); } catch { /* keep going */ }
    for (const p of data.plugins) {
      await graphService.upsertPlugin({
        site_id: siteId, slug: p.slug, name: p.name, version: p.version,
        is_active: p.isActive, author: null, created_at: now, updated_at: now,
      });
    }
  }
  if (data.themes !== undefined) {
    try { db?.prepare('DELETE FROM themes WHERE site_id=?').run(siteId); } catch { /* keep going */ }
    for (const t of data.themes) {
      await graphService.upsertTheme({
        site_id: siteId, slug: t.slug, name: t.name, version: t.version,
        is_active: t.isActive, author: null, created_at: now, updated_at: now,
      });
    }
  }
}
```

- [ ] **Step 4: Run tests**

Run: `npx jest tests/unit/startup/ && npx tsc --noEmit`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/main/startup/writeExternalHostData.ts tests/unit/startup/writeExternalHostData.test.ts
git commit -m "feat(external): write collected host data, never fabricating a missing value"
```

---

### Task 4: The scheduler

**Files:**
- Create: `src/main/startup/ExternalRefreshScheduler.ts`
- Test: `tests/unit/startup/ExternalRefreshScheduler.test.ts` *(create)*

**Interfaces:**
- Consumes: `collectExternalHostData`, `writeExternalHostData`, `resolveTransport(args, services, operation)`.
- Produces:
  - `class ExternalRefreshScheduler` with `start()`, `stop()`, `restart(intervalMs: number)`, `runCycleNow(): Promise<ExternalRefreshResult>`
  - `interface ExternalRefreshResult { scanned: number; skipped: number; failed: number }`

**Selection SQL** — `is_active = 1` is load-bearing, because `nexusHostRemove` soft-deletes and a removed host must never be connected to again:

```sql
SELECT id, name, environment, ssh_last_sync_at
FROM sites
WHERE source = 'external' AND is_active = 1
```

Staleness is filtered in JS: include when `ssh_last_sync_at` is null or `now - ssh_last_sync_at > stalenessThresholdMs`.

**Concurrency:** `p-limit` (already a dependency) with a cap of **3**. Unlike WP Engine's cap of 5, this bounds local resource use, not a remote connection limit — these are unrelated servers.

**Transport:** `resolveTransport({ ssh_target: \`ssh:${alias}@${environment}\` }, services, 'wpcli_read')`. A result with a `content` key is a refusal or error — count it as `skipped`, log at info, and move on. Do not treat a permission refusal as a failure.

- [ ] **Step 1: Write the failing tests**

```ts
// tests/unit/startup/ExternalRefreshScheduler.test.ts
import { ExternalRefreshScheduler } from '../../../src/main/startup/ExternalRefreshScheduler';

jest.mock('../../../src/main/transport', () => ({ resolveTransport: jest.fn() }));
import { resolveTransport } from '../../../src/main/transport';

const logger = { info: jest.fn(), warn: jest.fn(), error: jest.fn() };
const NOW = 1_800_000_000_000;

function graph(rows: any[]) {
  return {
    getDb: () => ({ prepare: () => ({ all: () => rows, get: () => undefined, run: () => {} }) }),
    upsertSite: jest.fn(async () => {}),
    upsertPlugin: jest.fn(async () => {}),
    upsertTheme: jest.fn(async () => {}),
  };
}
function okTransport() {
  return {
    kind: 'external-ssh',
    siteRef: { kind: 'external', alias: 'a' },
    runWpCliBatch: jest.fn(async (c: string[][]) => new Array(c.length).fill(null)),
  };
}

beforeEach(() => { jest.clearAllMocks(); jest.spyOn(Date, 'now').mockReturnValue(NOW); });
afterEach(() => { jest.restoreAllMocks(); });

describe('ExternalRefreshScheduler', () => {
  it('skips hosts that are not active — a removed host is never reconnected to', async () => {
    const g = graph([{ id: 'ssh:gone', name: 'gone', environment: 'production', ssh_last_sync_at: null, is_active: 0 }]);
    // The SQL filters is_active, so an inactive row must not even be returned;
    // assert the query text carries the filter.
    let captured = '';
    (g as any).getDb = () => ({ prepare: (sql: string) => { captured = sql; return { all: () => [], get: () => undefined, run: () => {} }; } });
    const s = new ExternalRefreshScheduler({ graphService: g as any, services: {} as any, logger });
    await s.runCycleNow();
    expect(captured).toMatch(/is_active\s*=\s*1/);
  });

  it('skips a host synced more recently than the staleness threshold', async () => {
    const g = graph([{ id: 'ssh:fresh', name: 'fresh', environment: 'production', ssh_last_sync_at: NOW - 1000 }]);
    const s = new ExternalRefreshScheduler({
      graphService: g as any, services: {} as any, logger, stalenessThresholdMs: 60_000,
    });
    const r = await s.runCycleNow();
    expect(r.skipped).toBe(1);
    expect(resolveTransport).not.toHaveBeenCalled();
  });

  it('includes a host that has never been synced', async () => {
    const g = graph([{ id: 'ssh:new', name: 'new', environment: 'production', ssh_last_sync_at: null }]);
    (resolveTransport as jest.Mock).mockResolvedValue(okTransport());
    const s = new ExternalRefreshScheduler({ graphService: g as any, services: {} as any, logger });
    const r = await s.runCycleNow();
    expect(r.scanned).toBe(1);
  });

  it('counts a permission refusal as skipped, not failed', async () => {
    const g = graph([{ id: 'ssh:denied', name: 'denied', environment: 'production', ssh_last_sync_at: null }]);
    (resolveTransport as jest.Mock).mockResolvedValue({ content: [{ type: 'text', text: 'Operation blocked' }] });
    const s = new ExternalRefreshScheduler({ graphService: g as any, services: {} as any, logger });
    const r = await s.runCycleNow();
    expect(r.skipped).toBe(1);
    expect(r.failed).toBe(0);
  });

  it('one host throwing does not abort the cycle', async () => {
    const g = graph([
      { id: 'ssh:bad',  name: 'bad',  environment: 'production', ssh_last_sync_at: null },
      { id: 'ssh:good', name: 'good', environment: 'production', ssh_last_sync_at: null },
    ]);
    (resolveTransport as jest.Mock)
      .mockRejectedValueOnce(new Error('boom'))
      .mockResolvedValueOnce(okTransport());
    const s = new ExternalRefreshScheduler({ graphService: g as any, services: {} as any, logger });
    const r = await s.runCycleNow();
    expect(r.failed).toBe(1);
    expect(r.scanned).toBe(1);
  });

  it('addresses the host with its registered environment', async () => {
    const g = graph([{ id: 'ssh:stg', name: 'stg', environment: 'staging', ssh_last_sync_at: null }]);
    (resolveTransport as jest.Mock).mockResolvedValue(okTransport());
    const s = new ExternalRefreshScheduler({ graphService: g as any, services: {} as any, logger });
    await s.runCycleNow();
    expect(resolveTransport).toHaveBeenCalledWith(
      { ssh_target: 'ssh:stg@staging' }, expect.anything(), 'wpcli_read');
  });

  it('start() is idempotent', () => {
    const s = new ExternalRefreshScheduler({ graphService: graph([]) as any, services: {} as any, logger });
    s.start(); s.start();
    expect(logger.info).toHaveBeenCalledWith(expect.stringContaining('Already running'));
    s.stop();
  });

  it('tolerates getDb() returning null during startup', async () => {
    const g = { getDb: () => null, upsertSite: jest.fn(), upsertPlugin: jest.fn(), upsertTheme: jest.fn() };
    const s = new ExternalRefreshScheduler({ graphService: g as any, services: {} as any, logger });
    await expect(s.runCycleNow()).resolves.toEqual({ scanned: 0, skipped: 0, failed: 0 });
  });
});
```

- [ ] **Step 2: Run and verify they fail**

Run: `npx jest tests/unit/startup/ExternalRefreshScheduler.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement**

```ts
// src/main/startup/ExternalRefreshScheduler.ts
import pLimit from 'p-limit';
import { resolveTransport } from '../transport';
import { collectExternalHostData, type BatchRunner } from './collectExternalHostData';
import { writeExternalHostData, type GraphWriter } from './writeExternalHostData';

export interface ExternalRefreshSchedulerOptions {
  graphService: GraphWriter & { getDb?: () => any };
  /** Passed straight to resolveTransport; the scheduler never inspects it. */
  services: any;
  intervalMs?: number;
  /** Skip a host synced more recently than this. Default: same as intervalMs. */
  stalenessThresholdMs?: number;
  logger: { info: (...a: any[]) => void; warn: (...a: any[]) => void; error: (...a: any[]) => void };
}

export interface ExternalRefreshResult {
  scanned: number;
  skipped: number;
  failed: number;
}

const DEFAULT_INTERVAL_MS = 24 * 60 * 60 * 1000;
/** Unrelated servers, so this bounds LOCAL resource use — not a remote limit as WPE's 5 does. */
const CONCURRENCY = 3;

/**
 * Refresh L1+L2 metadata for registered external SSH hosts on an interval.
 *
 * Mirrors WpeRefreshScheduler, with two deliberate differences:
 *  - routes through resolveTransport (the one router) rather than WP Engine's
 *    SSH bridge, so target resolution and command policy stay in one place;
 *  - collects in four batched round trips because external SSH has no
 *    ControlMaster. See buildExternalWpCliBatch.
 *
 * Opt-in: index.ts only starts it when externalRefreshAutoEnabled is true.
 * Nexus does not connect to a third party's server on a timer unless asked.
 */
export class ExternalRefreshScheduler {
  private readonly graphService: ExternalRefreshSchedulerOptions['graphService'];
  private readonly services: any;
  private readonly logger: ExternalRefreshSchedulerOptions['logger'];
  private currentIntervalMs: number;
  private currentStalenessThresholdMs: number;
  private timer: ReturnType<typeof setInterval> | null = null;

  constructor(options: ExternalRefreshSchedulerOptions) {
    this.graphService = options.graphService;
    this.services = options.services;
    this.logger = options.logger;
    this.currentIntervalMs = options.intervalMs ?? DEFAULT_INTERVAL_MS;
    this.currentStalenessThresholdMs = options.stalenessThresholdMs ?? this.currentIntervalMs;
  }

  /** Idempotent — a second call while running is a no-op. */
  start(): void {
    if (this.timer !== null) {
      this.logger.info('[ExternalRefreshScheduler] Already running — start() ignored');
      return;
    }
    this.timer = setInterval(() => {
      this.runCycleNow().catch((err) =>
        this.logger.error('[ExternalRefreshScheduler] Cycle failed:', err?.message ?? err));
    }, this.currentIntervalMs);
    this.logger.info(
      `[ExternalRefreshScheduler] Started (every ${Math.round(this.currentIntervalMs / 3600000)}h)`);
  }

  stop(): void {
    if (this.timer !== null) {
      clearInterval(this.timer);
      this.timer = null;
      this.logger.info('[ExternalRefreshScheduler] Stopped');
    }
  }

  restart(intervalMs: number): void {
    this.currentIntervalMs = intervalMs;
    this.currentStalenessThresholdMs = intervalMs;
    this.stop();
    this.start();
  }

  /**
   * Run one cycle across all stale external hosts. Never throws: a host that
   * fails is counted and logged, and the rest of the cycle continues.
   */
  async runCycleNow(): Promise<ExternalRefreshResult> {
    const result: ExternalRefreshResult = { scanned: 0, skipped: 0, failed: 0 };
    const now = Date.now();

    let rows: Array<{ id: string; name: string; environment: string | null; ssh_last_sync_at: number | null }>;
    try {
      const db = this.graphService.getDb?.();
      if (!db) return result;   // startup race — try again next cycle
      rows = db.prepare(
        `SELECT id, name, environment, ssh_last_sync_at
         FROM sites
         WHERE source = 'external' AND is_active = 1`
      ).all();
    } catch (err: any) {
      this.logger.warn('[ExternalRefreshScheduler] Could not read hosts:', err?.message ?? err);
      return result;
    }

    const due = rows.filter((r) => {
      const fresh = r.ssh_last_sync_at != null
        && (now - r.ssh_last_sync_at) <= this.currentStalenessThresholdMs;
      if (fresh) result.skipped++;
      return !fresh;
    });

    const limit = pLimit(CONCURRENCY);
    await Promise.all(due.map((row) => limit(async () => {
      try {
        const target = `ssh:${row.name}@${row.environment ?? 'production'}`;
        const transport = await resolveTransport({ ssh_target: target }, this.services, 'wpcli_read');

        // A `content` key means refused or unresolvable. A permission refusal is
        // a skip, not a failure — the user configured it that way on purpose.
        if (transport && typeof transport === 'object' && 'content' in transport) {
          this.logger.info(`[ExternalRefreshScheduler] ${row.name}: skipped (${
            (transport as any).content?.[0]?.text ?? 'not resolvable'})`);
          result.skipped++;
          return;
        }

        const data = await collectExternalHostData(transport as unknown as BatchRunner, this.logger);
        await writeExternalHostData(this.graphService, row.id, row.name, data, Date.now());
        result.scanned++;
      } catch (err: any) {
        this.logger.warn(`[ExternalRefreshScheduler] ${row.name} failed:`, err?.message ?? err);
        result.failed++;
      }
    })));

    this.logger.info(
      `[ExternalRefreshScheduler] Cycle done — scanned ${result.scanned}, `
      + `skipped ${result.skipped}, failed ${result.failed}`);
    return result;
  }
}
```

- [ ] **Step 4: Run tests**

Run: `npx jest tests/unit/startup/ && npx tsc --noEmit`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/main/startup/ExternalRefreshScheduler.ts tests/unit/startup/ExternalRefreshScheduler.test.ts
git commit -m "feat(external): opt-in scheduler refreshing external host metadata"
```

---

### Task 5: Settings and wiring

**Files:**
- Modify: `src/common/types.ts:349` (after `wpeRefreshAutoEnabled`)
- Modify: `src/common/schemas.ts:69` (after `wpeRefreshAutoEnabled`)
- Modify: `src/main/index.ts` — construct near `:839`, declare near `:456`, react near `:1013`
- Test: `tests/unit/common/settings-schema.test.ts` *(extend, or create if absent)*

**Interfaces:**
- Consumes: `ExternalRefreshScheduler` from Task 4.
- Produces: settings keys `externalRefreshAutoEnabled: boolean` (default `false`) and `externalRefreshIntervalHours: number` (default `24`).

**`UpdateSettingsSchema` is `.strict()`.** A key missing from it is silently stripped on save, so the setting appears to work in the UI and never persists. This project has shipped that bug before; the schema edit is not optional.

- [ ] **Step 1: Write the failing test**

```ts
// tests/unit/common/settings-schema.test.ts
import { UpdateSettingsSchema } from '../../../src/common/schemas';

describe('external refresh settings survive the strict schema', () => {
  it('accepts both keys', () => {
    const parsed = UpdateSettingsSchema.parse({
      externalRefreshAutoEnabled: true,
      externalRefreshIntervalHours: 12,
    });
    expect(parsed.externalRefreshAutoEnabled).toBe(true);
    expect(parsed.externalRefreshIntervalHours).toBe(12);
  });

  it('rejects an out-of-range interval', () => {
    expect(() => UpdateSettingsSchema.parse({ externalRefreshIntervalHours: 0 })).toThrow();
    expect(() => UpdateSettingsSchema.parse({ externalRefreshIntervalHours: 999 })).toThrow();
  });
});
```

- [ ] **Step 2: Run and verify it fails**

Run: `npx jest tests/unit/common/settings-schema.test.ts`
Expected: FAIL — strict schema rejects the unknown keys.

- [ ] **Step 3: Add the settings**

`src/common/schemas.ts`, after line 69:

```ts
  externalRefreshIntervalHours: z.number().int().min(1).max(168).optional(),
  externalRefreshAutoEnabled: z.boolean().optional(),
```

`src/common/types.ts`, after line 349:

```ts
  externalRefreshIntervalHours?: number;    // How often to refresh external SSH hosts (default: 24)
  externalRefreshAutoEnabled?: boolean;     // Whether external SSH host refresh is enabled (default: false — opt-in)
```

- [ ] **Step 4: Wire it into the main process**

In `src/main/index.ts`, beside the existing scheduler declarations (~`:456`):

```ts
  let externalRefreshScheduler: ExternalRefreshScheduler;
```

Import it beside the others (~`:54`):

```ts
import { ExternalRefreshScheduler } from './startup/ExternalRefreshScheduler';
```

After the `wpeRefreshScheduler` construction block (~`:851`):

```ts
      const externalRefreshSettings = registryStorage.get(STORAGE_KEYS.SETTINGS) as
        { externalRefreshIntervalHours?: number; externalRefreshAutoEnabled?: boolean } | null;
      const externalRefreshHours = externalRefreshSettings?.externalRefreshIntervalHours ?? 24;
      const externalRefreshEnabled = externalRefreshSettings?.externalRefreshAutoEnabled === true; // opt-in
      externalRefreshScheduler = new ExternalRefreshScheduler({
        graphService,
        services: nexusServices,
        intervalMs: externalRefreshHours * 60 * 60 * 1000,
        logger: localLogger,
      });
      if (externalRefreshEnabled) {
        externalRefreshScheduler.start();
      }
```

In the `onSettingsUpdated` block, after the WPE refresh stanza (~`:1020`):

```ts
      // Restart (or stop) the external SSH host refresh scheduler.
      const updatedExternal = registryStorage.get(STORAGE_KEYS.SETTINGS) as
        { externalRefreshIntervalHours?: number; externalRefreshAutoEnabled?: boolean } | null;
      const newExternalHours = updatedExternal?.externalRefreshIntervalHours ?? 24;
      if (updatedExternal?.externalRefreshAutoEnabled === true) {
        externalRefreshScheduler.restart(newExternalHours * 60 * 60 * 1000);
      } else {
        externalRefreshScheduler.stop();
      }
```

Use whatever the surrounding lines call the graph service and logger — read the neighbouring `wpeRefreshScheduler` block and match it rather than assuming these names.

- [ ] **Step 5: Run tests and build**

Run: `npx jest tests/unit/common/ && npx tsc --noEmit && npm run build`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/common/types.ts src/common/schemas.ts src/main/index.ts tests/unit/common/settings-schema.test.ts
git commit -m "feat(settings): opt-in external refresh interval, wired reactively"
```

---

### Task 6: `nexus host refresh <alias>`

**Files:**
- Modify: `src/cli/commands/host.ts` (add after the `remove` command, ~`:292`)
- Modify: `src/main/graphql/schema.ts` (add mutation beside the other host mutations)
- Modify: `src/main/graphql/resolvers.ts` (add resolver beside `nexusHostRemove`, ~`:5385`)
- Test: `tests/unit/graphql/host-refresh.test.ts` *(create)*

**Interfaces:**
- Consumes: `ExternalRefreshScheduler.runCycleNow()` — but for a single host, the resolver calls `collectExternalHostData` + `writeExternalHostData` directly through `resolveTransport`, so it works whether or not the scheduler is enabled.
- Produces: GraphQL `nexusHostRefresh(alias: String!): NexusHostRefreshResult!` with
  `{ success: Boolean!, error: String, wpVersion: String, phpVersion: String, pluginCount: Int, themeCount: Int }`.

**This is a read-only operation** — it collects and writes to the *local* graph, never to the remote host. Do not audit it.

- [ ] **Step 1: Write the failing test**

```ts
// tests/unit/graphql/host-refresh.test.ts
import { createResolvers } from '../../../src/main/graphql/resolvers';

// Follow the harness used by tests/unit/fleet/fleet-visibility.test.ts for ctx().
describe('nexusHostRefresh', () => {
  it('refuses an alias that is not a registered external host', async () => {
    const r = await (createResolvers(ctx()).Mutation as any).nexusHostRefresh(null, { alias: 'nope' });
    expect(r.success).toBe(false);
    expect(r.error).toMatch(/not a registered external host/i);
  });

  it('reports what it collected on success', async () => {
    // seed an external row for alias 'myhost' and stub the transport to answer
    const r = await (createResolvers(ctx()).Mutation as any).nexusHostRefresh(null, { alias: 'myhost' });
    expect(r.success).toBe(true);
    expect(r.wpVersion).toBe('6.8.0');
  });

  it('surfaces a permission refusal as an error rather than a silent success', async () => {
    const r = await (createResolvers(ctx()).Mutation as any).nexusHostRefresh(null, { alias: 'denied' });
    expect(r.success).toBe(false);
    expect(r.error).toBeTruthy();
  });
});
```

- [ ] **Step 2: Run and verify it fails**

Run: `npx jest tests/unit/graphql/host-refresh.test.ts`
Expected: FAIL — `nexusHostRefresh is not a function`.

- [ ] **Step 3: Add the schema type and mutation**

In `src/main/graphql/schema.ts`, beside the other host mutations:

```graphql
  "Result of refreshing one external SSH host's metadata."
  type NexusHostRefreshResult {
    success: Boolean!
    error: String
    "WordPress version collected, null when it could not be read."
    wpVersion: String
    "PHP version from `wp --info`, null when it could not be read."
    phpVersion: String
    "Plugins found, null when the plugin batch failed."
    pluginCount: Int
    "Themes found, null when the theme batch failed."
    themeCount: Int
  }
```

and in the `extend type Mutation` block:

```graphql
    nexusHostRefresh(alias: String!): NexusHostRefreshResult!
```

- [ ] **Step 4: Add the resolver**

In `src/main/graphql/resolvers.ts`, beside `nexusHostRemove`:

```ts
      nexusHostRefresh: async (_parent: ResolverParent, { alias }: { alias: string }) => {
        try {
          const db = services.graphService?.getDb?.();
          const row = db?.prepare(
            "SELECT id, name, environment FROM sites WHERE source='external' AND is_active=1 AND LOWER(name)=?"
          ).get(alias.toLowerCase()) as { id: string; name: string; environment: string | null } | undefined;
          if (!row) {
            return { success: false, error: `"${alias}" is not a registered external host. Run \`nexus host add ${alias}\` first.` };
          }

          const target = `ssh:${row.name}@${row.environment ?? 'production'}`;
          const transport = await resolveTransport({ ssh_target: target }, services, 'wpcli_read');
          if (transport && typeof transport === 'object' && 'content' in transport) {
            return { success: false, error: (transport as any).content?.[0]?.text ?? 'Could not reach host' };
          }

          const data = await collectExternalHostData(transport as any, console);
          await writeExternalHostData(services.graphService as any, row.id, row.name, data, Date.now());

          return {
            success: true,
            wpVersion: data.wpVersion ?? null,
            phpVersion: data.phpVersion ?? null,
            pluginCount: data.plugins?.length ?? null,
            themeCount: data.themes?.length ?? null,
          };
        } catch (error: any) {
          return { success: false, error: error.message };
        }
      },
```

Import `collectExternalHostData` and `writeExternalHostData` at the top of the file.

- [ ] **Step 5: Add the CLI command**

In `src/cli/commands/host.ts`, after the `remove` command:

```ts
hostCommand
  .command('refresh <alias>')
  .description('Collect WordPress metadata from a registered external host now')
  .action(async (alias: string) => {
    try {
      const client = getClient();
      const result = await client.mutate<{ nexusHostRefresh: any }>(`
        mutation($alias: String!) {
          nexusHostRefresh(alias: $alias) {
            success error wpVersion phpVersion pluginCount themeCount
          }
        }
      `, { alias });

      const { success, error, wpVersion, phpVersion, pluginCount, themeCount } = result.nexusHostRefresh;
      if (!success) {
        console.error(`\n❌ ${error}`);
        process.exit(1);
      }
      console.log(`\n✅ Refreshed ${alias}`);
      console.log(`   WordPress:  ${wpVersion ?? 'unknown'}`);
      console.log(`   PHP:        ${phpVersion ?? 'unknown'}`);
      console.log(`   Plugins:    ${pluginCount ?? 'not collected'}`);
      console.log(`   Themes:     ${themeCount ?? 'not collected'}`);
      console.log('');
    } catch (error: any) {
      console.error(`Error: ${error.message}`);
      process.exit(1);
    }
  });
```

Note `?? 'unknown'` and `?? 'not collected'` rather than `?? 0` — the whole point is that missing and zero are different.

- [ ] **Step 6: Run tests**

Run: `npx jest tests/unit/graphql/ && npx tsc --noEmit && npm run build`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add src/cli/commands/host.ts src/main/graphql/schema.ts src/main/graphql/resolvers.ts tests/unit/graphql/host-refresh.test.ts
git commit -m "feat(cli): nexus host refresh <alias>"
```

---

### Task 7: Data Completeness counts external, and health scoring becomes conditional

**Files:**
- Modify: `src/main/ipc-handlers.ts:1794` (`FLEET_COMPLETENESS`)
- Modify: `src/main/graphql/resolvers.ts` (`nexusFleetSiteHealth`, the external branch)
- Test: `tests/unit/fleet/fleet-visibility.test.ts` *(extend)*

**Interfaces:**
- Consumes: nothing new.
- Produces: no new exports; behaviour changes only.

**Data Completeness.** The handler counts `source='local'` and `source='wpe'` and nothing else, so a registered external host is absent from the denominator entirely. Add external to all three rows. Searchable will read 0 for external hosts until Spec 4b — that is correct and must not be papered over.

**Health scoring.** `nexusFleetSiteHealth` currently declines to score any external host outright, because before this plan they had no plugins, no PHP version and no `site_url`. That becomes conditional:

- host has plugin rows **and** a `php_version` → score it on `['security','performance']`, the same subset a WP Engine target gets
- otherwise → keep returning `score: null` with the existing "not enough data to score" message

`stability` stays excluded for every remote target: it counts `event_queue` rows, and only the Local MU-plugin webhook writes those.

- [ ] **Step 1: Write the failing tests**

```ts
it('Data Completeness counts external hosts in all three rows', async () => {
  // seed 1 local, 1 wpe, 1 external — all active, all with wp_version
  const r = await invokeFleetCompleteness(ctx());
  expect(r.scanned.total).toBe(3);
  expect(r.configured.total).toBe(3);
  expect(r.searchable.total).toBe(3);   // denominator includes external
  expect(r.searchable.count).toBe(0);   // none indexed — honest, not hidden
});

it('scores an external host once it has plugins and a PHP version', async () => {
  // seed external row with php_version '8.2.0' and two plugin rows
  const r = await (createResolvers(ctx()).Mutation as any)
    .nexusFleetSiteHealth(null, { target: 'ssh:myhost@production' });
  expect(r.health.score).not.toBeNull();
  expect(r.health.factorsEvaluated).toEqual(['security', 'performance']);
});

it('still declines to score an external host with no data', async () => {
  const r = await (createResolvers(ctx()).Mutation as any)
    .nexusFleetSiteHealth(null, { target: 'ssh:bare@production' });
  expect(r.health.score).toBeNull();
  expect(r.health.status).toBeNull();
});

it('never evaluates stability for an external host', async () => {
  const r = await (createResolvers(ctx()).Mutation as any)
    .nexusFleetSiteHealth(null, { target: 'ssh:myhost@production' });
  expect(r.health.factorsEvaluated).not.toContain('stability');
});
```

- [ ] **Step 2: Run and verify they fail**

Run: `npx jest tests/unit/fleet/fleet-visibility.test.ts`
Expected: FAIL — external absent from completeness totals; external score still null.

- [ ] **Step 3: Implement both changes**

In `FLEET_COMPLETENESS`, add a third block mirroring the WPE one:

```ts
      // External SSH hosts. Same shape as the WPE block: Configured means the
      // graph has a wp_version, Searchable means an IndexRegistry entry exists.
      // Until Spec 4b there is no external content indexing, so searchable will
      // read 0 — that is the true number, not a gap to hide.
      let externalTotal = 0, externalConfigured = 0, externalSearchable = 0;
      if (db) {
        const externalSites = db.prepare(
          "SELECT id, wp_version FROM sites WHERE source = 'external' AND is_active = 1"
        ).all() as Array<{ id: string; wp_version: string | null }>;
        externalTotal = externalSites.length;
        for (const site of externalSites) {
          if (site.wp_version) externalConfigured++;
          if (indexedSet.has(site.id)) externalSearchable++;
        }
      }
```

Add those three into the totals the handler returns, matching how the local and WPE numbers are combined.

In `nexusFleetSiteHealth`'s external branch, replace the unconditional decline:

```ts
        // External hosts are scoreable only once a refresh has given them real
        // data. Before that, security and performance would be computed from an
        // empty plugin list and a missing PHP version — a confident score built
        // on absence. `nexus host refresh <alias>` populates it.
        const hasPlugins = (db.prepare(
          'SELECT COUNT(*) as c FROM plugins WHERE site_id = ?'
        ).get(row.id) as { c: number }).c > 0;
        const scoreable = hasPlugins && !!row.php_version;
        if (!scoreable) {
          return {
            success: true,
            health: {
              score: null,
              status: null,
              factorsEvaluated: [],
              issues: [],
              plugins: null,
              themes: null,
              wordpress: { version: row.wp_version ?? 'unknown', updateAvailable: null },
            },
          };
        }
        factorsToEvaluate = ['security', 'performance'];
```

Match the surrounding code's variable names rather than these placeholders — read the branch before editing it.

- [ ] **Step 4: Run tests**

Run: `npx jest tests/unit/fleet/ tests/unit/graphql/ && npx tsc --noEmit && npm run build`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/main/ipc-handlers.ts src/main/graphql/resolvers.ts tests/unit/fleet/fleet-visibility.test.ts
git commit -m "feat(fleet): count external hosts in completeness, score them once they have data"
```

---

### Task 8: Documentation and live verification

**Files:**
- Modify: `CLAUDE.md` (the "Fleet counts" subsection added by the previous plan)
- Modify: `docs/user-guide.md` (external host section)

**No new behaviour in this task.** If the live check surfaces a defect, **report it — do not fix it here.**

- [ ] **Step 1: Document the refresh in CLAUDE.md**

Add to the fleet-counts subsection:

```markdown
**External hosts refresh on an opt-in timer.** `ExternalRefreshScheduler`
(`src/main/startup/ExternalRefreshScheduler.ts`) collects the same L1+L2 set
`WpeRefreshScheduler` does, gated on `externalRefreshAutoEnabled` (**default
false**) with `externalRefreshIntervalHours` (default 24). `nexus host refresh
<alias>` runs one host on demand regardless of the setting.

It collects in **four batched SSH round trips**, not sixteen calls:
`buildExternalWpCliBatch` joins commands with indexed `<<<NEXUS:N>>>`
delimiters. This exists because `buildExternalSshArgs` sets no `ControlMaster`
and must not — shared hosting commonly caps `MaxSessions`, a command-line `-o`
overrides the user's own `~/.ssh/config`, and `ControlPersist` would hold a
socket open to a third party's production server. A batch's exit code is only
its last sub-command's, so **nothing may gate on it** — the indexed parse is the
source of truth.

`php_version` comes from `wp --info` (JSON first, `PHP version:` line as
fallback), because WP Engine's CAPI has no external equivalent and `wp eval` is
blocked by `REMOTE_POLICY`.

**Anything that did not parse is written NULL, never a default**, and a host
that failed keeps its previous data — `writeExternalHostData` enforces both.
`php_version` must never fall back to `'8.0'`.

Selection filters `is_active = 1`, because `nexusHostRemove` soft-deletes and a
removed host must never be reconnected to.

**L3 (content indexing) is not implemented for external hosts** — Spec 4b. They
show 0% Searchable in Data Completeness, which is the true number.
```

- [ ] **Step 2: Document the CLI command in the user guide**

Add `nexus host refresh <alias>` beside `add` / `test` / `list` / `remove`, noting that it is read-only, that it never writes to the remote server, and that plugin data appears only after the first refresh.

- [ ] **Step 3: Full suite**

```bash
npm test 2>&1 | grep -E "^(FAIL|Tests:|Test Suites:)" | sort | uniq
npx tsc --noEmit && npm run build
```

Baseline: **12 failing suites, 22 failures, 3576 passing.** Compare failing suite **names**.

- [ ] **Step 4: Live verification**

```bash
npm run rebuild && ./dev-reload.sh
node bin/nexus.js host refresh hostinger-test
node bin/nexus.js fleet site-health ssh:hostinger-test@production
node bin/nexus.js sites get hostinger-test
node bin/nexus.js fleet health
```

Paste the verbatim output into the report. Expected:

- `host refresh` reports a WordPress version, a PHP version, and non-null plugin and theme counts
- `fleet site-health` now returns a **real score** naming `security/performance`, instead of "not enough data to score"
- `fleet health` plugin and theme totals rise, and the coverage line's numerator increases by one
- Data Completeness counts the host

Confirm against the database that the honesty rule held:

```bash
sqlite3 "$HOME/Library/Application Support/Local/nexus-ai/graph.db" \
  "SELECT name, wp_version, php_version, substr(site_url,1,40), user_count, post_count FROM sites WHERE source='external';
   SELECT COUNT(*) FROM plugins WHERE site_id LIKE 'ssh:%';
   SELECT COUNT(*) FROM themes  WHERE site_id LIKE 'ssh:%';"
```

**`php_version` must be a real version or empty — never `8.0` unless the host genuinely runs 8.0.** If it reads exactly `8.0`, check whether it was collected or defaulted before reporting success.

Leave the repo rebuilt for Electron and say so, so the next person knows to run `npm rebuild better-sqlite3` before jest.

- [ ] **Step 5: Commit**

```bash
git add CLAUDE.md docs/user-guide.md
git commit -m "docs(external): opt-in metadata refresh, batching rationale, and the honesty rule"
```

---

## Self-Review

**Spec coverage.** §4 Component → Task 4. §5 Transport → Task 4. §6 Collection/batching → Tasks 1–2. §7 Storage + honesty rule → Task 3. §8 Settings → Task 5. §9 Surfaces: Data Completeness and health scoring → Task 7, `nexus host refresh` → Task 6. §10 Constraints → Global Constraints, restated per task. §11 Error handling → Tasks 3 and 4. §12 Testing → each task's tests plus Task 8's live check. No gaps.

**Placeholders.** None. Every code step carries the actual code. Two steps say "match the surrounding names rather than assuming" (Task 5's index.ts wiring, Task 7's health branch) — that is a deliberate instruction to read neighbouring code, not a deferred decision, and both name the exact file and line to read.

**Type consistency.** `ExternalHostData` is defined in Task 2 and consumed unchanged in Tasks 3 and 6. `BatchRunner` is defined in Task 2 and used in Task 4. `GraphWriter` is defined in Task 3 and used in Task 4. `runWpCliBatch(commands: string[][]): Promise<(string | null)[]>` has the same signature in Tasks 1, 2 and 4. `ExternalRefreshResult` is defined and used only in Task 4. Field names (`phpVersion` → `php_version`, `postCountPosts` → `post_count_by_type`) are mapped explicitly in Task 3's implementation.

**One risk worth naming.** Task 2's tests index scalar sections by position (`scalars[5]` is `blogname`), so reordering `SETTINGS_OPTIONS` or the scalar command list breaks them. That is intentional — the coupling is real, and a test that survives a reordering would not be testing the mapping.
