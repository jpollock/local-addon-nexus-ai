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
