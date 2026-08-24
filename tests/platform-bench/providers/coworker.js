/**
 * Coworker provider — drives Claude with the wpe-coworker MCP server.
 *
 * Coworker's MCP surface is its knowledge base: search_knowledge_base,
 * fetch_knowledge_base_document, list_account_sites. Unlike Nexus it has no
 * cross-site join in a single call, and its ability to find facts depends on
 * ACF metadata being indexed into the KB.
 *
 * Collection IDs are stable per-site and hard-coded here. Update if the Power
 * project changes or sites are reconnected.
 *
 * Auth: reads COWORKER_API_KEY from the environment. Load from nexus.env.local
 * before running the benchmark:
 *   set -a; source ~/development/wpengine/local-addon-nexus-ai/nexus.env.local; set +a
 *
 * Known KB collections in project proj_cE8Ib44IuegI3rH5l1MbBy (2026-08-24):
 *   col_elNAyZoSKGhJoFCFqHSK12   cedarvalehealt.wpenginepowered.com   (flagship)
 *   col_KO2gvD3Tbw5Rvuv0msq4dQ   summitdermatol.wpenginepowered.com   (site A)
 *   col_tErE8KxfsfxWrtd1HscbCe   palegreen-capybara-114180.hostingersite.com (site B/Ridgeline)
 */

const { execSync } = require('child_process');

const MODEL = process.env.BENCH_MODEL ?? 'claude-sonnet-5';
const TIMEOUT_MS = 300_000;

// Tell the model which site maps to which collection so it can route queries.
const COLLECTION_MAP = `
Known Coworker knowledge base collections:
- cedarvalehealt.wpenginepowered.com (flagship) → col_elNAyZoSKGhJoFCFqHSK12
- summitdermatol.wpenginepowered.com (Summit Dermatology Partners, site A) → col_KO2gvD3Tbw5Rvuv0msq4dQ
- palegreen-capybara-114180.hostingersite.com (Ridgeline Skin Institute, site B) → col_tErE8KxfsfxWrtd1HscbCe

You have access to:
  search_knowledge_base(collection_id, query?, filters?, aggregations?, top_n?)
  fetch_knowledge_base_document(collection_id, id)
  list_account_sites()

ACF fields are in the 'metadata' object of each document, prefixed 'acf_'.
You can filter on them: filters: { metadata: { acf_npi: ["1274960149"] } }
You can aggregate: aggregations: [{ name: "x", field: "metadata.acf_hours", type: "terms" }]
Cross-site queries require calling search_knowledge_base once per collection.
`.trim();

module.exports = class CoworkerProvider {
  id() { return 'coworker-mcp'; }

  async callApi(prompt) {
    const fullPrompt = `${COLLECTION_MAP}\n\n${prompt}`;
    const escaped = fullPrompt.replace(/'/g, "'\\''");

    // The wpe-coworker MCP server name must match what is configured in
    // Claude Code's MCP settings. Run `/mcp` in the Claude Code terminal
    // to verify it is connected before running the benchmark.
    const cmd = [
      'claude',
      '--model', MODEL,
      '--mcp-server', 'wpe-coworker',
      '-p', `'${escaped}'`,
    ].join(' ');

    const startMs = Date.now();
    try {
      const output = execSync(cmd, {
        encoding: 'utf8',
        timeout: TIMEOUT_MS,
        env: {
          ...process.env,
          // The wpe-coworker MCP server reads this for auth.
          // Source nexus.env.local before running.
          COWORKER_API_KEY: process.env.COWORKER_API_KEY ?? '',
        },
      });
      return {
        output: output.trim(),
        metadata: { durationMs: Date.now() - startMs },
      };
    } catch (err) {
      return {
        error: `Coworker provider error: ${err.message?.slice(0, 300)}`,
        output: '',
      };
    }
  }
};
