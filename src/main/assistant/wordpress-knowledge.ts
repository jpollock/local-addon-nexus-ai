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
- Can find sites by plugin, theme, PHP version, WP version
- Can search indexed post/page content semantically
- Can start/stop local sites, trigger indexing, show fleet stats
- CANNOT modify WordPress databases or update plugins directly

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
"any issues to fix?" → { "intent": "site-info", "summary": "WordPress 6.9.4 is outdated — current version is 7.0. PHP version unknown (start site for details). AI plugin is not configured on this site.", "sites": [], "actions": [], "needsClarification": false }
"what plugins are active?" → { "intent": "site-info", "summary": "Active plugins: Advanced Custom Fields, WooCommerce, Yoast SEO. Start the site to get a full up-to-date list.", "sites": [], "actions": [], "needsClarification": false }
"which plugins have updates?" → { "intent": "site-info", "summary": "Plugin update status requires the site to be running. Start the site and use WP Admin → Plugins to check for updates.", "sites": [], "actions": [], "needsClarification": false }

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
      const pluginLine = context.activePlugins && context.activePlugins.length > 0
        ? `Active plugins (${context.pluginCount}): ${context.activePlugins.join(', ')}`
        : context.scanDepth === 'filesystem'
        ? `Installed plugins: ${context.installedPluginCount ?? 0} found (site halted — active status unknown)`
        : `Active plugins: ${context.pluginCount ?? 0}`;
      const postLine = context.postCount != null ? `\n- Posts: ${context.postCount}` : '';
      const userLine = context.userCount != null ? `\n- Users: ${context.userCount}` : '';
      const themeLine = context.activeTheme ? `\n- Active theme: ${context.activeTheme}` : '';
      return `## Current site context
IMPORTANT: Answer directly from the data below. Do NOT say you are "checking" or "reviewing" — immediately report what you observe. If specific data is missing, say so explicitly.
Site: "${context.siteName}"
- WordPress: ${context.wpVersion ?? 'unknown'}
- PHP: ${context.phpVersion ?? 'unknown'}${context.phpVersion && isPhpEol(context.phpVersion) ? ` (end-of-life — ${getPhpEolDate(context.phpVersion)})` : ''}
- ${pluginLine}${themeLine}${postLine}${userLine}
- Content index: ${context.indexState === 'indexed' ? `${context.documentCount ?? 0} docs indexed` : 'not indexed'}
${context.linkedWpeInstall ? `- Linked to WPE: ${context.linkedWpeInstall}` : ''}`;
    })();

  return `You are Nexus AI, an intelligent assistant for WordPress developers using Local by WP Engine.
Always respond helpfully and concisely. Use plain language — never say "LanceDB", "graph.db", "vector store", or "metadata cache".

${contextSection}
${WP_KNOWLEDGE}${agentMode ? '' : WP_KNOWLEDGE_JSON_FORMAT}`;
}
