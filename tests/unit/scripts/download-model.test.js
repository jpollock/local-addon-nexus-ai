const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');
const { sha256File, verifyChecksum, FILES } = require('../../../scripts/download-model');

describe('download-model checksum pinning (P1-5 #1)', () => {
  it('computes a correct sha256 and accepts a matching checksum', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'dlm-'));
    const f = path.join(dir, 'x');
    fs.writeFileSync(f, 'hello world');
    const known = crypto.createHash('sha256').update('hello world').digest('hex');

    expect(sha256File(f)).toBe(known);
    expect(() => verifyChecksum(f, known)).not.toThrow();
  });

  it('throws on a checksum mismatch — a tampered or substituted model', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'dlm-'));
    const f = path.join(dir, 'x');
    fs.writeFileSync(f, 'tampered bytes');
    expect(() => verifyChecksum(f, 'deadbeef')).toThrow(/mismatch/i);
  });

  it('pins a real 64-hex sha256 for every downloaded file (no placeholders)', () => {
    expect(FILES.length).toBeGreaterThan(0);
    for (const entry of FILES) {
      expect(entry.sha256).toMatch(/^[0-9a-f]{64}$/);
    }
  });

  // Pins the constants to reality: any shipped model file present on this machine must match its
  // pinned hash, so a hash typo can't slip through. (model.onnx is arch-specific — FILES already
  // carries this arch's variant.)
  it('the pinned hashes match the shipped model files, when present', () => {
    const modelDir = path.join(__dirname, '..', '..', '..', 'models', 'all-MiniLM-L6-v2-quantized');
    let checked = 0;
    for (const entry of FILES) {
      const p = path.join(modelDir, entry.dest);
      if (fs.existsSync(p)) {
        expect(sha256File(p)).toBe(entry.sha256);
        checked++;
      }
    }
    // Don't silently pass if the model dir is absent (e.g. a clean CI checkout) — just note it.
    if (checked === 0) console.warn('download-model.test: no local model files to verify hashes against');
  });
});
