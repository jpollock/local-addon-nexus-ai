import * as fs from 'fs';

module.exports = async function globalTeardown() {
  const tmpDir = process.env.NEXUS_INTEGRATION_TMPDIR;
  if (tmpDir && fs.existsSync(tmpDir)) {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
};
