const https = require('https');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const MODEL_DIR = path.join(__dirname, '..', 'models', 'all-MiniLM-L6-v2-quantized');
const BASE_URL = 'https://huggingface.co/sentence-transformers/all-MiniLM-L6-v2/resolve/main';

// Detect platform to pick the right quantized model. Each variant carries its pinned sha256 (the
// git-lfs oid from HuggingFace, verified against the shipped files) so a tampered mirror, a
// compromised HF object, or a blind R2 cache restore cannot substitute a different model (P1-5 #1).
const arch = process.arch; // 'arm64' or 'x64'
const modelSpec =
  arch === 'arm64'
    ? { file: 'onnx/model_qint8_arm64.onnx', sha256: '4278337fd0ff3c68bfb6291042cad8ab363e1d9fbc43dcb499fe91c871902474' }
    : { file: 'onnx/model_quint8_avx2.onnx', sha256: 'b941bf19f1f1283680f449fa6a7336bb5600bdcd5f84d10ddc5cd72218a0fd21' };

const FILES = [
  { url: `${BASE_URL}/${modelSpec.file}`, dest: 'model.onnx', sha256: modelSpec.sha256 },
  { url: `${BASE_URL}/vocab.txt`, dest: 'vocab.txt', sha256: '07eced375cec144d27c900241f3e339478dec958f92fddbc551f295c992038a3' },
  { url: `${BASE_URL}/tokenizer_config.json`, dest: 'tokenizer_config.json', sha256: 'acb92769e8195aabd29b7b2137a9e6d6e25c476a4f15aa4355c233426c61576b' },
];

function sha256File(p) {
  return crypto.createHash('sha256').update(fs.readFileSync(p)).digest('hex');
}

function verifyChecksum(destPath, expected) {
  const actual = sha256File(destPath);
  if (actual !== expected) {
    throw new Error(
      `Checksum mismatch for ${path.basename(destPath)}: expected ${expected}, got ${actual}. ` +
      `The downloaded model does not match its pinned hash — refusing to use it.`,
    );
  }
}

function download(url, destPath) {
  return new Promise((resolve, reject) => {
    const file = fs.createWriteStream(destPath);
    const request = (targetUrl) => {
      https.get(targetUrl, (res) => {
        if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
          let redirect = res.headers.location;
          // Handle relative redirects
          if (redirect.startsWith('/')) {
            const parsed = new URL(targetUrl);
            redirect = `${parsed.protocol}//${parsed.host}${redirect}`;
          }
          request(redirect);
          return;
        }
        if (res.statusCode !== 200) {
          reject(new Error(`HTTP ${res.statusCode} for ${targetUrl}`));
          return;
        }
        const total = parseInt(res.headers['content-length'] || '0', 10);
        let downloaded = 0;
        res.on('data', (chunk) => {
          downloaded += chunk.length;
          if (total > 0) {
            const pct = ((downloaded / total) * 100).toFixed(1);
            process.stdout.write(`\r  ${path.basename(destPath)}: ${pct}% (${(downloaded / 1e6).toFixed(1)} MB)`);
          }
        });
        res.pipe(file);
        file.on('finish', () => {
          file.close();
          console.log();
          resolve();
        });
      }).on('error', reject);
    };
    request(url);
  });
}

async function main() {
  fs.mkdirSync(MODEL_DIR, { recursive: true });

  for (const { url, dest, sha256 } of FILES) {
    const destPath = path.join(MODEL_DIR, dest);

    // An existing file is trusted only if it matches the pinned hash — a cached/tampered copy is
    // re-downloaded rather than used blindly.
    if (fs.existsSync(destPath)) {
      try {
        verifyChecksum(destPath, sha256);
        console.log(`  ${dest}: already exists (checksum OK), skipping`);
        continue;
      } catch {
        console.log(`  ${dest}: exists but checksum mismatch — re-downloading`);
        fs.rmSync(destPath, { force: true });
      }
    }

    console.log(`Downloading ${dest}...`);
    await download(url, destPath);
    try {
      verifyChecksum(destPath, sha256);
    } catch (err) {
      fs.rmSync(destPath, { force: true }); // never leave an unverified model on disk
      throw err;
    }
    console.log(`  ${dest}: checksum verified`);
  }

  console.log('\nModel files ready in models/all-MiniLM-L6-v2-quantized/');
}

module.exports = { sha256File, verifyChecksum, FILES };

if (require.main === module) {
  main().catch((err) => {
    console.error('Download failed:', err.message);
    process.exit(1);
  });
}
