import type { AssistantContext } from '../../common/types';

// PHP lifecycle — EOL timestamps (unix ms)
const PHP_EOL_TIMESTAMPS: Record<string, number> = {
  '5.6': new Date('2018-12-31').getTime(),
  '7.0': new Date('2019-12-31').getTime(),
  '7.1': new Date('2019-12-31').getTime(),
  '7.2': new Date('2020-11-30').getTime(),
  '7.3': new Date('2021-12-06').getTime(),
  '7.4': new Date('2022-11-28').getTime(),
  '8.0': new Date('2023-11-26').getTime(),
  '8.1': new Date('2024-12-31').getTime(),
};

const PHP_EOL_LABELS: Record<string, string> = {
  '5.6': 'December 2018',
  '7.0': 'December 2019',
  '7.1': 'December 2019',
  '7.2': 'November 2020',
  '7.3': 'December 2021',
  '7.4': 'November 2022',
  '8.0': 'November 2023',
  '8.1': 'December 2024',
};

export function isPhpEol(version: string): boolean {
  const major = version.split('.').slice(0, 2).join('.');
  const ts = PHP_EOL_TIMESTAMPS[major];
  return ts !== undefined && Date.now() > ts;
}

export function getPhpEolDate(version: string): string | null {
  const major = version.split('.').slice(0, 2).join('.');
  return PHP_EOL_LABELS[major] ?? null;
}

export function isWpOutdated(version: string, latestVersion: string): boolean {
  const toNum = (v: string) =>
    v.split('.').reduce((acc, part, i) => acc + parseInt(part || '0', 10) * Math.pow(100, 2 - i), 0);
  return toNum(version) < toNum(latestVersion);
}

export const PLUGIN_CATEGORIES: Record<string, string[]> = {
  'form-builder': ['contact-form-7','gravityforms','wpforms-lite','wpforms','ninja-forms','formidable','fluentform','happyforms'],
  'page-builder': ['elementor','elementor-pro','beaver-builder-lite-version','bb-plugin','js_composer','divi-builder','brizy','oxygen'],
  'seo':          ['wordpress-seo','rank-math','all-in-one-seo-pack','squirrly-seo','the-seo-framework'],
  'ecommerce':    ['woocommerce','easy-digital-downloads','lifterlms','memberpress'],
  'caching':      ['w3-total-cache','wp-super-cache','wp-fastest-cache','litespeed-cache','sg-cachepress'],
  'security':     ['wordfence','sucuri-scanner','better-wp-security','all-in-one-wp-security-and-firewall'],
  'backup':       ['updraftplus','backwpup','duplicator','all-in-one-wp-migration'],
  'performance':  ['autoptimize','smush','ewww-image-optimizer','imagify','jetpack-boost'],
  'analytics':    ['google-analytics-for-wordpress','wp-statistics','independent-analytics'],
};

export const PLUGIN_NAME_TO_SLUG: Record<string, string> = {
  'acf': 'advanced-custom-fields',
  'advanced custom fields': 'advanced-custom-fields',
  'woocommerce': 'woocommerce',
  'yoast': 'wordpress-seo',
  'yoast seo': 'wordpress-seo',
  'elementor': 'elementor',
  'wordfence': 'wordfence',
  'rank math': 'rank-math',
  'updraftplus': 'updraftplus',
  'gravity forms': 'gravityforms',
  'wpforms': 'wpforms-lite',
  'contact form 7': 'contact-form-7',
  'cf7': 'contact-form-7',
};

const WP_KNOWLEDGE = `
## WordPress & PHP Knowledge

### WordPress versions
- WordPress 7.0: Current stable release (shipped May 2026). This is normal and expected — do NOT flag as unrecognized or problematic.
- WordPress 6.9.x: Previous stable — upgrade to 7.0 is recommended
- WordPress 6.8.x and below: Outdated

### PHP End-of-Life (end-of-life) dates
- PHP 7.2: end-of-life November 2020 — no security patches
- PHP 7.3: end-of-life December 2021 — high risk
- PHP 7.4: end-of-life November 2022 — very common, needs upgrade
- PHP 8.0: end-of-life November 2023 — needs upgrade
- PHP 8.1: end-of-life December 2024 — upgrade soon
- PHP 8.2: Active — supported until December 2026
- PHP 8.3: Active — current recommended version

### Plugin categories
- Form builders: contact-form-7, gravityforms, wpforms-lite, ninja-forms
- Page builders: elementor, js_composer (WPBakery), bb-plugin (Beaver Builder), divi-builder
- SEO: wordpress-seo (Yoast), rank-math, all-in-one-seo-pack
- E-commerce: woocommerce, easy-digital-downloads
- Caching: litespeed-cache, w3-total-cache, autoptimize
- Security: wordfence, sucuri-scanner, better-wp-security
- Backup: updraftplus, backwpup, duplicator

### Nexus AI capabilities
- CAN list active plugins with their installed versions (versions are in the site context when available)
- CAN find sites by plugin, theme, PHP version, WP version
- CAN search indexed post/page content semantically
- CAN start/stop local sites, trigger indexing, show fleet stats
- CANNOT determine if a plugin is outdated (no access to WordPress.org current versions) — for update status, direct user to WP Admin → Plugins OR suggest the Ask/Tell tab for fleet-wide plugin analysis
- CANNOT modify WordPress databases or update plugins directly
- When asked about out-of-date plugins on THIS site: list the installed versions you know from context, then say "To see if these need updates, check WP Admin → Plugins. For fleet-wide outdated plugin analysis across all your sites, use the Ask/Tell tab."

`;

// JSON output format — included ONLY for the single-shot ASSISTANT_QUERY path.
// Do NOT include this in the ChatTab/agent system prompt — it confuses tool-calling models.
const WP_KNOWLEDGE_JSON_FORMAT = `
### CRITICAL: Do NOT fabricate site names or versions
You do not have access to individual site details. The system will look up real sites.
For fleet-filter intent, use the "filter" field to describe what to search for.
Leave "sites" as an empty array — the system populates it from real data.

### Output format — respond with ONLY valid JSON:
{
  "intent": "fleet-filter" | "content-search" | "site-info" | "action" | "explanation",
  "summary": "plain English description of what you are looking for — no jargon, no site names",
  "filter": {
    "phpSort": "asc" | "desc",
    "wpSort": "asc" | "desc",
    "phpEolOnly": true,
    "phpVersion": { "op": "<", "version": "8.0" },
    "pluginSlug": "elementor",
    "pluginCategory": "form-builder" | "page-builder" | "seo" | "ecommerce" | "caching" | "security" | "backup" | "performance" | "analytics",
    "contentQuery": "topic to search"
  },
  "sites": [],
  "actions": [{ "label": "...", "kind": "primary" | "secondary", "ipcChannel": "nexus-ai:..." }],
  "needsClarification": false,
  "clarificationQuestion": null
}

### Fleet query examples:
"what needs updating?" → { "intent": "fleet-filter", "filter": { "phpSort": "asc", "phpEolOnly": true }, "sites": [], "actions": [] }
"sites with Elementor" → { "intent": "fleet-filter", "filter": { "pluginSlug": "elementor" }, "sites": [], "actions": [] }
"form builders" → { "intent": "fleet-filter", "filter": { "pluginCategory": "form-builder" }, "sites": [], "actions": [] }
"customer onboarding posts" → { "intent": "content-search", "filter": { "contentQuery": "customer onboarding" }, "sites": [], "actions": [] }

### Site-mode query examples (when a ## Current site context section is present):
"any issues to fix?" → { "intent": "site-info", "summary": "Use the PHP and WordPress version data in the site context above. Report actual EOL status, outdated core, and missing AI configuration. Do not fabricate versions or say 'start the site' if the PHP line already says the site is running.", "sites": [], "actions": [], "needsClarification": false }
"what plugins are active?" → { "intent": "site-info", "summary": "Active plugins: Advanced Custom Fields, WooCommerce, Yoast SEO. Start the site to get a full up-to-date list.", "sites": [], "actions": [], "needsClarification": false }
"which plugins have updates?" → { "intent": "site-info", "summary": "List the installed plugin versions from the site context above. I cannot determine if they are outdated. To check for updates: visit [site-url]/wp-admin/plugins.php. For fleet-wide outdated plugin analysis, use the Ask/Tell tab.", "sites": [], "actions": [], "needsClarification": false }

Return ONLY the JSON object. No markdown, no code blocks.
`;

/**
 * Build the WordPress system prompt for AI interactions.
 *
 * @param context      Fleet or site context (site counts, PHP versions, etc.)
 * @param agentMode    true = ChatTab/tool-calling agent (omits JSON output format)
 *                     false = single-shot ASSISTANT_QUERY (includes JSON output format)
 */
export function buildWordPressSystemPrompt(
  context: AssistantContext,
  agentMode = false,
): string {
  const contextSection = context.mode === 'fleet'
    ? `## Current fleet context
You are assisting with a fleet of ${context.localSiteCount ?? 0} local WordPress sites and ${context.wpeSiteCount ?? 0} WP Engine installs.
${context.indexedCount ?? 0} sites have indexed content available for search.
${context.fleetInsights?.map(i => `- ${i.kind.toUpperCase()}: ${i.title} — ${i.detail}`).join('\n') ?? ''}`
    : (() => {
      const isRunning = context.siteStatus === 'running';
      const pluginLine = context.activePlugins && context.activePlugins.length > 0
        ? `Active plugins (${context.pluginCount}): ${context.activePlugins.join(', ')}`
        : context.scanDepth === 'filesystem'
        ? `Installed plugins: ${context.installedPluginCount ?? 0} found (site halted — active status unknown)`
        : `Active plugins: ${context.pluginCount ?? 0}`;
      const inactiveLine = context.inactivePluginCount ? `\n- Inactive plugins: ${context.inactivePluginCount}` : '';
      const postLine = context.postCount != null
        ? `\n- Posts: ${context.postCount}${context.lastPostAt ? ` (most recent: ${context.lastPostAt})` : ''}`
        : '';
      const userLine = context.userCount != null ? `\n- Users: ${context.userCount}` : '';
      const themeLine = context.activeTheme ? `\n- Active theme: ${context.activeTheme}` : '';
      const freshLine = context.lastIndexedAgo ? `\n- Data freshness: indexed ${context.lastIndexedAgo}` : '';
      const urlLine = context.siteUrl ? `\n- URL: ${context.siteUrl}` : '';
      return `## Current site context
IMPORTANT: Answer directly from the data below. Do NOT say you are "checking" or "reviewing" — immediately report what you observe. If specific data is missing, say so explicitly.
Site: "${context.siteName}" — Status: ${isRunning ? 'RUNNING' : context.siteStatus === 'halted' ? 'HALTED' : 'unknown'}${urlLine}
- WordPress: ${context.wpVersion ?? 'unknown'}
- PHP: ${context.phpVersion
          ? `${context.phpVersion}${isPhpEol(context.phpVersion) ? ` (end-of-life — ${getPhpEolDate(context.phpVersion)})` : ''}`
          : (isRunning || context.scanDepth === 'full')
            ? 'unknown (site is running but PHP version could not be determined — suggest clicking Refresh on the Nexus AI tab)'
            : 'unknown (start the site to determine version)'}
- ${pluginLine}${inactiveLine}${themeLine}${postLine}${userLine}${freshLine}
- Content index: ${context.indexState === 'indexed' ? `${context.documentCount ?? 0} docs indexed` : 'not indexed'}
${context.linkedWpeInstall ? `- Linked to WPE: ${context.linkedWpeInstall}` : ''}${
  context.wpSettings && Object.keys(context.wpSettings).length > 0
    ? `\n- WordPress settings: ${Object.entries(context.wpSettings)
        .map(([k, v]) => `${k}=${v}`)
        .join(', ')}`
    : ''}
SITE IS ${isRunning ? 'RUNNING — do not tell the user to start it' : 'HALTED — WP Admin and WP-CLI require the site to be running'}.`;
    })();

  return `You are Nexus AI, an intelligent assistant for WordPress developers using Local by WP Engine.
Always respond helpfully and concisely. Use plain language — never say "LanceDB", "graph.db", "vector store", or "metadata cache".

${contextSection}
${WP_KNOWLEDGE}${agentMode ? '' : WP_KNOWLEDGE_JSON_FORMAT}`;
}
