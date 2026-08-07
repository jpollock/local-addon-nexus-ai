import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import * as crypto from 'crypto';
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
    return jest.fn(async () => ({ code, stdout, stderr: '' }));
  }

  // Most of these tests exercise the ssh-keygen-spawning path, which only
  // runs when userKnownHostsFile exists (see the dedicated "does not exist
  // yet" test below for the other branch) — so give them a real file.
  let existingKnownHostsFile: string;
  beforeEach(() => {
    existingKnownHostsFile = path.join(os.tmpdir(), `nexus-known-hosts-test-${crypto.randomUUID()}.tmp`);
    fs.writeFileSync(existingKnownHostsFile, '');
  });
  afterEach(() => {
    try { fs.unlinkSync(existingKnownHostsFile); } catch { /* already gone */ }
  });

  it('returns "none" when ssh-keygen -F finds no entry (documented exit code 1)', async () => {
    const status = await checkHostKeyStatus(existingKnownHostsFile, KEY_LINE, keygenExiting(1, ''));
    expect(status).toBe('none');
  });

  it('returns "trusted" when the existing entry has the same key material', async () => {
    const status = await checkHostKeyStatus(
      existingKnownHostsFile,
      KEY_LINE,
      keygenExiting(0, `# Host example.com found: line 3\n${KEY_LINE}\n`),
    );
    expect(status).toBe('trusted');
  });

  it('returns "conflict" when the existing entry has different key material', async () => {
    const differentKey = 'example.com ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAdifferentKeyMaterialHere';
    const status = await checkHostKeyStatus(
      existingKnownHostsFile,
      KEY_LINE,
      keygenExiting(0, `# Host example.com found: line 3\n${differentKey}\n`),
    );
    expect(status).toBe('conflict');
  });

  it('looks up the bracketed [host]:port form from the captured rawLine, not a bare hostname', async () => {
    // OpenSSH stores non-default-port entries as `[host]:port` in known_hosts;
    // `ssh-keygen -F <bare-hostname>` misses them entirely (verified live).
    // The captured rawLine's own host token is already in whichever form ssh
    // itself considers correct, so that is what must be passed to -F.
    const bracketedLine = '[example.com]:2222 ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAIOMqqnkVzrm0SdG6UOoqKLsabgH5C9okWi0dh2l9GKJl';
    const keygenExec = keygenExiting(1, '');

    await checkHostKeyStatus(existingKnownHostsFile, bracketedLine, keygenExec);

    expect(keygenExec).toHaveBeenCalledWith(['-F', '[example.com]:2222', '-f', existingKnownHostsFile]);
  });

  it('detects a conflict against a bracketed non-default-port entry', async () => {
    const bracketedLine = '[example.com]:2222 ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAIOMqqnkVzrm0SdG6UOoqKLsabgH5C9okWi0dh2l9GKJl';
    const differentKey = '[example.com]:2222 ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAdifferentKeyMaterialHere';
    const status = await checkHostKeyStatus(
      existingKnownHostsFile,
      bracketedLine,
      keygenExiting(0, `# Host [example.com]:2222 found: line 1\n${differentKey}\n`),
    );
    expect(status).toBe('conflict');
  });

  it('returns "error" when the offered rawLine cannot be parsed', async () => {
    const keygenExec = keygenExiting(1, '');
    const status = await checkHostKeyStatus(existingKnownHostsFile, 'garbage', keygenExec);
    expect(status).toBe('error');
    expect(keygenExec).not.toHaveBeenCalled();
  });

  it('returns "error" when the keygen invocation throws (spawn failure)', async () => {
    const keygenExec = jest.fn(async () => { throw new Error('ENOENT: ssh-keygen not found'); });
    const status = await checkHostKeyStatus(existingKnownHostsFile, KEY_LINE, keygenExec);
    expect(status).toBe('error');
  });

  it('returns "error" when keygen resolves with a null exit code (e.g. missing binary)', async () => {
    const status = await checkHostKeyStatus(existingKnownHostsFile, KEY_LINE, keygenExiting(null, ''));
    expect(status).toBe('error');
  });

  it('returns "error" on an unexpected non-0/1 exit code rather than treating it as "not found"', async () => {
    const status = await checkHostKeyStatus(existingKnownHostsFile, KEY_LINE, keygenExiting(2, ''));
    expect(status).toBe('error');
  });

  it('returns "none" without spawning keygen when userKnownHostsFile does not exist yet', async () => {
    const missingFile = path.join(os.tmpdir(), `nexus-nonexistent-known-hosts-${Date.now()}`);
    expect(fs.existsSync(missingFile)).toBe(false);
    const keygenExec = keygenExiting(255, '');

    const status = await checkHostKeyStatus(missingFile, KEY_LINE, keygenExec);

    expect(status).toBe('none');
    expect(keygenExec).not.toHaveBeenCalled();
  });

  it('is not fooled by a leading @cert-authority marker shifting the key fields', async () => {
    const markedLine = `@cert-authority ${KEY_LINE}`;
    const status = await checkHostKeyStatus(
      existingKnownHostsFile,
      KEY_LINE,
      keygenExiting(0, `# Host example.com found: line 3\n${markedLine}\n`),
    );
    expect(status).toBe('trusted');
  });
});
