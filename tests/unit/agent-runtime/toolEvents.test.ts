import { isMutatingTool, mutationTarget, MUTATING_TOOLS } from '../../../src/main/agent-runtime/toolEvents';

describe('isMutatingTool', () => {
  it('treats every Tier 3 destructive tool as a mutation', () => {
    for (const t of [
      'local_delete_site', 'local_wpe_push', 'clean_database_items', 'wpe_delete_account_user',
      'wpe_delete_site', 'wpe_delete_install', 'wpe_delete_domain', 'wpe_delete_ssh_key',
      'wpe_promote_environment',
    ]) {
      expect(isMutatingTool(t)).toBe(true);
    }
  });

  it('treats the site-changing Tier 2 tools as mutations', () => {
    for (const t of [
      'wp_core_update', 'wp_plugin_install', 'wp_plugin_update', 'wp_plugin_activate',
      'wp_plugin_deactivate', 'wp_search_replace', 'wp_eval', 'wp_post_update', 'wp_theme_activate',
      'local_wpe_pull', 'local_change_php_version', 'wpe_create_install', 'wpe_update_domain',
    ]) {
      expect(isMutatingTool(t)).toBe(true);
    }
  });

  it('does NOT call a read-only tool a mutation', () => {
    // The whole value of the word is that `grep mutation` answers "what changed". A read that
    // shows up there costs more than a write that does not — the write is still visible as a
    // tool.call, so under-labelling is recoverable and over-labelling is not.
    for (const t of [
      'wp_plugin_list', 'wp_user_list', 'wp_core_version', 'nexus_list_sites', 'fleet_overview',
      'get_site_health', 'search_site_content', 'wpe_get_installs', 'wp_site_health',
    ]) {
      expect(isMutatingTool(t)).toBe(false);
    }
  });

  it('does not treat an export or a usage refresh as a change to the thing exported', () => {
    // These produce an artifact or re-read a number; the site is the same afterwards.
    for (const t of ['wp_db_export', 'local_export_site', 'wpe_refresh_install_disk_usage', 'wpe_logout']) {
      expect(isMutatingTool(t)).toBe(false);
    }
  });

  it('says no for an unknown tool rather than guessing', () => {
    // Tier defaults to 2 for anything unlisted, so tier is not a mutation signal — using it would
    // label every unclassified read as a change.
    expect(isMutatingTool('some_future_tool')).toBe(false);
    expect(isMutatingTool('')).toBe(false);
  });

  it('has no duplicates and no read-only entries hiding in the list', () => {
    expect(MUTATING_TOOLS.size).toBeGreaterThan(30);
    expect(MUTATING_TOOLS.has('wp_plugin_list')).toBe(false);
  });
});

describe('mutationTarget', () => {
  it('reads the common site and install argument names', () => {
    expect(mutationTarget({ site: 'acfprod' })).toBe('acfprod');
    expect(mutationTarget({ siteName: 'acfprod' })).toBe('acfprod');
    expect(mutationTarget({ install_name: 'jeremypollock2' })).toBe('jeremypollock2');
    expect(mutationTarget({ installName: 'jeremypollock2' })).toBe('jeremypollock2');
    expect(mutationTarget({ siteId: 'abc-123' })).toBe('abc-123');
  });

  it('prefers the most specific name when several are present', () => {
    // A call carrying both is addressing the install; siteId is the coarser handle.
    expect(mutationTarget({ siteId: 'abc-123', site: 'acfprod' })).toBe('acfprod');
  });

  it('returns undefined rather than inventing a target', () => {
    // An absent target must read as absent. `target=unknown` would be indistinguishable from a
    // real install called "unknown", and fabricating one is worse than omitting the key.
    expect(mutationTarget({})).toBeUndefined();
    expect(mutationTarget(undefined)).toBeUndefined();
    expect(mutationTarget({ plugin: 'advanced-custom-fields' })).toBeUndefined();
  });

  it('ignores a non-string target', () => {
    expect(mutationTarget({ site: 42 as any })).toBeUndefined();
    expect(mutationTarget({ site: null as any })).toBeUndefined();
    expect(mutationTarget({ site: '   ' })).toBeUndefined();
  });
});
