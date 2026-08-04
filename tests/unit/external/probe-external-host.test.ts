import { resolveSshConfig } from '../../../src/main/external/sshExec';
import type { SshExec } from '../../../src/main/external/sshExec';

const ok = (stdout: string) => ({ code: 0, stdout, stderr: '' });

function execReturning(stdout: string, seen: string[][] = []): SshExec {
  return async (args) => { seen.push(args); return ok(stdout); };
}

const SSH_G_OUTPUT = [
  'host example',
  'user deploy',
  'hostname 203.0.113.10',
  'port 2222',
  'identityfile ~/.ssh/id_ed25519',
].join('\n');

describe('resolveSshConfig', () => {
  it('parses hostname, user and port from ssh -G', async () => {
    const cfg = await resolveSshConfig('example', execReturning(SSH_G_OUTPUT));
    expect(cfg).toEqual({ hostname: '203.0.113.10', user: 'deploy', port: '2222' });
  });

  it('invokes ssh -G <alias> and nothing else', async () => {
    const seen: string[][] = [];
    await resolveSshConfig('example', execReturning(SSH_G_OUTPUT, seen));
    expect(seen).toEqual([['-G', 'example']]);
  });

  it('is case-insensitive on keys, as ssh -G output can vary', async () => {
    const cfg = await resolveSshConfig('example', execReturning('HostName 10.0.0.1\nUser bob\nPort 22'));
    expect(cfg).toEqual({ hostname: '10.0.0.1', user: 'bob', port: '22' });
  });

  it('falls back to the alias and sane defaults when ssh -G yields nothing', async () => {
    const cfg = await resolveSshConfig('example', async () => ({ code: 255, stdout: '', stderr: 'boom' }));
    expect(cfg).toEqual({ hostname: 'example', user: '', port: '22' });
  });
});
