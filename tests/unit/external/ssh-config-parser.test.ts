import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { listSshConfigHosts } from '../../../src/main/external/sshConfigParser';

function makeHomeDir(files: Record<string, string>): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'nexus-ssh-config-test-'));
  const sshDir = path.join(dir, '.ssh');
  fs.mkdirSync(sshDir, { recursive: true });
  for (const [rel, content] of Object.entries(files)) {
    const full = path.join(sshDir, rel);
    fs.mkdirSync(path.dirname(full), { recursive: true });
    fs.writeFileSync(full, content);
  }
  return dir;
}

describe('listSshConfigHosts', () => {
  it('parses a single Host block', () => {
    const home = makeHomeDir({
      config: 'Host myhost\n  HostName 203.0.113.10\n  User deploy\n  Port 2222\n',
    });
    const hosts = listSshConfigHosts(null, home);
    expect(hosts).toEqual([
      { alias: 'myhost', hostname: '203.0.113.10', user: 'deploy', port: '2222', identityFile: undefined, proxyJump: undefined, alreadyRegistered: false },
    ]);
  });

  it('resolves IdentityFile and ProxyJump when present', () => {
    const home = makeHomeDir({
      config: 'Host jumped\n  HostName 10.0.0.5\n  User bob\n  IdentityFile ~/.ssh/id_ed25519\n  ProxyJump bastion\n',
    });
    const hosts = listSshConfigHosts(null, home);
    expect(hosts[0].identityFile).toBe(path.join(home, '.ssh', 'id_ed25519'));
    expect(hosts[0].proxyJump).toBe('bastion');
  });

  it('splits a multi-pattern Host line into separate aliases', () => {
    const home = makeHomeDir({
      config: 'Host prod prod-backup\n  HostName 198.51.100.1\n  User root\n',
    });
    const hosts = listSshConfigHosts(null, home);
    expect(hosts.map((h) => h.alias).sort()).toEqual(['prod', 'prod-backup']);
  });

  it('excludes wildcard and negated patterns — a Host * block is not an alias', () => {
    const home = makeHomeDir({
      config: 'Host *\n  ServerAliveInterval 60\n\nHost real-one\n  HostName 1.2.3.4\n  User u\n\nHost !excluded\n  HostName 5.6.7.8\n  User u\n',
    });
    const hosts = listSshConfigHosts(null, home);
    expect(hosts.map((h) => h.alias)).toEqual(['real-one']);
  });

  it('follows a relative Include directive', () => {
    const home = makeHomeDir({
      config: 'Include config.d/*\n',
      'config.d/nexus': 'Host included-host\n  HostName 9.9.9.9\n  User u\n',
    });
    const hosts = listSshConfigHosts(null, home);
    expect(hosts.map((h) => h.alias)).toEqual(['included-host']);
  });

  it('follows a nested Include (an included file that itself includes another)', () => {
    const home = makeHomeDir({
      config: 'Include level1\n',
      level1: 'Include level2\n',
      level2: 'Host deep\n  HostName 1.1.1.1\n  User u\n',
    });
    const hosts = listSshConfigHosts(null, home);
    expect(hosts.map((h) => h.alias)).toEqual(['deep']);
  });

  it('does not infinite-loop on a cyclic Include', () => {
    const home = makeHomeDir({
      config: 'Include cycle-a\n',
      'cycle-a': 'Include cycle-b\nHost from-a\n  HostName 1.1.1.1\n  User u\n',
      'cycle-b': 'Include cycle-a\nHost from-b\n  HostName 2.2.2.2\n  User u\n',
    });
    const hosts = listSshConfigHosts(null, home);
    expect(hosts.map((h) => h.alias).sort()).toEqual(['from-a', 'from-b']);
  });

  it('expands a glob Include pattern to every matching file', () => {
    const home = makeHomeDir({
      config: 'Include config.d/*.conf\n',
      'config.d/a.conf': 'Host from-a-conf\n  HostName 1.1.1.1\n  User u\n',
      'config.d/b.conf': 'Host from-b-conf\n  HostName 2.2.2.2\n  User u\n',
      'config.d/ignored.txt': 'Host should-not-appear\n  HostName 3.3.3.3\n  User u\n',
    });
    const hosts = listSshConfigHosts(null, home);
    expect(hosts.map((h) => h.alias).sort()).toEqual(['from-a-conf', 'from-b-conf']);
  });

  it('returns an empty array when ~/.ssh/config does not exist', () => {
    const home = fs.mkdtempSync(path.join(os.tmpdir(), 'nexus-ssh-config-test-empty-'));
    expect(listSshConfigHosts(null, home)).toEqual([]);
  });

  it('marks a host alreadyRegistered when the graph has an active row for it', () => {
    const home = makeHomeDir({
      config: 'Host known\n  HostName 1.1.1.1\n  User u\n\nHost unknown\n  HostName 2.2.2.2\n  User u\n',
    });
    const fakeDb = {
      prepare: () => ({
        all: () => [{ account_id: 'known' }],
      }),
    };
    const hosts = listSshConfigHosts(fakeDb as any, home);
    expect(hosts.find((h) => h.alias === 'known')?.alreadyRegistered).toBe(true);
    expect(hosts.find((h) => h.alias === 'unknown')?.alreadyRegistered).toBe(false);
  });

  it('a graphDb query error is non-fatal — every host reports alreadyRegistered: false', () => {
    const home = makeHomeDir({ config: 'Host x\n  HostName 1.1.1.1\n  User u\n' });
    const throwingDb = { prepare: () => { throw new Error('db not ready'); } };
    const hosts = listSshConfigHosts(throwingDb as any, home);
    expect(hosts[0].alreadyRegistered).toBe(false);
  });
});
