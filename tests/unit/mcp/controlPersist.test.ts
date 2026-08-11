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

it('the SSH argv builder uses the shared constant, not its own literal', () => {
  // This used to name local-services-bridge.ts and SentinelExecutor.ts, because each built
  // its own ssh argv. Both now delegate to WpeSshTransport, so ssh-args.ts is the ONLY place
  // an argv is constructed — which is the state this test was pushing toward.
  const src = fs.readFileSync(path.join(__dirname, '../../../src/main/transport/ssh-args.ts'), 'utf-8');
  expect(src).toContain('SSH_CONTROL_PERSIST');
  // Pin the interpolation itself — toContain('SSH_CONTROL_PERSIST') is satisfied by the
  // import line alone, so a file that imports but then hardcodes 'ControlPersist=45s' in
  // its argv would pass without this. Any hardcoded literal must fail, not just '30s'.
  expect(src).toMatch(/ControlPersist=\$\{SSH_CONTROL_PERSIST\}/);
  expect(src).not.toMatch(/ControlPersist=\d+s/);
});

it('the old inline builders are gone, not merely updated', () => {
  // The reason the constant kept getting re-hardcoded was that three files built argv. If one
  // of them grows a `-o ControlPersist` line again, that is a fourth copy returning.
  for (const f of ['src/main/mcp/local-services-bridge.ts', 'src/main/sentinel/SentinelExecutor.ts']) {
    const src = fs.readFileSync(path.join(__dirname, '../../../', f), 'utf-8');
    expect(src).not.toMatch(/ControlPersist/);
  }
});
