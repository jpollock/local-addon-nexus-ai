/**
 * WordPress provider — drives Claude with the WordPress benchmark MCP server.
 *
 * Uses the WP-CLI STDIO transport, which bypasses HTTP auth complexity and is
 * the path the mcp-adapter docs show for testing. Each site runs the command:
 *   wp mcp-adapter serve --user=<user> --server=benchmark-server
 *
 * The benchmark server (mu-plugin: benchmark-mcp-server.php) is a custom
 * mcp-adapter server exposing exactly three core abilities as direct tools:
 *   core/get-site-info, core/get-user-info, core/get-environment-info
 *
 * This represents what WordPress ships with the mcp-adapter plugin — no Coworker
 * abilities, no custom tools. The Power Coworker abilities that wpe-hub registers
 * are deliberately excluded: those belong to the Coworker column.
 *
 * Prerequisites (all done as of 2026-08-24):
 *   ✅ mcp-adapter v0.6.1 installed on all 3 sites
 *   ✅ benchmark-mcp-server.php mu-plugin deployed to all 3 sites
 *   ✅ SSH access configured for cedarvalehealt, summitdermatol, hostinger-test
 *   ✅ Application Passwords created (in nexus.env.local — not needed for STDIO)
 *
 * Site → SSH target mapping:
 *   cedarvalehealt  →  cedarvalehealt@cedarvalehealt.ssh.wpengine.net  path=sites/cedarvalehealt
 *   summitdermatol  →  summitdermatol@summitdermatol.ssh.wpengine.net  path=sites/summitdermatol
 *   palegreen       →  hostinger-test  path=~/domains/palegreen-capybara-114180.hostingersite.com/public_html
 */

const { execSync } = require('child_process');
const path = require('path');

const MODEL = process.env.BENCH_MODEL ?? 'claude-opus-5';
const TIMEOUT_MS = 300_000;

// WP-CLI STDIO transport: claude drives a claude process that uses the mcp-adapter
// WP-CLI command as the MCP server transport. The MCP config points to a script
// that invokes wp mcp-adapter serve over SSH.
const SITE_CONFIGS = {
  // Map site names mentioned in prompts to their SSH targets
  cedarvalehealt:  { sshHost: 'cedarvalehealt@cedarvalehealt.ssh.wpengine.net', wpPath: 'sites/cedarvalehealt',  wpUser: 'admin' },
  summitdermatol:  { sshHost: 'summitdermatol@summitdermatol.ssh.wpengine.net',  wpPath: 'sites/summitdermatol', wpUser: 'summitdermatol' },
  'palegreen-capybara-114180.hostingersite.com': {
    sshHost: 'hostinger-test',
    wpPath: '~/domains/palegreen-capybara-114180.hostingersite.com/public_html',
    wpUser: 'jeremy@elasticapi.io',
  },
};

const SITE_CONTEXT = `
You have access to a WordPress MCP server via the wp mcp-adapter serve command.
The server exposes exactly three core WordPress tools:
  core-get-site-info     — site name, URL, version, admin email, charset, language
  core-get-user-info     — current user display name, login, roles, locale
  core-get-environment-info — environment type, PHP version, DB version, WP version

These are the only tools available. You cannot access content, plugins, themes, or
any other WordPress data through this server. If a question requires data beyond
site/user/environment info, say so clearly rather than fabricating an answer.

Sites you can query (one at a time — use separate tool calls if needed):
  cedarvalehealt.wpenginepowered.com  (flagship Cedar & Vale)
  summitdermatol.wpenginepowered.com  (Summit Dermatology Partners)
  palegreen-capybara-114180.hostingersite.com  (Ridgeline Skin Institute)
`.trim();

module.exports = class WordPressProvider {
  id() { return 'wordpress-mcp'; }

  /**
   * Pick the primary site a prompt is asking about, defaulting to the flagship.
   * The WP-CLI STDIO transport connects to one site; cross-site questions need
   * separate calls (which this simple implementation doesn't support — it will
   * answer for whichever site it detects or the flagship).
   */
  detectSite(prompt) {
    const lower = prompt.toLowerCase();
    if (lower.includes('summitdermatol') || lower.includes('summit dermatology')) {
      return 'summitdermatol';
    }
    if (lower.includes('palegreen') || lower.includes('ridgeline')) {
      return 'palegreen-capybara-114180.hostingersite.com';
    }
    // Default to flagship for general questions
    return 'cedarvalehealt';
  }

  async callApi(prompt) {
    const siteKey = this.detectSite(prompt);
    const cfg = SITE_CONFIGS[siteKey];
    if (!cfg) {
      return { error: `No SSH config for site: ${siteKey}`, output: '' };
    }

    // Write a temp MCP config that uses SSH to run wp mcp-adapter serve
    const os = require('os');
    const fs = require('fs');
    const configPath = path.join(os.tmpdir(), `wp-mcp-${process.pid}.json`);
    const mcpConfig = {
      mcpServers: {
        'wordpress-benchmark': {
          command: 'ssh',
          args: [
            '-o', 'BatchMode=yes',
            '-o', 'ConnectTimeout=30',
            cfg.sshHost,
            `cd ${cfg.wpPath} && wp mcp-adapter serve --user=${cfg.wpUser} --server=benchmark-server`,
          ],
        },
      },
    };
    fs.writeFileSync(configPath, JSON.stringify(mcpConfig));

    const fullPrompt = `${SITE_CONTEXT}\n\nSite you are connected to: ${siteKey}\n\n${prompt}`;
    const escaped = fullPrompt.replace(/'/g, "'\\''");

    const cmd = [
      'claude',
      '--model', MODEL,
      '--mcp-config', configPath,
      '--strict-mcp-config',
      '--dangerously-skip-permissions',
      '-p', `'${escaped}'`,
    ].join(' ');

    const startMs = Date.now();
    try {
      const output = execSync(cmd, {
        encoding: 'utf8',
        timeout: TIMEOUT_MS,
        env: { ...process.env },
        stdio: ['pipe', 'pipe', 'pipe'],
        input: '',
      });
      return {
        output: output.trim(),
        metadata: { durationMs: Date.now() - startMs, site: siteKey },
      };
    } catch (err) {
      const msg = (err.stdout || err.stderr || err.message || '').toString().slice(0, 500);
      return {
        error: `WordPress provider error (${siteKey}): ${msg}`,
        output: '',
      };
    } finally {
      try { fs.unlinkSync(configPath); } catch { /* ignore */ }
    }
  }
};
