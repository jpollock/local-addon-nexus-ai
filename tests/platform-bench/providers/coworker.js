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

const COLLECTION_MAP = `
Known Coworker knowledge base collections:
- cedarvalehealt.wpenginepowered.com (flagship) → col_elNAyZoSKGhJoFCFqHSK12
- summitdermatol.wpenginepowered.com (Summit Dermatology Partners) → col_KO2gvD3Tbw5Rvuv0msq4dQ
- palegreen-capybara-114180.hostingersite.com (Ridgeline Skin Institute) → col_tErE8KxfsfxWrtd1HscbCe
- alpineoutfitte.wpenginepowered.com (Alpine Outfitters) → col_dhR33vS98LEeZ0CVUVTnZK

Tools available:
  search_knowledge_base(collection_id, query?, filters?, aggregations?, top_n?)
  fetch_knowledge_base_document(collection_id, id)
  list_account_sites()

ACF fields are in 'metadata' prefixed 'acf_'. Examples:
  Filter by NPI:    filters: { metadata: { acf_npi: ["1274960149"] } }
  Filter by status: filters: { metadata: { acf_review_status: ["overdue"] } }
  Aggregate hours:  aggregations: [{ name: "h", field: "metadata.acf_hours", type: "terms" }]
Cross-site queries require one call per collection.
`.trim();

module.exports = class CoworkerProvider {
  id() { return 'coworker-mcp'; }

  async callApi(prompt) {
    const key = process.env.COWORKER_API_KEY;
    if (!key) {
      return {
        error: 'COWORKER_API_KEY not set. Add to nexus.env.local and source it before running.',
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
