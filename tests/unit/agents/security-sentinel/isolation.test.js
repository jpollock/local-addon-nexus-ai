'use strict';

// Source-of-truth guard for the #6/#7 sandbox-isolation work, so a future edit
// can't silently remove it. Static assertions on the merged agent source.
const fs = require('fs');
const path = require('path');
const src = fs.readFileSync(
  path.join(__dirname, '../../../../agents/security-sentinel/agent.js'), 'utf8'
);

describe('Sandbox isolation (#6/#7) present in source of truth', () => {
  it('#7: registers the sandbox with the tool provider before scanning', () => {
    expect(src).toContain('registerSandbox(sandboxName)');
  });

  it('#6a: disables raw socket/exec functions via the loaded php.ini path', () => {
    expect(src).toContain('php_ini_loaded_file()');
    expect(src).toContain('disable_functions = fsockopen');
  });

  it('#6b: blocks the WordPress HTTP layer with an allowlist', () => {
    expect(src).toContain('WP_HTTP_BLOCK_EXTERNAL');
    expect(src).toContain('WP_ACCESSIBLE_HOSTS');
  });

  it('isolation allowlist keeps the endpoints core-restore/diff need reachable', () => {
    // CHK-01 restore + runCoreDiff fetch from these; isolation must not sever them
    expect(src).toContain('api.wordpress.org');
    expect(src).toContain('core.svn.wordpress.org');
    expect(src).toContain('downloads.wordpress.org');
  });

  it('isolation is applied before the filesystem checks begin', () => {
    const iIsolation = src.indexOf('php_ini_loaded_file()');
    const iFsChecks = src.indexOf('Running filesystem checks');
    expect(iIsolation).toBeGreaterThan(-1);
    expect(iFsChecks).toBeGreaterThan(-1);
    expect(iIsolation).toBeLessThan(iFsChecks);
  });
});
