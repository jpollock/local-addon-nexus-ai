#!/usr/bin/env node
/**
 * package-addon.js — Build a distributable tarball for local-addon-nexus-ai.
 *
 * Usage:
 *   node scripts/package-addon.js [--platform <p>] [--arch <a>]
 *
 * Defaults to the current platform and architecture.
 */

const { execSync, spawnSync } = require('child_process');
const fs = require('fs');
const path = require('path');
const os = require('os');

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Run a command with an explicit argument array (no shell interpolation).
 * Throws if the process exits non-zero, mirroring execSync behaviour.
 */
function run(cmd, args, opts = {}) {
  const result = spawnSync(cmd, args, { stdio: 'inherit', shell: false, ...opts });
  if (result.error) throw result.error;
  if (result.status !== 0) {
    throw new Error(`Command failed (exit ${result.status}): ${cmd} ${args.join(' ')}`);
  }
}

/**
 * Validate --platform and --arch CLI args against known-good values.
 * Prevents shell metacharacters from reaching argument lists.
 */
function validatePlatformArch(platform, arch) {
  const validPlatforms = ['darwin', 'linux', 'win32'];
  const validArchs = ['arm64', 'x64', 'ia32'];
  if (!validPlatforms.includes(platform)) {
    throw new Error(`Invalid --platform "${platform}". Must be one of: ${validPlatforms.join(', ')}`);
  }
  if (!validArchs.includes(arch)) {
    throw new Error(`Invalid --arch "${arch}". Must be one of: ${validArchs.join(', ')}`);
  }
}

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

validatePlatformArch(platform, arch);

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
// Step 4.5: Rebuild native modules for Electron
// ---------------------------------------------------------------------------

console.log('Rebuilding native modules for Electron...');
// Run from project root (where electron-rebuild is installed as devDep)
// but target the staging directory
// On Windows, npx is a .cmd script and requires shell:true to resolve
const npxCmd = process.platform === 'win32' ? 'npx.cmd' : 'npx';
run(npxCmd, ['electron-rebuild', '-v', '37.8.0', '-f', '-w', 'better-sqlite3', '--module-dir', stagingDir],
  { cwd: projectRoot });

// ---------------------------------------------------------------------------
// Step 5: Strip non-target platform binaries
// ---------------------------------------------------------------------------

const stripScript = path.join(projectRoot, 'scripts', 'strip-platforms.sh');
if (fs.existsSync(stripScript)) {
  console.log(`\nStripping non-${platform}-${arch} binaries...`);
  run('bash', [stripScript, platform, arch, stagingDir]);
}

// ---------------------------------------------------------------------------
// Step 6: Create tarball
// ---------------------------------------------------------------------------

const archivePath = path.join(distDir, archiveName);
console.log(`\nCreating ${archiveName}...`);

// Create tarball with contents at root level (not nested in a directory)
run('tar', ['-czf', archivePath, '-C', stagingDir, '.']);

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
