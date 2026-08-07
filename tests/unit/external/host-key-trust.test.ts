import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { captureOfferedHostKey, trustHostKey, checkHostKeyStatus } from '../../../src/main/external/hostKeyTrust';
import type { SshExec } from '../../../src/main/external/sshExec';

const KEY_LINE = 'example.com ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAIOMqqnkVzrm0SdG6UOoqKLsabgH5C9okWi0dh2l9GKJl';

/** Simulates the real capture invocation: writes KEY_LINE to whichever temp
 * file appears in the argv's UserKnownHostsFile= option, mirroring what a
 * real `ssh -o StrictHostKeyChecking=accept-new -o UserKnownHostsFile=<f>`
 * does on success. */
function execWriting(line: string | null): SshExec {
  return async (args) => {
    const opt = args.find((a) => a.startsWith('UserKnownHostsFile='));
    if (line !== null && opt) {
      fs.writeFileSync(opt.slice('UserKnownHostsFile='.length), line + '\n');
    }
    return { code: 0, stdout: '', stderr: '' };
  };
}

function keygenReturning(stdout: string) {
  return async () => ({ code: 0, stdout, stderr: '' });
}

describe('captureOfferedHostKey', () => {
  it('returns the fingerprint, key type and raw line on success', async () => {
    const result = await captureOfferedHostKey(
      'example', execWriting(KEY_LINE),
      keygenReturning('256 SHA256:+DiY3wvvV6TuJJhbpZisF/zLDA0zPMSvHdkr4UvCOqU example.com (ED25519)'),
    );
    expect(result).toEqual({
      fingerprint: 'SHA256:+DiY3wvvV6TuJJhbpZisF/zLDA0zPMSvHdkr4UvCOqU',
      keyType: 'ED25519',
      rawLine: KEY_LINE,
    });
  });

  it('returns null when no key was ever written (host unreachable)', async () => {
    const result = await captureOfferedHostKey('example', execWriting(null), keygenReturning(''));
    expect(result).toBeNull();
  });

  it('returns null when ssh-keygen output cannot be parsed', async () => {
    const result = await captureOfferedHostKey('example', execWriting(KEY_LINE), keygenReturning('garbage'));
    expect(result).toBeNull();
  });

  it('cleans up its temp file whether it succeeds or fails', async () => {
    const seenPaths: string[] = [];
    const exec: SshExec = async (args) => {
      const opt = args.find((a) => a.startsWith('UserKnownHostsFile='))!;
      const p = opt.slice('UserKnownHostsFile='.length);
      seenPaths.push(p);
      fs.writeFileSync(p, KEY_LINE + '\n');
      return { code: 0, stdout: '', stderr: '' };
    };
    await captureOfferedHostKey('example', exec,
      keygenReturning('256 SHA256:abc example.com (ED25519)'));
    expect(seenPaths).toHaveLength(1);
    expect(fs.existsSync(seenPaths[0])).toBe(false);
  });

  it('rejects an unsafe alias before any exec runs', async () => {
    const exec = jest.fn();
    await expect(captureOfferedHostKey('-oProxyCommand=evil', exec as any, keygenReturning('')))
      .rejects.toThrow(/Invalid SSH host alias/);
    expect(exec).not.toHaveBeenCalled();
  });
});

describe('trustHostKey', () => {
  let dir: string;
  beforeEach(() => { dir = fs.mkdtempSync(path.join(os.tmpdir(), 'nexus-known-hosts-test-')); });
  afterEach(() => { fs.rmSync(dir, { recursive: true, force: true }); });

  it('appends the line to an existing file', () => {
    const file = path.join(dir, 'known_hosts');
    fs.writeFileSync(file, 'existing-host ssh-ed25519 AAAA...\n');
    trustHostKey(file, KEY_LINE);
    const content = fs.readFileSync(file, 'utf-8');
    expect(content).toBe(`existing-host ssh-ed25519 AAAA...\n${KEY_LINE}\n`);
  });

  it('creates the file and parent directory when neither exists', () => {
    const file = path.join(dir, 'nested', '.ssh', 'known_hosts');
    trustHostKey(file, KEY_LINE);
    expect(fs.readFileSync(file, 'utf-8')).toBe(`${KEY_LINE}\n`);
  });
});

describe('checkHostKeyStatus', () => {
  function keygenExiting(code: number | null, stdout = '') {
    return async () => ({ code, stdout, stderr: '' });
  }

  it('returns "none" when ssh-keygen -F finds no entry (non-zero exit)', async () => {
    const status = await checkHostKeyStatus('/home/u/.ssh/known_hosts', 'example.com', KEY_LINE, keygenExiting(1, ''));
    expect(status).toBe('none');
  });

  it('returns "trusted" when the existing entry has the same key material', async () => {
    const status = await checkHostKeyStatus(
      '/home/u/.ssh/known_hosts',
      'example.com',
      KEY_LINE,
      keygenExiting(0, `# Host example.com found: line 3\n${KEY_LINE}\n`),
    );
    expect(status).toBe('trusted');
  });

  it('returns "conflict" when the existing entry has different key material', async () => {
    const differentKey = 'example.com ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAdifferentKeyMaterialHere';
    const status = await checkHostKeyStatus(
      '/home/u/.ssh/known_hosts',
      'example.com',
      KEY_LINE,
      keygenExiting(0, `# Host example.com found: line 3\n${differentKey}\n`),
    );
    expect(status).toBe('conflict');
  });
});
