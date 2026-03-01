import { getToolSafety, TIER_OVERRIDES, CONFIRMATION_MESSAGES, PRE_CHECKS, ConfirmationManager, SafetyTier } from '../../src/main/mcp/safety';

describe('Safety Tiers', () => {
  describe('TIER_OVERRIDES', () => {
    test('all Tier 1 tools are read-only', () => {
      const tier1Tools = Object.entries(TIER_OVERRIDES)
        .filter(([, tier]) => tier === 1)
        .map(([name]) => name);

      expect(tier1Tools).toContain('local_list_sites');
      expect(tier1Tools).toContain('local_get_site');
      expect(tier1Tools).toContain('wp_plugin_list');
      expect(tier1Tools).toContain('wp_theme_list');
      expect(tier1Tools).toContain('wp_core_version');
      expect(tier1Tools).toContain('wp_user_list');
      expect(tier1Tools).toContain('wp_option_get');
      expect(tier1Tools).toContain('wp_site_health');
      expect(tier1Tools).toContain('wpe_get_accounts');
      expect(tier1Tools).toContain('wpe_get_installs');
      expect(tier1Tools).toContain('wpe_get_install');
      expect(tier1Tools).toContain('local_wpe_link');
      expect(tier1Tools).toContain('nexus_list_sites');
    });

    test('Tier 3 tools are destructive', () => {
      const tier3Tools = Object.entries(TIER_OVERRIDES)
        .filter(([, tier]) => tier === 3)
        .map(([name]) => name);

      expect(tier3Tools).toContain('local_delete_site');
      expect(tier3Tools).toContain('local_wpe_push');
    });

    test('site management tools are Tier 2', () => {
      expect(TIER_OVERRIDES['local_start_site']).toBe(2);
      expect(TIER_OVERRIDES['local_stop_site']).toBe(2);
      expect(TIER_OVERRIDES['local_restart_site']).toBe(2);
      expect(TIER_OVERRIDES['local_create_site']).toBe(2);
      expect(TIER_OVERRIDES['local_clone_site']).toBe(2);
      expect(TIER_OVERRIDES['local_export_site']).toBe(2);
    });

    test('WP-CLI modification tools are Tier 2', () => {
      expect(TIER_OVERRIDES['wp_plugin_install']).toBe(2);
      expect(TIER_OVERRIDES['wp_plugin_activate']).toBe(2);
      expect(TIER_OVERRIDES['wp_plugin_deactivate']).toBe(2);
      expect(TIER_OVERRIDES['wp_plugin_update']).toBe(2);
      expect(TIER_OVERRIDES['wp_db_export']).toBe(2);
      expect(TIER_OVERRIDES['wp_search_replace']).toBe(2);
    });
  });

  describe('getToolSafety', () => {
    test('returns Tier 1 for read-only tools', () => {
      const safety = getToolSafety('local_list_sites');
      expect(safety.tier).toBe(1);
      expect(safety.confirmationMessage).toBeUndefined();
      expect(safety.preChecks).toBeUndefined();
    });

    test('returns Tier 2 for modify tools', () => {
      const safety = getToolSafety('local_start_site');
      expect(safety.tier).toBe(2);
      expect(safety.confirmationMessage).toBeUndefined();
    });

    test('returns Tier 3 with confirmation for destructive tools', () => {
      const safety = getToolSafety('local_delete_site');
      expect(safety.tier).toBe(3);
      expect(safety.confirmationMessage).toBeDefined();
      expect(safety.preChecks).toBeDefined();
    });

    test('defaults to Tier 2 for unknown tools', () => {
      const safety = getToolSafety('some_unknown_tool');
      expect(safety.tier).toBe(2);
    });

    test('Tier 3 tools always have confirmation messages', () => {
      const tier3Tools = Object.entries(TIER_OVERRIDES)
        .filter(([, tier]) => tier === 3)
        .map(([name]) => name);

      for (const tool of tier3Tools) {
        const safety = getToolSafety(tool);
        expect(safety.confirmationMessage).toBeDefined();
        expect(typeof safety.confirmationMessage).toBe('string');
      }
    });
  });

  describe('CONFIRMATION_MESSAGES', () => {
    test('local_delete_site has a message', () => {
      expect(CONFIRMATION_MESSAGES['local_delete_site']).toMatch(/permanently delete/i);
    });

    test('local_wpe_push has a message', () => {
      expect(CONFIRMATION_MESSAGES['local_wpe_push']).toMatch(/overwrite/i);
    });
  });

  describe('PRE_CHECKS', () => {
    test('local_delete_site has pre-checks', () => {
      expect(PRE_CHECKS['local_delete_site']).toBeDefined();
      expect(PRE_CHECKS['local_delete_site'].length).toBeGreaterThan(0);
    });

    test('local_wpe_push has pre-checks', () => {
      expect(PRE_CHECKS['local_wpe_push']).toBeDefined();
      expect(PRE_CHECKS['local_wpe_push'].length).toBeGreaterThan(0);
    });
  });
});

describe('ConfirmationManager', () => {
  let manager: ConfirmationManager;

  beforeEach(() => {
    manager = new ConfirmationManager();
  });

  test('generate returns a hex token', () => {
    const token = manager.generate('local_delete_site', { siteId: '123' });
    expect(token).toMatch(/^[a-f0-9]{32}$/);
  });

  test('validate succeeds with correct token, tool, and params', () => {
    const token = manager.generate('local_delete_site', { siteId: '123' });
    const error = manager.validate(token, 'local_delete_site', { siteId: '123' });
    expect(error).toBeNull();
  });

  test('token is single-use (consumed on validation)', () => {
    const token = manager.generate('local_delete_site', { siteId: '123' });
    manager.validate(token, 'local_delete_site', { siteId: '123' });
    const error = manager.validate(token, 'local_delete_site', { siteId: '123' });
    expect(error).toMatch(/invalid/i);
  });

  test('rejects invalid token', () => {
    const error = manager.validate('bogus', 'local_delete_site', {});
    expect(error).toMatch(/invalid/i);
  });

  test('rejects token for wrong tool', () => {
    const token = manager.generate('local_delete_site', { siteId: '123' });
    const error = manager.validate(token, 'local_wpe_push', { siteId: '123' });
    expect(error).toMatch(/different tool/i);
  });

  test('rejects token when params changed', () => {
    const token = manager.generate('local_delete_site', { siteId: '123' });
    const error = manager.validate(token, 'local_delete_site', { siteId: '456' });
    expect(error).toMatch(/parameters changed/i);
  });

  test('strips _confirmationToken from stored params', () => {
    const token = manager.generate('local_delete_site', {
      siteId: '123',
      _confirmationToken: 'should-be-stripped',
    });
    // Validate with the clean params (without _confirmationToken)
    const error = manager.validate(token, 'local_delete_site', { siteId: '123' });
    expect(error).toBeNull();
  });

  test('param comparison is order-independent', () => {
    const token = manager.generate('local_delete_site', { a: '1', b: '2' });
    const error = manager.validate(token, 'local_delete_site', { b: '2', a: '1' });
    expect(error).toBeNull();
  });

  test('expired token is rejected', () => {
    const token = manager.generate('local_delete_site', { siteId: '123' });

    // Manually expire it by reaching into internals via time manipulation
    const now = Date.now();
    jest.spyOn(Date, 'now').mockReturnValue(now + 6 * 60 * 1000); // 6 minutes later

    const error = manager.validate(token, 'local_delete_site', { siteId: '123' });
    expect(error).toMatch(/expired/i);

    (Date.now as jest.Mock).mockRestore();
  });

  test('pendingCount tracks active tokens', () => {
    expect(manager.pendingCount).toBe(0);
    manager.generate('local_delete_site', { siteId: '1' });
    expect(manager.pendingCount).toBe(1);
    manager.generate('local_wpe_push', { siteId: '2' });
    expect(manager.pendingCount).toBe(2);
  });
});
