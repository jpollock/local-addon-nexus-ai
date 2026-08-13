#!/usr/bin/env node
/**
 * Zero-dependency secret scanner (P1-2). Shared by:
 *   - the pre-commit hook (.githooks/pre-commit) — scans staged files
 *   - scripts/package-addon.js — scans the built artifact before publishing
 *   - CI (a scan job, in addition to gitleaks)
 *
 * Catches the credential shapes that have actually leaked or would (the P0 leak was an
 * Anthropic key). Prefix-anchored to keep false positives low. This is the last-resort net;
 * gitleaks in CI is the broader scan.
 *
 * Usage:
 *   node scripts/scan-secrets.js [path ...]   # scan given files/dirs (default: git-tracked files)
 *   node scripts/scan-secrets.js --staged      # scan git staged files
 * Exits 1 if any secret is found.
 */
const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

const PATTERNS = [
  { name: 'Anthropic API key', re: /sk-ant-[a-zA-Z0-9_-]{20,}/ },
  { name: 'OpenAI API key', re: /\bsk-(proj-)?[a-zA-Z0-9]{32,}\b/ },
  { name: 'Google API key', re: /\bAIza[0-9A-Za-z_-]{35}\b/ },
  { name: 'AWS access key id', re: /\bAKIA[0-9A-Z]{16}\b/ },
  { name: 'GitHub token', re: /\b(gh[pousr]_[A-Za-z0-9]{36,}|github_pat_[A-Za-z0-9_]{22,})\b/ },
  { name: 'Slack token', re: /\bxox[baprs]-[A-Za-z0-9-]{10,}/ },
  { name: 'Private key block', re: /-----BEGIN (RSA |EC |OPENSSH |DSA |PGP )?PRIVATE KEY-----/ },
];

const IGNORE = [
  /node_modules\//, /\.git\//, /(^|\/)lib\//, /(^|\/)coverage\//, /(^|\/)models\//,
  /package-lock\.json$/,
  /\.(png|jpe?g|gif|ico|onnx|gz|tgz|tar|zip|woff2?|ttf|otf|eot|pdf|wasm|node)$/i,
  /(^|\/)scripts\/scan-secrets\.js$/,          // this file defines the patterns
  /(^|\/)tests\/.*scan-secrets/,               // the scanner's own tests build fakes
  // Credential-redaction / audit test suites: these exist specifically to hold fake,
  // credential-shaped fixtures (AWS documentation example keys, `sk-ant-…FAKE`, PEM headers)
  // to prove the masking logic works. They are not real secrets. A real secret would not live
  // here; for one-off fixtures elsewhere, use an inline `scan-secrets:allow` comment instead.
  /(^|\/)tests\/main\/audit\.test\.ts$/,
  /(^|\/)tests\/unit\/audit\/OperationAuditLog\.test\.ts$/,
  /(^|\/)tests\/unit\/credentials\/sts-validation\.test\.ts$/,
  /(^|\/)tests\/unit\/logging\/formatLine\.test\.ts$/,
  /(^|\/)tests\/unit\/security\/KeyVault\.test\.ts$/,
  /(^|\/)tests\/unit\/security\/credential-redaction\.test\.ts$/,
  /(^|\/)tests\/unit\/utils\/context-assembler\.test\.ts$/,
];

function isIgnored(file) {
  return IGNORE.some((re) => re.test(file));
}

/** Return an array of { name } for each pattern that matches the text. */
function scanText(text) {
  const hits = [];
  for (const p of PATTERNS) {
    if (p.re.test(text)) hits.push({ name: p.name });
  }
  return hits;
}

function scanFile(file) {
  let text;
  try {
    const buf = fs.readFileSync(file);
    if (buf.includes(0)) return []; // binary
    text = buf.toString('utf8');
  } catch {
    return [];
  }
  // Line-based so an inline `scan-secrets:allow` comment can whitelist a known-fake fixture
  // (documentation example keys, redaction-test placeholders) without ignoring the whole file.
  const out = [];
  const lines = text.split('\n');
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (line.includes('scan-secrets:allow')) continue;
    for (const h of scanText(line)) out.push({ ...h, file, line: i + 1 });
  }
  return out;
}

function walk(target, out) {
  const stat = fs.statSync(target);
  if (stat.isDirectory()) {
    for (const entry of fs.readdirSync(target)) {
      const full = path.join(target, entry);
      if (isIgnored(full)) continue;
      walk(full, out);
    }
  } else if (!isIgnored(target)) {
    out.push(...scanFile(target));
  }
}

/** Scan a list of paths (files or dirs); returns findings. */
function scanPaths(paths) {
  const out = [];
  for (const p of paths) {
    if (fs.existsSync(p)) walk(p, out);
  }
  return out;
}

module.exports = { scanText, scanFile, scanPaths, PATTERNS };

// ---- CLI ----
if (require.main === module) {
  const args = process.argv.slice(2);
  let files;
  if (args.includes('--staged')) {
    files = execSync('git diff --cached --name-only --diff-filter=ACM', { encoding: 'utf8' })
      .split('\n').map((s) => s.trim()).filter(Boolean).filter((f) => !isIgnored(f) && fs.existsSync(f));
  } else if (args.length > 0) {
    files = args;
  } else {
    files = execSync('git ls-files', { encoding: 'utf8' })
      .split('\n').map((s) => s.trim()).filter(Boolean).filter((f) => !isIgnored(f));
  }

  const findings = scanPaths(files);
  if (findings.length > 0) {
    console.error('🚨 Potential secrets detected:');
    for (const f of findings) console.error(`  ${f.file}: ${f.name}`);
    console.error('\nRemove the secret (and rotate it if it was ever real) before committing/publishing.');
    process.exit(1);
  }
  console.log(`✓ No secrets detected (${files.length} files scanned).`);
}
