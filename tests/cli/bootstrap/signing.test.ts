import { generateKeyPairSync, sign } from 'node:crypto';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { verifyWithKeys, verifyTarballSignature, assertSignedTarball } from '../../../src/cli/bootstrap/signing';

function keypair() {
  const { publicKey, privateKey } = generateKeyPairSync('ed25519');
  return { pub: publicKey.export({ type: 'spki', format: 'pem' }) as string, priv: privateKey };
}

describe('verifyWithKeys — Ed25519 release signature verification (P0-3)', () => {
  it('accepts a signature produced by the matching private key', () => {
    const { pub, priv } = keypair();
    const data = Buffer.from('addon-tarball-bytes');
    const signature = sign(null, data, priv);
    expect(verifyWithKeys(data, signature, [pub])).toBe(true);
  });

  it('rejects a tampered payload (one byte flipped)', () => {
    const { pub, priv } = keypair();
    const signature = sign(null, Buffer.from('original-bytes'), priv);
    expect(verifyWithKeys(Buffer.from('tampered-bytes'), signature, [pub])).toBe(false);
  });

  it('rejects a signature from a different key', () => {
    const a = keypair();
    const b = keypair();
    const data = Buffer.from('x');
    const signature = sign(null, data, a.priv);
    expect(verifyWithKeys(data, signature, [b.pub])).toBe(false);
  });

  it('accepts when ANY key in the array matches (supports rotation)', () => {
    const a = keypair();
    const b = keypair();
    const data = Buffer.from('x');
    const signature = sign(null, data, b.priv);
    expect(verifyWithKeys(data, signature, [a.pub, b.pub])).toBe(true);
  });

  it('returns false on malformed signature bytes rather than throwing', () => {
    const { pub } = keypair();
    expect(verifyWithKeys(Buffer.from('x'), Buffer.alloc(10), [pub])).toBe(false);
  });
});

describe('verifyTarballSignature — wired to the embedded release public key', () => {
  it('rejects an invalid signature against the real embedded key (proves it is wired to a real key)', () => {
    expect(verifyTarballSignature(Buffer.from('data'), Buffer.alloc(64))).toBe(false);
  });
});

describe('assertSignedTarball — fail-closed gate before extraction (P0-3)', () => {
  let tmpDir: string;
  beforeEach(() => { tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'nexus-sig-')); });
  afterEach(() => { fs.rmSync(tmpDir, { recursive: true, force: true }); });

  it('passes for a validly signed tarball', () => {
    const { pub, priv } = keypair();
    const tarPath = path.join(tmpDir, 'addon.tgz');
    const sigPath = `${tarPath}.sig`;
    fs.writeFileSync(tarPath, Buffer.from('addon bytes'));
    fs.writeFileSync(sigPath, sign(null, fs.readFileSync(tarPath), priv));
    expect(() => assertSignedTarball(tarPath, sigPath, [pub])).not.toThrow();
  });

  it('throws when the signature file is missing (attacker omits the .sig)', () => {
    const { pub } = keypair();
    const tarPath = path.join(tmpDir, 'addon.tgz');
    fs.writeFileSync(tarPath, Buffer.from('addon bytes'));
    expect(() => assertSignedTarball(tarPath, `${tarPath}.sig`, [pub])).toThrow(/missing|unverified/i);
  });

  it('throws when the tarball was tampered after signing', () => {
    const { pub, priv } = keypair();
    const tarPath = path.join(tmpDir, 'addon.tgz');
    const sigPath = `${tarPath}.sig`;
    fs.writeFileSync(tarPath, Buffer.from('original bytes'));
    fs.writeFileSync(sigPath, sign(null, fs.readFileSync(tarPath), priv));
    fs.writeFileSync(tarPath, Buffer.from('tampered bytes')); // swap after signing
    expect(() => assertSignedTarball(tarPath, sigPath, [pub])).toThrow(/invalid|tampered/i);
  });
});
