import { LocalFileSource } from './LocalFileSource';
import { resolveScanRoot, SiteLike } from './resolveScanRoot';
import { checkMuPlugins, MuPluginResult } from './checks/muPlugins';

export { LocalFileSource } from './LocalFileSource';
export { resolveScanRoot } from './resolveScanRoot';
export { checkMuPlugins } from './checks/muPlugins';
export type { FileSource, FileEntry, FileStat, WalkResult } from './FileSource';
export type { ScanRoot, SiteLike } from './resolveScanRoot';
export type { MuPluginResult, MuPluginFinding } from './checks/muPlugins';

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

export interface ScanReport {
  site: string;
  /** Absolute web root, or null when it could not be resolved. */
  webRoot: string | null;
  /**
   * Populated when the install could not be scanned at all. A caller MUST treat this as "not
   * checked", never as "clean" — that distinction is the reason the whole scanner exists.
   */
  unscannable?: { reason: string; detail: string };
  checks: { muPlugins?: MuPluginResult };
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
export async function scanLocalSite(site: SiteLike): Promise<ScanReport> {
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
  notChecked.push(
    'filesystem beyond mu-plugins (obfuscation, web-root PHP, uploads, ELF, .htaccess)',
    'database contents (injected posts, autoloaded options, usermeta)',
    'core and plugin checksums',
  );

  return {
    site: name,
    webRoot: root.webRoot,
    checks: { muPlugins },
    coverage,
    notChecked,
    durationMs: Date.now() - started,
  };
}
