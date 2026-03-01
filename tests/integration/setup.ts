import * as path from 'path';
import * as fs from 'fs';
import * as os from 'os';

const modelsDir = path.join(__dirname, '..', '..', 'models', 'all-MiniLM-L6-v2-quantized');

module.exports = async function globalSetup() {
  // Validate ONNX model exists
  const modelPath = path.join(modelsDir, 'model.onnx');
  if (!fs.existsSync(modelPath)) {
    throw new Error(
      `ONNX model not found at ${modelPath}. Run "npm run download-model" first.`,
    );
  }

  const vocabPath = path.join(modelsDir, 'vocab.txt');
  if (!fs.existsSync(vocabPath)) {
    throw new Error(
      `Vocab file not found at ${vocabPath}. Run "npm run download-model" first.`,
    );
  }

  // Create shared temp directory for integration tests
  const tmpDir = path.join(os.tmpdir(), 'nexus-ai-integration-tests');
  fs.mkdirSync(tmpDir, { recursive: true });

  // Store tmpDir for teardown
  process.env.NEXUS_INTEGRATION_TMPDIR = tmpDir;
};
