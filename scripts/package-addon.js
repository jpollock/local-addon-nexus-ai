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

// Guard (P0-4): ACF PRO is a paid WP Engine product and must never ship in a distributed
// artifact. create-entry-points.js excludes it from lib/wp-plugins, but fail loudly here too so
// a regression in that exclusion cannot silently publish it.
const forbiddenInStaging = path.join(stagingDir, 'lib', 'wp-plugins', 'advanced-custom-fields-pro');
if (fs.existsSync(forbiddenInStaging)) {
  throw new Error(
    'Refusing to package: ACF PRO (advanced-custom-fields-pro) is present in lib/wp-plugins. ' +
    'It is a paid product and must not be redistributed. Check create-entry-points.js exclusions.',
  );
}

// Copy package.json
fs.copyFileSync(
  path.join(projectRoot, 'package.json'),
  path.join(stagingDir, 'package.json'),
);

// Copy package-lock.json (T-CI-HERMETIC: npm ci below installs EXACTLY the locked versions, so the
// distributed dependency tree matches the one that was tested — an unlocked `npm install` could
// resolve a different, possibly-compromised transitive version at package time).
fs.copyFileSync(
  path.join(projectRoot, 'package-lock.json'),
  path.join(stagingDir, 'package-lock.json'),
);

// Copy .npmrc alongside the lock file. Without it the `npm ci` below runs in a
// bare temp directory with none of this repo's npm configuration, and this repo
// sets `legacy-peer-deps=true`. package-lock.json was RESOLVED under that
// setting, so a strict-peer `npm ci` reads the very same lock as out of sync:
//
//     npm ci can only install packages when your package.json and
//     package-lock.json are in sync.
//     Missing: react-dom@19.3.0 from lock file
//     Invalid: lock file's react@19.2.5 does not satisfy react@19.3.0
//
// Nothing was wrong with the lock; the staging copy was just missing the config
// that generated it. This failed every platform of the release build on
// 2026-09-13 and is why v0.6.0 could not be packaged. Copying the file rather
// than hardcoding --legacy-peer-deps keeps staging in step with the repo if that
// configuration ever changes.
const npmrcPath = path.join(projectRoot, '.npmrc');
if (fs.existsSync(npmrcPath)) {
  fs.copyFileSync(npmrcPath, path.join(stagingDir, '.npmrc'));
}

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

// Guard (P1-2): fail the package if any secret-shaped string is present in the assembled addon.
// Scanned here, before dependencies are installed, so the addon content is checked without
// wading through node_modules. This is the control that would have caught the P0 key leak.
const { scanPaths } = require('./scan-secrets');
const secretFindings = scanPaths([stagingDir]);
if (secretFindings.length > 0) {
  console.error('🚨 Refusing to package — potential secrets in the build:');
  for (const f of secretFindings) console.error(`  ${f.file}: ${f.name}`);
  process.exit(1);
}
console.log('✓ Secret scan clean');

// ---------------------------------------------------------------------------
// Step 4: Install production dependencies
// ---------------------------------------------------------------------------

console.log('Installing production dependencies (npm ci — locked versions)...');
// T-CI-HERMETIC: `npm ci --omit=dev` installs exactly what package-lock.json pins (and fails if the
// lock is out of sync), so the shipped tree is deterministic. Native install scripts still run
// (NO --ignore-scripts) — better-sqlite3 must build its binary or the addon is broken.
execSync('npm ci --omit=dev', { cwd: stagingDir, stdio: 'inherit' });

// ---------------------------------------------------------------------------
// Step 4.5: Rebuild native modules for Electron
// ---------------------------------------------------------------------------

console.log('Rebuilding native modules for Electron...');
// Run from project root (where electron-rebuild is installed as devDep)
// but target the staging directory
// Windows: npx is a .cmd file and requires shell:true; args are hardcoded so no injection risk
run('npx', ['electron-rebuild', '-v', '37.8.0', '-f', '-w', 'better-sqlite3', '--module-dir', stagingDir],
  { cwd: projectRoot, shell: process.platform === 'win32' });

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
