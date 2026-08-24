/**
 * WordPress provider — drives Claude with the WordPress MCP Adapter.
 *
 * The WordPress MCP Adapter (github.com/WordPress/mcp-adapter) exposes the
 * WordPress Abilities API as an MCP server, bridging wp_register_ability() calls
 * to MCP tools. With only core, WordPress 7.0.4 registers three abilities:
 *   core/get-site-info, core/get-user-info, core/get-environment-info
 *
 * This is the honest baseline: what a WordPress site offers with no WP Engine
 * product attached, through its own official AI surface.
 *
 * Prerequisites (not yet set up — see docs/planning/2026-08-21-platform-benchmark-design.md §8):
 *   - mcp-adapter plugin installed on the Cedar sites, version pinned
 *   - Application Password created per site
 *   - @automattic/mcp-wordpress-remote proxy running locally
 *   - wordpress-mcp server configured in Claude Code MCP settings
 *
 * Until those are in place this provider returns a structured placeholder
 * so the promptfoo config is complete and can be run once prereqs are met.
 */

const { execSync } = require('child_process');

const MODEL = process.env.BENCH_MODEL ?? 'claude-sonnet-5';
const TIMEOUT_MS = 300_000;

// Sites the WP MCP Adapter is configured for.
// Update once the adapter is installed and Application Passwords are created.
const WP_SITES = `
WordPress MCP Adapter connected sites (update once configured):
  cedarvalehealt.wpenginepowered.com
  summitdermatol.wpenginepowered.com
  palegreen-capybara-114180.hostingersite.com

Core abilities available (WordPress 7.0.4, no extra plugins):
  core/get-site-info     — WP version, site title, site URL, admin email
  core/get-user-info     — current user details
  core/get-environment-info — PHP version, server info
`.trim();

// Status 2026-08-24:
// ✅ mcp-adapter v0.6.1 installed and active on all 3 sites
// ✅ Application Passwords created (stored in nexus.env.local)
// ✅ mcp-wordpress-remote 0.4.0 installed globally
// ⏳ Tools not appearing in tools/list — mcp-adapter exposes abilities via
//    mcp-adapter/discover-abilities, not in the standard tools/list response.
//    The proxy connects but Claude sees no tools to use.
//    Next step: investigate whether --skip-plugins causes ability non-registration,
//    or whether a custom server needs to be created via create_server() to expose
//    abilities as direct tools.

const NOT_CONFIGURED = `WordPress MCP Adapter infrastructure is in place (mcp-adapter v0.6.1 active, Application Passwords created, proxy installed) but tool exposure requires further investigation. The adapter serves abilities via mcp-adapter/discover-abilities rather than the standard tools/list, and the proxy integration needs additional work. See tests/platform-bench/providers/wordpress.js for status.`;

module.exports = class WordPressProvider {
  id() { return 'wordpress-mcp'; }

  async callApi(prompt) {
    // Check if the wordpress-mcp server is likely configured.
    // When it is, swap the placeholder for the real MCP call.
    const mcpServer = process.env.WORDPRESS_MCP_SERVER ?? 'wordpress-mcp';
    const configured = process.env.WORDPRESS_MCP_CONFIGURED === 'true';

    if (!configured) {
      // Return a structured NOT_CONFIGURED response so promptfoo can score it.
      // This will correctly fail the content assertions and pass as an honest refusal
      // in the reach test.
      return {
        output: NOT_CONFIGURED,
        metadata: { configured: false },
      };
    }

    const fullPrompt = `${WP_SITES}\n\n${prompt}`;
    const escaped = fullPrompt.replace(/'/g, "'\\''");
    const cmd = [
      'claude',
      '--model', MODEL,
      '--mcp-server', mcpServer,
      '-p', `'${escaped}'`,
    ].join(' ');

    const startMs = Date.now();
    try {
      const output = execSync(cmd, {
        encoding: 'utf8',
        timeout: TIMEOUT_MS,
        env: { ...process.env },
      });
      return {
        output: output.trim(),
        metadata: { durationMs: Date.now() - startMs, configured: true },
      };
    } catch (err) {
      return {
        error: `WordPress provider error: ${err.message?.slice(0, 300)}`,
        output: '',
      };
    }
  }
};
