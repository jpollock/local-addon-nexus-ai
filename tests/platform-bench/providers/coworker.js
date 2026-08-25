/**
 * Coworker provider — drives Claude with the wpe-coworker MCP server.
 *
 * Prerequisites:
 *   - COWORKER_API_KEY must be set. Add to nexus.env.local:
 *       COWORKER_API_KEY=wpe_...
 *     Then source it before running: set -a; source nexus.env.local; set +a
 *
 * Collection IDs (stable per site, proj_cE8Ib44IuegI3rH5l1MbBy, 2026-08-24):
 *   cedarvalehealt.wpenginepowered.com              col_elNAyZoSKGhJoFCFqHSK12
 *   summitdermatol.wpenginepowered.com              col_KO2gvD3Tbw5Rvuv0msq4dQ
 *   palegreen-capybara-114180.hostingersite.com     col_tErE8KxfsfxWrtd1HscbCe
 *   alpineoutfitte.wpenginepowered.com               col_dhR33vS98LEeZ0CVUVTnZK
 */

const { execSync, execFileSync } = require('child_process');
const fs = require('fs');
const path = require('path');
const os = require('os');
const { benchCwd, MCP_ONLY_FLAGS, BENCH_MODEL, parseClaudeJson } = require('./isolation');
const TIMEOUT_MS = 300_000;

/**
 * ABILITIES — off by default, and the default is a safety position, not laziness.
 *
 * Coworker CAN reach plugin, environment and site-health data: with a personal API
 * key and a per-site WordPress account connection, `run_site_ability` runs WordPress
 * abilities. Measured 2026-08-25 on summitdermatol, `power-coworker/list-plugins`
 * returns counts, per-plugin versions AND update availability. So the site quadrant
 * is a genuine comparison, and shipping it with Coworker denied the abilities route
 * would publish a decline WE caused. That is why this switch exists.
 *
 * It is off by default because the read-only guarantee cannot currently be made.
 * `--allowedTools` gates TOOL names, and `run_site_ability` is a generic dispatcher:
 * its `ability_name` is a free string, so allowing the tool allows every ability
 * behind it — `delete-posts`, `delete-pages`, `activate-plugin`, `update-plugin`
 * included. There is no tool-level subset to allow.
 *
 * The two controls that DO bind, neither of which lives in this file:
 *   1. The connected WordPress user's capabilities. Abilities execute as that user
 *      with exactly their permissions, enforced by WordPress, not by this harness.
 *      Connect a dedicated benchmark user rather than an administrator. Note the
 *      capability model may not cleanly separate reading plugins from changing them
 *      (`activate_plugins` governs both), so verify what a reduced user can still
 *      answer before assuming a role solves it.
 *   2. The substrate's disposability. The Coworker-visible sites are seeded demo
 *      installs, restorable by re-running their seeder. That is what makes the
 *      residual risk acceptable — it is not a reason to skip control 1.
 *
 * Turning this on also INVALIDATES the existing ledger as a comparison baseline:
 * every archived run was taken with the narrow scaffolding, so a wider column is a
 * new baseline, not a continuation. Re-run the four existing scenarios before
 * reading any post-widening number against a pre-widening one.
 */
const ABILITIES_ENABLED = process.env.COWORKER_ABILITIES === '1';

/** Tool allowlist. Enforces the SURFACE, not the abilities behind run_site_ability. */
const READ_TOOLS = [
  'mcp__wpe-coworker__search_knowledge_base',
  'mcp__wpe-coworker__fetch_knowledge_base_document',
  'mcp__wpe-coworker__list_account_sites',
];
const ABILITY_TOOLS = [
  'mcp__wpe-coworker__list_site_abilities',
  'mcp__wpe-coworker__search_abilities',
  'mcp__wpe-coworker__run_site_ability',
];

function allowedToolFlags() {
  const tools = ABILITIES_ENABLED ? [...READ_TOOLS, ...ABILITY_TOOLS] : READ_TOOLS;
  return ['--allowedTools', `'${tools.join(',')}'`];
}

/**
 * Personal key preferred; project key accepted for the KB-only surface.
 *
 * The two are distinguishable only by how `list_site_abilities` fails — a project
 * key returns `unauthorized: a personal API key is required for this tool`, a
 * personal one returns `not_personally_connected` with a connect URL. Note that
 * `wp_connection_status`, which WP Engine's connections doc says marks the
 * difference on `list_account_sites`, is NOT returned under either class; do not
 * gate on it.
 *
 * Length is a heuristic for the manifest label only, never for access control —
 * the run either works or fails loudly above.
 */
function resolveCoworkerKey() {
  const personal = process.env.COWORKER_PERSONAL_API_KEY;
  if (personal) return { key: personal, keyClass: 'personal' };
  const project = process.env.COWORKER_API_KEY;
  if (project) return { key: project, keyClass: 'project' };
  return { key: null, keyClass: null };
}

/** Appended to the scaffolding only when abilities are armed. */
const ABILITY_TOOLS_DOC = `
  list_site_abilities(site_id)          — abilities available on one site
  run_site_ability(site_id, ability_name, input?)

Abilities reach data the knowledge base does not: plugins (with update
availability), environment, site health. They run as a connected WordPress user
and are per-site — a site you are not connected to returns not_personally_connected,
which is a real answer about that site, not a tool failure.
Read-only abilities only. Do not create, update, delete, activate or install.`;

const COLLECTION_MAP = `
Known Coworker knowledge base collections:
- cedarvalehealt.wpenginepowered.com (flagship) → col_elNAyZoSKGhJoFCFqHSK12
- summitdermatol.wpenginepowered.com (Summit Dermatology Partners) → col_KO2gvD3Tbw5Rvuv0msq4dQ
- palegreen-capybara-114180.hostingersite.com (Ridgeline Skin Institute) → col_tErE8KxfsfxWrtd1HscbCe
- alpineoutfitte.wpenginepowered.com (Alpine Outfitters) → col_dhR33vS98LEeZ0CVUVTnZK

Tools available:
  search_knowledge_base(collection_id, query?, filters?, aggregations?, top_n?)
  fetch_knowledge_base_document(collection_id, id)
  list_account_sites()${ABILITIES_ENABLED ? ABILITY_TOOLS_DOC : ''}

ACF fields are in 'metadata' prefixed 'acf_'. Examples:
  Filter by NPI:    filters: { metadata: { acf_npi: ["1274960149"] } }
  Filter by status: filters: { metadata: { acf_review_status: ["overdue"] } }
  Aggregate hours:  aggregations: [{ name: "h", field: "metadata.acf_hours", type: "terms" }]
Cross-site queries require one call per collection.
`.trim();

module.exports = class CoworkerProvider {
  id() { return 'coworker-mcp'; }

  async callApi(prompt) {
    const { key, keyClass } = resolveCoworkerKey();
    if (!key) {
      return {
        error: 'No Coworker key set. Add COWORKER_PERSONAL_API_KEY (preferred) or '
             + 'COWORKER_API_KEY to nexus.env.local and source it before running.',
        output: '',
      };
    }
    if (ABILITIES_ENABLED && keyClass !== 'personal') {
      return {
        error: 'COWORKER_ABILITIES=1 requires COWORKER_PERSONAL_API_KEY. A project key '
             + 'resolves no WordPress user and every ability call returns unauthorized — '
             + 'the column would decline for a reason we caused. Refusing to run rather '
             + 'than record a false decline.',
        output: '',
      };
    }

    // Write an ephemeral MCP config with the bearer token
    const mcpConfig = {
      mcpServers: {
        'wpe-coworker': {
          type: 'http',
          url: 'https://api.ai.wpengine.com/v1/mcp',
          headers: { Authorization: `Bearer ${key}` },
        },
      },
    };
    const configPath = path.join(os.tmpdir(), `coworker-mcp-${process.pid}.json`);
    fs.writeFileSync(configPath, JSON.stringify(mcpConfig));

    const fullPrompt = `${COLLECTION_MAP}\n\n${prompt}`;
    const escaped = fullPrompt.replace(/'/g, "'\\''");
    const cmd = [
      'claude',
      '--model', BENCH_MODEL,
      '--mcp-config', configPath,
      '--strict-mcp-config',
      ...MCP_ONLY_FLAGS,
      ...allowedToolFlags(),
      '--dangerously-skip-permissions',
      '--output-format', 'json',
      '-p', `'${escaped}'`,
    ].join(' ');

    try {
      const raw = execSync(cmd, {
        encoding: 'utf8',
        timeout: TIMEOUT_MS,
        cwd: benchCwd('coworker'),
        env: { ...process.env },
        stdio: ['pipe', 'pipe', 'pipe'],
        input: '',
      });
      return parseClaudeJson(raw, 'Coworker');
    } catch (err) {
      const msg = (err.stdout || err.stderr || err.message || '').toString().slice(0, 500);
      return {
        error: `Coworker provider error: ${msg}`,
        output: '',
      };
    } finally {
      try { fs.unlinkSync(configPath); } catch { /* ignore */ }
    }
  }
};
