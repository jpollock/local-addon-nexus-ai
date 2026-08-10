import * as fs from 'fs';
import * as path from 'path';
import { SSH_CONTROL_PERSIST } from '../../../src/main/mcp/utils/remoteFailure';

it('outlives a typical agent cadence, or the multiplexed socket never helps', () => {
  // A 30s persist against a 2-minute agent cadence means every scheduled call is cold. The point
  // of ControlMaster is that the second call is cheap; that only happens if the socket survives
  // the gap between calls.
  const seconds = Number(String(SSH_CONTROL_PERSIST).replace(/\D/g, ''));
  expect(seconds).toBeGreaterThanOrEqual(300);
});

it('both SSH builders use the shared constant, not their own literal', () => {
  for (const f of ['src/main/mcp/local-services-bridge.ts', 'src/main/sentinel/SentinelExecutor.ts']) {
    const src = fs.readFileSync(path.join(__dirname, '../../../', f), 'utf-8');
    expect(src).toContain('SSH_CONTROL_PERSIST');
    expect(src).not.toMatch(/ControlPersist=30s/);
    // Pin the interpolation itself — toContain('SSH_CONTROL_PERSIST') is satisfied by the
    // import line alone, so a file that imports but then hardcodes 'ControlPersist=45s' in
    // its argv would pass without this. Any hardcoded literal must fail, not just '30s'.
    expect(src).toMatch(/ControlPersist=\$\{SSH_CONTROL_PERSIST\}/);
  }
});
