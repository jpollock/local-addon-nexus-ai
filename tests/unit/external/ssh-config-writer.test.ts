import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import {
  detectCollision, previewHostBlock, writeHostBlock, generateHostKey,
} from '../../../src/main/external/sshConfigWriter';

function makeHomeDir(configText?: string): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'nexus-ssh-writer-test-'));
  fs.mkdirSync(path.join(dir, '.ssh'), { recursive: true });
  if (configText !== undefined) fs.writeFileSync(path.join(dir, '.ssh', 'config'), configText);
  return dir;
}

describe('detectCollision', () => {
  it('reports none for an alias that appears nowhere', () => {
    const home = makeHomeDir('Host other\n  HostName 1.1.1.1\n  User u\n');
    expect(detectCollision('newalias', home)).toEqual({ kind: 'none' });
  });

  it('reports an exact collision with file and line', () => {
    const home = makeHomeDir('Host taken\n  HostName 1.1.1.1\n  User u\n');
    const result = detectCollision('taken', home);
    expect(result.kind).toBe('exact');
    expect((result as any).file).toContain('config');
    expect((result as any).line).toBe(1);
  });

  it('reports a pattern collision, not an exact one, for a wildcard match', () => {
    const home = makeHomeDir('Host *\n  ServerAliveInterval 60\n');
    const result = detectCollision('anything', home);
    expect(result.kind).toBe('pattern');
    expect((result as any).pattern).toBe('*');
  });

  it('reports none when no config file exists yet', () => {
    const home = fs.mkdtempSync(path.join(os.tmpdir(), 'nexus-ssh-writer-test-empty-'));
    expect(detectCollision('anything', home)).toEqual({ kind: 'none' });
  });

  it('finds an exact collision even when a wildcard Host block appears earlier in the file', () => {
    const home = makeHomeDir('Host *\n  AddKeysToAgent yes\n\nHost taken\n  HostName 1.1.1.1\n  User u\n');
    const result = detectCollision('taken', home);
    expect(result.kind).toBe('exact');
  });

  it('refuses a second write of the same alias to config.d/nexus even before any Include line exists in the main config', () => {
    const home = makeHomeDir();
    writeHostBlock({
      alias: 'dup-host', hostname: '1.1.1.1', user: 'u', port: '22', identityFile: '/k',
    }, home);
    expect(() => writeHostBlock({
      alias: 'dup-host', hostname: '2.2.2.2', user: 'u', port: '22', identityFile: '/k',
    }, home)).toThrow(/already/i);
  });

  it('detects a collision with an alias defined only inside an Included file', () => {
    const home = makeHomeDir('Include config.d/*\n');
    fs.mkdirSync(path.join(home, '.ssh', 'config.d'), { recursive: true });
    fs.writeFileSync(path.join(home, '.ssh', 'config.d', 'other'), 'Host included-alias\n  HostName 9.9.9.9\n  User u\n');
    const result = detectCollision('included-alias', home);
    expect(result.kind).toBe('exact');
  });
});

describe('previewHostBlock', () => {
  it('renders the exact block that will be written, including IdentitiesOnly', () => {
    const text = previewHostBlock({
      alias: 'my-new-host', hostname: '203.0.113.10', user: 'deploy', port: '22',
      identityFile: '/home/u/.ssh/nexus_my-new-host',
    });
    expect(text).toBe(
      'Host my-new-host\n'
      + '  HostName 203.0.113.10\n'
      + '  User deploy\n'
      + '  Port 22\n'
      + '  IdentityFile /home/u/.ssh/nexus_my-new-host\n'
      + '  IdentitiesOnly yes\n',
    );
  });

  it('rejects an unsafe alias before rendering anything', () => {
    expect(() => previewHostBlock({
      alias: '-oProxyCommand=evil', hostname: 'h', user: 'u', port: '22', identityFile: '/k',
    })).toThrow(/Invalid SSH host alias/);
  });

  // A bare `IdentityFile`/`User`/`Port` directive with no value makes ssh
  // terminate parsing entirely -- verified against real ssh. Since Nexus's
  // Include line sits at the top of ~/.ssh/config, one such blank line would
  // break every subsequent ssh invocation the user makes, not just Nexus's.
  it('omits the IdentityFile and IdentitiesOnly lines entirely when identityFile is empty, rather than emitting a bare directive', () => {
    const text = previewHostBlock({
      alias: 'my-new-host', hostname: '203.0.113.10', user: 'deploy', port: '22', identityFile: '',
    });
    expect(text).toBe(
      'Host my-new-host\n'
      + '  HostName 203.0.113.10\n'
      + '  User deploy\n'
      + '  Port 22\n',
    );
    expect(text).not.toContain('IdentityFile');
    expect(text).not.toContain('IdentitiesOnly');
  });

  it('also omits IdentityFile when identityFile is undefined (widened optional type)', () => {
    const text = previewHostBlock({
      alias: 'my-new-host', hostname: '203.0.113.10', user: 'deploy', port: '22',
    });
    expect(text).not.toContain('IdentityFile');
    expect(text).not.toContain('IdentitiesOnly');
  });

  it('throws a clear error when hostname is missing, rather than writing a bare directive', () => {
    expect(() => previewHostBlock({
      alias: 'my-new-host', hostname: '', user: 'deploy', port: '22', identityFile: '/k',
    })).toThrow(/hostname is required/);
  });

  it('throws a clear error when user is missing, rather than writing a bare directive', () => {
    expect(() => previewHostBlock({
      alias: 'my-new-host', hostname: '203.0.113.10', user: '', port: '22', identityFile: '/k',
    })).toThrow(/user is required/);
  });

  it('throws a clear error when port is missing, rather than writing a bare directive', () => {
    expect(() => previewHostBlock({
      alias: 'my-new-host', hostname: '203.0.113.10', user: 'deploy', port: '', identityFile: '/k',
    })).toThrow(/port is required/);
  });
});

describe('writeHostBlock', () => {
  it('creates ~/.ssh/config.d/nexus and adds the Include line when neither exists', () => {
    const home = makeHomeDir();
    writeHostBlock({ alias: 'first-host', hostname: '1.1.1.1', user: 'u', port: '22', identityFile: '/k' }, home);

    const configText = fs.readFileSync(path.join(home, '.ssh', 'config'), 'utf-8');
    expect(configText).toContain('Include ~/.ssh/config.d/nexus');
    expect(configText.indexOf('Include')).toBe(0); // at the top

    const nexusText = fs.readFileSync(path.join(home, '.ssh', 'config.d', 'nexus'), 'utf-8');
    expect(nexusText).toContain('Host first-host');
  });

  it('adds the Include line only once across repeated writes', () => {
    const home = makeHomeDir();
    writeHostBlock({ alias: 'host-a', hostname: '1.1.1.1', user: 'u', port: '22', identityFile: '/k' }, home);
    writeHostBlock({ alias: 'host-b', hostname: '2.2.2.2', user: 'u', port: '22', identityFile: '/k' }, home);

    const configText = fs.readFileSync(path.join(home, '.ssh', 'config'), 'utf-8');
    expect(configText.match(/Include ~\/\.ssh\/config\.d\/nexus/g)?.length).toBe(1);

    const nexusText = fs.readFileSync(path.join(home, '.ssh', 'config.d', 'nexus'), 'utf-8');
    expect(nexusText).toContain('Host host-a');
    expect(nexusText).toContain('Host host-b');
  });

  it('preserves the rest of an existing ~/.ssh/config untouched, beyond adding the Include line', () => {
    const home = makeHomeDir('Host existing\n  HostName 9.9.9.9\n  User someone\n');
    writeHostBlock({ alias: 'new-one', hostname: '1.1.1.1', user: 'u', port: '22', identityFile: '/k' }, home);
    const configText = fs.readFileSync(path.join(home, '.ssh', 'config'), 'utf-8');
    expect(configText).toContain('Host existing');
    expect(configText).toContain('HostName 9.9.9.9');
  });

  it('refuses to write on an exact collision', () => {
    const home = makeHomeDir('Host taken\n  HostName 1.1.1.1\n  User u\n');
    expect(() => writeHostBlock({ alias: 'taken', hostname: '2.2.2.2', user: 'u', port: '22', identityFile: '/k' }, home))
      .toThrow(/already/i);
  });

  it('sets 0700 on config.d and 0600 on the nexus file', () => {
    const home = makeHomeDir();
    writeHostBlock({ alias: 'perm-test', hostname: '1.1.1.1', user: 'u', port: '22', identityFile: '/k' }, home);
    const dirMode = fs.statSync(path.join(home, '.ssh', 'config.d')).mode & 0o777;
    const fileMode = fs.statSync(path.join(home, '.ssh', 'config.d', 'nexus')).mode & 0o777;
    expect(dirMode).toBe(0o700);
    expect(fileMode).toBe(0o600);
  });
});

describe('generateHostKey', () => {
  let home: string;
  beforeEach(() => { home = makeHomeDir(); });
  afterEach(() => { fs.rmSync(home, { recursive: true, force: true }); });

  it('generates an ed25519 keypair with no passphrase, mode 0600 on the private key', () => {
    const result = generateHostKey('my-alias', home);
    expect(result.privateKeyPath).toBe(path.join(home, '.ssh', 'nexus_my-alias'));
    expect(fs.existsSync(result.privateKeyPath)).toBe(true);
    expect(fs.existsSync(`${result.privateKeyPath}.pub`)).toBe(true);
    expect(fs.statSync(result.privateKeyPath).mode & 0o777).toBe(0o600);
    expect(result.publicKeyLine).toMatch(/^ssh-ed25519 /);
  });

  it('rejects a path-traversal aliasSlug before touching the filesystem', () => {
    expect(() => generateHostKey('../../../etc/foo', home)).toThrow(/Invalid SSH host alias/);
  });
});
