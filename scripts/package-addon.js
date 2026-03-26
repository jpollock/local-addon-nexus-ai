#!/usr/bin/env node
/**
 * package-addon.js — Build a distributable tarball for local-addon-nexus-ai.
 *
 * Usage:
 *   node scripts/package-addon.js [--platform <p>] [--arch <a>]
 *
 * Defaults to the current platform and architecture.
 */

const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');
const os = require('os');

// ---------------------------------------------------------------------------
// Parse arguments
// ---------------------------------------------------------------------------

const args = process.argv.slice(2);
let platform = process.platform;
let arch = process.arch;

for (let i = 0; i < args.length; i++) {
  if (args[i] === '--platform' && args[i + 1]) {
    platform = args[++i];
  } else if (args[i] === '--arch' && args[i + 1]) {
    arch = args[++i];
  }
}

const projectRoot = path.join(__dirname, '..');
const pkg = JSON.parse(fs.readFileSync(path.join(projectRoot, 'package.json'), 'utf8'));
const version = pkg.version;
// Format matches auto-install expectation: nexus-ai-darwin-arm64-0.1.0.tgz
const archiveName = `nexus-ai-${platform}-${arch}-${version}.tgz`;

console.log(`\nPackaging ${pkg.name} v${version} for ${platform}-${arch}\n`);

// ---------------------------------------------------------------------------
// Step 1: Clean dist/
// ---------------------------------------------------------------------------

const distDir = path.join(projectRoot, 'dist');
if (fs.existsSync(distDir)) {
  fs.rmSync(distDir, { recursive: true });
}
fs.mkdirSync(distDir, { recursive: true });

// ---------------------------------------------------------------------------
// Step 2: Build
// ---------------------------------------------------------------------------

console.log('Building...');
execSync('npm run build', { cwd: projectRoot, stdio: 'inherit' });

// ---------------------------------------------------------------------------
// Step 3: Create staging directory
// ---------------------------------------------------------------------------

const stagingDir = path.join(os.tmpdir(), `nexus-ai-stage-${Date.now()}`);
fs.mkdirSync(stagingDir, { recursive: true });

console.log(`Staging in ${stagingDir}`);

// Copy lib/
copyDirSync(path.join(projectRoot, 'lib'), path.join(stagingDir, 'lib'));

// Copy package.json
fs.copyFileSync(
  path.join(projectRoot, 'package.json'),
  path.join(stagingDir, 'package.json'),
);

// Copy README.md if exists
const readmePath = path.join(projectRoot, 'README.md');
if (fs.existsSync(readmePath)) {
  fs.copyFileSync(readmePath, path.join(stagingDir, 'README.md'));
}

// Copy THIRD_PARTY_LICENSES.md if exists
const licensePath = path.join(projectRoot, 'THIRD_PARTY_LICENSES.md');
if (fs.existsSync(licensePath)) {
  fs.copyFileSync(licensePath, path.join(stagingDir, 'THIRD_PARTY_LICENSES.md'));
}

// Copy models/ if exists
const modelsDir = path.join(projectRoot, 'models');
if (fs.existsSync(modelsDir)) {
  copyDirSync(modelsDir, path.join(stagingDir, 'models'));
}

// ---------------------------------------------------------------------------
// Step 4: Install production dependencies
// ---------------------------------------------------------------------------

console.log('Installing production dependencies...');
execSync('npm install --omit=dev', { cwd: stagingDir, stdio: 'inherit' });

// ---------------------------------------------------------------------------
// Step 5: Strip non-target platform binaries
// ---------------------------------------------------------------------------

const stripScript = path.join(projectRoot, 'scripts', 'strip-platforms.sh');
if (fs.existsSync(stripScript)) {
  console.log(`\nStripping non-${platform}-${arch} binaries...`);
  execSync(`bash "${stripScript}" ${platform} ${arch} "${stagingDir}"`, {
    stdio: 'inherit',
  });
}

// ---------------------------------------------------------------------------
// Step 6: Create tarball
// ---------------------------------------------------------------------------

const archivePath = path.join(distDir, archiveName);
console.log(`\nCreating ${archiveName}...`);

// Create tarball with contents at root level (not nested in a directory)
execSync(
  `tar -czf "${archivePath}" -C "${stagingDir}" .`,
  { stdio: 'inherit' },
);

// ---------------------------------------------------------------------------
// Step 7: Report and clean up
// ---------------------------------------------------------------------------

const stats = fs.statSync(archivePath);
const sizeMB = (stats.size / (1024 * 1024)).toFixed(1);

console.log(`\nPackage created: dist/${archiveName} (${sizeMB} MB)`);

// Clean up staging
fs.rmSync(stagingDir, { recursive: true, force: true });

console.log('Done!\n');

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function copyDirSync(src, dest) {
  fs.mkdirSync(dest, { recursive: true });
  for (const entry of fs.readdirSync(src, { withFileTypes: true })) {
    const srcPath = path.join(src, entry.name);
    const destPath = path.join(dest, entry.name);
    if (entry.isDirectory()) {
      copyDirSync(srcPath, destPath);
    } else {
      fs.copyFileSync(srcPath, destPath);
    }
  }
}
