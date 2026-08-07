import { LocalFileSource } from './LocalFileSource';
import { resolveScanRoot, SiteLike } from './resolveScanRoot';
import { checkMuPlugins, MuPluginResult } from './checks/muPlugins';
import { scanFilesystem, FilesystemScanResult } from './checks/filesystem';
import { scanDirectiveFiles, DirectiveScanResult } from './checks/directives';
import { checkDatabase, DatabaseCheckResult } from './checks/database';
import { resolveDbSource } from './db/resolveDbSource';

export { LocalFileSource } from './LocalFileSource';
export { resolveScanRoot } from './resolveScanRoot';
export { checkMuPlugins } from './checks/muPlugins';
export { scanFilesystem } from './checks/filesystem';
export { scanDirectiveFiles } from './checks/directives';
export { checkDatabase } from './checks/database';
export { resolveDbSource } from './db/resolveDbSource';
export type { FileSource, FileEntry, FileStat, WalkResult } from './FileSource';
export type { ScanRoot, SiteLike } from './resolveScanRoot';
export type { MuPluginResult, MuPluginFinding } from './checks/muPlugins';
export type { FilesystemScanResult } from './checks/filesystem';
export type { DirectiveScanResult, DirectiveFinding } from './checks/directives';
export type { DatabaseCheckResult } from './checks/database';
export type { DbSource } from './db/resolveDbSource';

/**
 * `checks.database`'s two shapes: a trusted read of the dump, or a typed refusal. A caller must
 * render the refusal branch as "not checked" — never fall back to treating it as "checked and
 * clean" — which is why this is a tagged union rather than an optional result with nulls inside.
 */
export type DatabaseScanResult =
  | ({ ok: true; asOf: Date; lagMs: number } & DatabaseCheckResult)
  | { ok: false; reason: string; detail: string };

/**
 * Files the host and this addon install into mu-plugins.
 *
 * Kept here rather than imported from agents/security-sentinel/agent.js because that file is a
 * standalone agent bundle the runtime loads separately — it cannot import from src/. The two
 * lists must agree; a test asserts it.
 *
 * These were both wrong once, in the worst direction: omitting our own `nexus-hub-bridge.php`
 * made FS-01 raise a CRITICAL on 15 of 15 sites, every scan. A security tool whose loudest
 * signal fires on its own installer teaches its reader to ignore it.
 */
export const KNOWN_MU_PLUGINS: ReadonlySet<string> = new Set([
  // WP Engine platform
  'wpe-wp-sign-on-plugin.php', 'wpe-cache-plugin.php', 'wpengine-security-auditor.php',
  'mu-plugin.php', 'slt-force-strong-passwords.php', 'wpe-update-source-selector.php',
  // Local by WP Engine
  'site-compat-layer.php',
  // This addon
  'nexus-ai-connector-config.php', 'nexus-hub-bridge.php',
]);

/**
 * Docroot PHP files that are expected. Mirrors the agent's list; a test asserts they agree.
 * local-xdebuginfo.php is Local's, and omitting it flagged all 15 local sites.
 */
export const KNOWN_ROOT_PHP: ReadonlySet<string> = new Set([
  'index.php', 'wp-activate.php', 'wp-blog-header.php', 'wp-comments-post.php',
  'wp-config.php', 'wp-cron.php', 'wp-links-opml.php', 'wp-load.php',
  'wp-login.php', 'wp-mail.php', 'wp-settings.php', 'wp-signup.php',
  'wp-trackback.php', 'xmlrpc.php', 'wp-config-sample.php',
  'local-xdebuginfo.php',
]);

export interface ScanReport {
  site: string;
  /** Absolute web root, or null when it could not be resolved. */
  webRoot: string | null;
  /**
   * Populated when the install could not be scanned at all. A caller MUST treat this as "not
   * checked", never as "clean" — that distinction is the reason the whole scanner exists.
   */
  unscannable?: { reason: string; detail: string };
  checks: {
    muPlugins?: MuPluginResult;
    filesystem?: FilesystemScanResult;
    directives?: DirectiveScanResult;
    database?: DatabaseScanResult;
  };
  /** What was inspected, in the report's own words. */
  coverage: string[];
  /** What was NOT inspected. Never omitted, even when empty. */
  notChecked: string[];
  durationMs: number;
}

/**
 * Run the byte-level checks against one local site.
 *
 * No PHP is executed and the site does not need to be running — that is the entire point. The
 * current Tier 2 path starts the compromised site, clones it (which runs `wp search-replace`
 * four times), and only then inspects; here nothing on the target runs at all.
 */
export interface ScanOptions {
  /**
   * Run the full wp-content walk (FS-02/03/04/06) as well as the mu-plugins check.
   *
   * Off by default, and the difference is not marginal: mu-plugins alone is ~1.6 ms per site
   * (54 ms for 33 installs), while the full walk is ~1.4 s per site (45 s for the same 33) —
   * roughly 25x. At Tier 1 across a 375-site fleet that is the difference between 0.6 s and
   * 8.5 minutes, so the deep walk is opt-in and belongs to an escalated site or an explicitly
   * scoped scan, not to every sweep.
   */
  deep?: boolean;
}

export async function scanLocalSite(site: SiteLike, options: ScanOptions = {}): Promise<ScanReport> {
  const started = Date.now();
  const name = site?.name ?? site?.id ?? '(unknown)';

  const root = resolveScanRoot(site);
  if (!root.ok) {
    return {
      site: name,
      webRoot: null,
      unscannable: { reason: root.reason, detail: root.detail },
      checks: {},
      coverage: [],
      notChecked: ['everything — the install could not be resolved'],
      durationMs: Date.now() - started,
    };
  }

  const source = new LocalFileSource(root.webRoot);
  const muPlugins = await checkMuPlugins(source, root.muPluginDir, KNOWN_MU_PLUGINS);
  const filesystem = options.deep
    ? await scanFilesystem(source, { contentDir: root.contentDir, pluginDir: root.pluginDir, knownRootPhp: KNOWN_ROOT_PHP })
    : undefined;
  // Deep only. The intent was to run this always — .user.ini is the one persistence slot
  // wp_eval structurally cannot see — but finding a handful of directive files requires walking
  // the whole install, which took the shallow scan from 41 ms to 15.5 s across the fleet.
  // Measured, not assumed; the same regression as wiring the filesystem walk in unconditionally.
  const directives = options.deep
    ? await scanDirectiveFiles(source, { siteHost: site?.domain ?? null })
    : undefined;

  // Deep only, same reasoning as filesystem/directives above — this reads the whole dump file
  // once, which is milliseconds for the median site but measured up to ~3.6s on an 808 MB
  // outlier, well outside the shallow scan's speed budget.
  let database: DatabaseScanResult | undefined;
  if (options.deep) {
    if (!site?.id) {
      database = { ok: false, reason: 'no-site-id', detail: 'site record has no id — cannot locate its run/ directory' };
    } else {
      const dbSource = resolveDbSource(site.id, root.webRoot);
      database = dbSource.ok
        ? { ok: true, asOf: dbSource.asOf, lagMs: dbSource.lagMs, ...(await checkDatabase(dbSource.dumpPath, root.tablePrefix)) }
        : { ok: false, reason: dbSource.reason, detail: dbSource.detail };
    }
  }

  const coverage: string[] = [];
  const notChecked: string[] = [];

  if (muPlugins.ok) {
    coverage.push(
      muPlugins.absent
        ? `mu-plugins (${root.muPluginDir}) — directory absent`
        : `mu-plugins (${root.muPluginDir}) — ${muPlugins.examined} PHP file(s) examined`,
    );
    notChecked.push(...muPlugins.knownGaps.map((g) => `mu-plugins ${g}`));
  } else {
    notChecked.push(`mu-plugins (${root.muPluginDir}) — unreadable: ${muPlugins.error}`);
  }

  // Everything the byte scanner does not cover yet. Listing it is not pedantry: a report that
  // names only what it checked invites the reader to infer the rest was fine.
  if (filesystem) {
    coverage.push(
      `filesystem — ${filesystem.filesWalked} file(s) walked, ${filesystem.phpFilesScanned} PHP file(s) content-scanned`,
    );
    notChecked.push(...filesystem.knownIssues.map((i) => `filesystem ${i}`));
    if (filesystem.truncated) notChecked.push('filesystem walk TRUNCATED — the tree was not fully examined');
    for (const u of filesystem.unreadable) notChecked.push(`filesystem unreadable: ${u.path} (${u.reason})`);
  } else {
    // Saying this explicitly is the point. A report that lists only the mu-plugins result
    // invites the reader to assume the rest of the filesystem was looked at.
    notChecked.push('filesystem beyond mu-plugins — deep scan not requested (obfuscation, web-root PHP, uploads PHP, ELF binaries)');
  }
  if (directives) {
    coverage.push(
      `directive files — ${directives.filesExamined.length} examined (.htaccess, .user.ini, php.ini)`,
    );
    notChecked.push(...directives.knownGaps.map((g) => `directives ${g}`));
  } else {
    notChecked.push('.htaccess, .user.ini and php.ini directives — deep scan not requested');
  }
  if (database) {
    if (database.ok) {
      coverage.push(
        `database (as of ${database.asOf.toISOString()}, ${Math.round(database.lagMs / 1000)}s before last shutdown) — ` +
        `${database.posts.examined} post(s), ${database.options.examined} autoloaded option(s), ` +
        `${database.usermeta.examined} usermeta row(s), ${database.comments.examined} approved comment(s) examined`,
      );
      notChecked.push(...database.knownGaps.map((g) => `database ${g}`));
      for (const [table, count] of Object.entries(database.malformedRows)) {
        if (count > 0) notChecked.push(`database ${count} malformed row(s) dropped from ${table} — column count mismatch`);
      }
    } else {
      notChecked.push(`database contents — NOT checked: ${database.reason} (${database.detail})`);
    }
  } else {
    notChecked.push('database contents (injected posts, autoloaded options, usermeta) — deep scan not requested');
  }
  notChecked.push('core and plugin checksums');

  return {
    site: name,
    webRoot: root.webRoot,
    checks: { muPlugins, filesystem, directives, database },
    coverage,
    notChecked,
    durationMs: Date.now() - started,
  };
}
