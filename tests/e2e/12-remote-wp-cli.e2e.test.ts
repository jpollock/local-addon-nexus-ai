import { McpClient } from './helpers/client';
import { getClient, deserializeEnvironment, resultText, expectSuccess } from './helpers/environment';

/**
 * Remote WP-CLI — run WP-CLI commands on WPE installs via SSH.
 * Conditional on CAPI availability and a WPE-linked site in Local.
 *
 * These tests use the `install_name` parameter to route WP-CLI commands
 * through SSH to a remote WPE install instead of executing locally.
 */
describe('12 — Remote WP-CLI via SSH', () => {
  let client: McpClient;
  let capiAvailable: boolean;

  const WPE_SITE_NAME = process.env.NEXUS_E2E_WPE_SITE ?? 'nexus-test-site';
  let installName: string | null = null;
  let remoteAvailable = false;

  beforeAll(async () => {
    client = getClient();
    const env = deserializeEnvironment();
    capiAvailable = env.capiAvailable;

    if (!capiAvailable) {
      console.log('[Remote WP-CLI] CAPI not available — skipping remote WP-CLI tests');
      return;
    }

    // Verify the WPE-linked site exists in Local
    const siteResult = await client.callTool('local_get_site', { site: WPE_SITE_NAME });
    if (siteResult.isError) {
      console.log(`[Remote WP-CLI] Site "${WPE_SITE_NAME}" not found — skipping`);
      return;
    }

    // Discover the install name via wpe_get_installs
    const installsResult = await client.callTool('wpe_get_installs');
    if (installsResult.isError) {
      console.log('[Remote WP-CLI] Could not list WPE installs');
      return;
    }

    // Parse install list to find the matching install name
    const installsText = resultText(installsResult);
    const siteSlug = WPE_SITE_NAME.replace(/-/g, '').toLowerCase();
    const lines = installsText.split('\n');

    for (const line of lines) {
      // Extract install name from output (format: "- **installname** (ID: xxx, ...)")
      // Strip markdown bold markers (**) from the captured name
      const nameMatch = line.match(/^-\s+\*{0,2}(\S+?)\*{0,2}\s+\(ID:/);
      if (nameMatch && line.toLowerCase().replace(/-/g, '').includes(siteSlug)) {
        installName = nameMatch[1].replace(/\*/g, '').trim();
        break;
      }
    }

    // Fallback: try matching 'nexus' in the line
    if (!installName) {
      for (const line of lines) {
        const nameMatch = line.match(/^-\s+\*{0,2}(\S+?)\*{0,2}\s+\(ID:/);
        if (nameMatch && line.toLowerCase().includes('nexus')) {
          installName = nameMatch[1].replace(/\*/g, '').trim();
          break;
        }
      }
    }

    if (installName) {
      remoteAvailable = true;
      console.log(`[Remote WP-CLI] Using install_name "${installName}" for remote tests`);
    } else {
      console.log(`[Remote WP-CLI] Could not find install name for "${WPE_SITE_NAME}"`);
    }
  }, 60000);

  // -------------------------------------------------------------------------
  // Read-only remote WP-CLI commands
  // -------------------------------------------------------------------------

  it('wp_core_version with install_name returns remote WP version', async () => {
    if (!remoteAvailable) return;

    const result = await client.callTool('wp_core_version', {
      install_name: installName,
    });

    const text = resultText(result);

    // SSH may fail if SSH key isn't set up — skip gracefully
    if (result.isError && text.match(/ssh|key|connect|timeout|refused/i)) {
      console.log(`[Remote WP-CLI] SSH not available: ${text.slice(0, 100)}`);
      return;
    }

    expectSuccess(result);
    expect(text).toMatch(/WordPress \d+\.\d+/);
  }, 60000);

  it('wp_plugin_list with install_name returns remote plugins', async () => {
    if (!remoteAvailable) return;

    const result = await client.callTool('wp_plugin_list', {
      install_name: installName,
    });

    const text = resultText(result);

    if (result.isError && text.match(/ssh|key|connect|timeout|refused/i)) {
      console.log(`[Remote WP-CLI] SSH not available: ${text.slice(0, 100)}`);
      return;
    }

    expectSuccess(result);
    // Should contain plugin list with version numbers
    expect(text).toMatch(/Plugins?\s*\(\d+\)/i);
  }, 60000);

  it('wp_theme_list with install_name returns remote themes', async () => {
    if (!remoteAvailable) return;

    const result = await client.callTool('wp_theme_list', {
      install_name: installName,
    });

    const text = resultText(result);

    if (result.isError && text.match(/ssh|key|connect|timeout|refused/i)) {
      console.log(`[Remote WP-CLI] SSH not available: ${text.slice(0, 100)}`);
      return;
    }

    expectSuccess(result);
    expect(text).toMatch(/Themes?\s*\(\d+\)/i);
  }, 60000);

  it('wp_user_list with install_name returns remote users', async () => {
    if (!remoteAvailable) return;

    const result = await client.callTool('wp_user_list', {
      install_name: installName,
    });

    const text = resultText(result);

    if (result.isError && text.match(/ssh|key|connect|timeout|refused/i)) {
      console.log(`[Remote WP-CLI] SSH not available: ${text.slice(0, 100)}`);
      return;
    }

    expectSuccess(result);
    expect(text).toMatch(/Users?\s*\(\d+\)/i);
  }, 60000);

  it('wp_option_get with install_name returns remote option', async () => {
    if (!remoteAvailable) return;

    const result = await client.callTool('wp_option_get', {
      install_name: installName,
      option: 'blogname',
    });

    const text = resultText(result);

    if (result.isError && text.match(/ssh|key|connect|timeout|refused/i)) {
      console.log(`[Remote WP-CLI] SSH not available: ${text.slice(0, 100)}`);
      return;
    }

    expectSuccess(result);
    expect(text).toMatch(/blogname:/i);
  }, 60000);

  // -------------------------------------------------------------------------
  // Write operations — remote plugin management
  // -------------------------------------------------------------------------

  describe('Remote plugin management', () => {
    const TEST_PLUGIN = 'hello-dolly';
    let sshAvailable = false;

    beforeAll(async () => {
      if (!remoteAvailable) return;

      // Quick SSH check: if reads worked, SSH is available
      const probe = await client.callTool('wp_core_version', {
        install_name: installName,
      });
      if (!probe.isError) {
        sshAvailable = true;
      } else {
        console.log('[Remote WP-CLI] SSH not available — skipping write tests');
      }
    }, 60000);

    afterAll(async () => {
      if (!sshAvailable) return;

      // Cleanup: deactivate the test plugin (hello-dolly is harmless if left installed)
      try {
        await client.callTool('wp_plugin_deactivate', {
          install_name: installName,
          slug: TEST_PLUGIN,
        });
      } catch { /* already inactive or not installed */ }
    }, 60000);

    it('wp_plugin_install installs a plugin on remote WPE', async () => {
      if (!sshAvailable) return;

      const result = await client.callTool('wp_plugin_install', {
        install_name: installName,
        slug: TEST_PLUGIN,
      });
      expectSuccess(result);

      const text = resultText(result).toLowerCase();
      expect(text).toMatch(/installed/);
    }, 60000);

    it('wp_plugin_list shows newly installed plugin on remote', async () => {
      if (!sshAvailable) return;

      const result = await client.callTool('wp_plugin_list', {
        install_name: installName,
      });
      expectSuccess(result);

      const text = resultText(result).toLowerCase();
      expect(text).toContain('hello');
    }, 60000);

    it('wp_plugin_activate activates plugin on remote WPE', async () => {
      if (!sshAvailable) return;

      const result = await client.callTool('wp_plugin_activate', {
        install_name: installName,
        slug: TEST_PLUGIN,
      });
      expectSuccess(result);

      const text = resultText(result).toLowerCase();
      expect(text).toMatch(/activated/);
    }, 60000);

    it('wp_plugin_deactivate deactivates plugin on remote WPE', async () => {
      if (!sshAvailable) return;

      const result = await client.callTool('wp_plugin_deactivate', {
        install_name: installName,
        slug: TEST_PLUGIN,
      });
      expectSuccess(result);

      const text = resultText(result).toLowerCase();
      expect(text).toMatch(/deactivated/);
    }, 60000);

    it('wp_plugin_install with invalid slug returns error on remote', async () => {
      if (!sshAvailable) return;

      const result = await client.callTool('wp_plugin_install', {
        install_name: installName,
        slug: 'this-plugin-does-not-exist-12345-zzz',
      });
      expect(result.isError).toBe(true);
    }, 60000);
  });

  // -------------------------------------------------------------------------
  // Error cases
  // -------------------------------------------------------------------------

  it('wp_plugin_list with no site or install_name returns error', async () => {
    const result = await client.callTool('wp_plugin_list', {});

    expect(result.isError).toBe(true);
    expect(resultText(result).toLowerCase()).toMatch(/required/);
  });

  it('wp_core_version with nonexistent install_name returns SSH error', async () => {
    if (!capiAvailable) return;

    const result = await client.callTool('wp_core_version', {
      install_name: 'nonexistent-install-xyz-9999',
    });

    // Should fail with an SSH connection error (not a crash)
    expect(result.isError).toBe(true);
  }, 60000);
});
