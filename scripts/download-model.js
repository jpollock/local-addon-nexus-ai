const https = require('https');
const fs = require('fs');
const path = require('path');

const MODEL_DIR = path.join(__dirname, '..', 'models', 'all-MiniLM-L6-v2-quantized');
const BASE_URL = 'https://huggingface.co/sentence-transformers/all-MiniLM-L6-v2/resolve/main';

// Detect platform to pick the right quantized model
const arch = process.arch; // 'arm64' or 'x64'
const modelFile =
  arch === 'arm64' ? 'onnx/model_qint8_arm64.onnx' : 'onnx/model_quint8_avx2.onnx';

const FILES = [
  { url: `${BASE_URL}/${modelFile}`, dest: 'model.onnx' },
  { url: `${BASE_URL}/vocab.txt`, dest: 'vocab.txt' },
  { url: `${BASE_URL}/tokenizer_config.json`, dest: 'tokenizer_config.json' },
];

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

  for (const { url, dest } of FILES) {
    const destPath = path.join(MODEL_DIR, dest);
    if (fs.existsSync(destPath)) {
      console.log(`  ${dest}: already exists, skipping`);
      continue;
    }
    console.log(`Downloading ${dest}...`);
    await download(url, destPath);
  }

  console.log('\nModel files ready in models/all-MiniLM-L6-v2-quantized/');
}

main().catch((err) => {
  console.error('Download failed:', err.message);
  process.exit(1);
});
