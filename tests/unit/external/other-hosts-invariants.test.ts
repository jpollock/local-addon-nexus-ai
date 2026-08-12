import { EXTERNAL_SSH_TIMEOUT_MS, EXTERNAL_SSH_BATCH_TIMEOUT_MS, buildExternalSshArgs } from '../../../src/main/transport/ssh-args';

describe('external host invariants', () => {
  it('B3: both external schedulers cap concurrency at 3', () => {
    const fs = require('fs');
    for (const f of ['ExternalRefreshScheduler.ts', 'ExternalContentIndexScheduler.ts']) {
      const src = fs.readFileSync(`src/main/startup/${f}`, 'utf8');
      expect(src).toMatch(/const CONCURRENCY = 3/);
    }
  });

  it('B8: external timeouts exceed a single-command budget, because WP-CLI boots WordPress', () => {
    expect(EXTERNAL_SSH_BATCH_TIMEOUT_MS).toBeGreaterThan(EXTERNAL_SSH_TIMEOUT_MS);
    expect(EXTERNAL_SSH_TIMEOUT_MS).toBeGreaterThanOrEqual(20000);
  });

  it('password auth is impossible: BatchMode=yes on every external invocation', () => {
    expect(buildExternalSshArgs('boxa', 'echo hi')).toEqual(
      expect.arrayContaining(['-o', 'BatchMode=yes']),
    );
  });

  it('never -F /dev/null — it would break every ProxyJump and read as a network fault', () => {
    expect(buildExternalSshArgs('boxa', 'echo hi').join(' ')).not.toContain('/dev/null');
  });

  it('external bulk ops resolve with the read-only capability token', () => {
    const src = require('fs').readFileSync('src/main/bulk/externalBulkOps.ts', 'utf8');
    expect(src).toContain("'wpcli_read'");
  });
});
