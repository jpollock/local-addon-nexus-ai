#!/usr/bin/env node
/**
 * Measures the actual size of specialist prompts using real sandbox data.
 * Run AFTER a sentinel run has created a sandbox.
 *
 * Usage:
 *   node scripts/measure-specialist-prompts.js <sandbox-name>
 *   e.g.: node scripts/measure-specialist-prompts.js sentinel-theawfulpmtest-1784253915650
 */
'use strict';

const { execSync } = require('child_process');
const path = require('path');
const os = require('os');

const sandboxName = process.argv[2];
if (!sandboxName) {
  console.error('Usage: node scripts/measure-specialist-prompts.js <sandbox-name>');
  console.error('Find sandbox name in the run log: "[Tier 2] Creating sandbox: sentinel-..."');
  process.exit(1);
}

const enumeratorSpec  = require('../agents/security-sentinel/specialists/enumerator');
const integritySpec   = require('../agents/security-sentinel/specialists/integrity');
const patternSpec     = require('../agents/security-sentinel/specialists/pattern');
const databaseSpec    = require('../agents/security-sentinel/specialists/database');
const behavioralSpec  = require('../agents/security-sentinel/specialists/behavioral');
const synthSpec       = require('../agents/security-sentinel/specialists/synthesizer');

// Run a WP-CLI command on the sandbox via nexus
function wp(code) {
  try {
    return execSync(
      `./bin/nexus.js wp eval "${code.replace(/"/g, '\\"').replace(/\n/g, ' ')}" --site ${sandboxName}@local`,
      { encoding: 'utf8', stdio: ['pipe','pipe','pipe'] }
    ).trim();
  } catch { return '[]'; }
}

async function main() {
  console.log(`\nMeasuring prompt sizes for sandbox: ${sandboxName}\n`);

  // Collect the same data collectSpecialistData would collect
  console.log('Collecting plugin directories...');
  const pluginDirsRaw = wp(`
    $dir = WP_PLUGIN_DIR;
    $out = [];
    foreach (glob("$dir/*", GLOB_ONLYDIR) ?: [] as $d) {
      $mtime = @filemtime($d);
      $files = iterator_count(new RecursiveIteratorIterator(new RecursiveDirectoryIterator($d, FilesystemIterator::SKIP_DOTS)));
      $out[] = ['name' => basename($d), 'mtime' => $mtime ? date('c', $mtime) : null, 'fileCount' => $files];
    }
    echo json_encode($out);
  `);
  const pluginDirs = JSON.parse(pluginDirsRaw || '[]');
  console.log(`  Plugin dirs: ${pluginDirs.length} entries`);

  console.log('Collecting recently modified files...');
  const recentFilesRaw = wp(`
    $cutoff = time() - 30 * 86400;
    $root = ABSPATH;
    $skip = ['wp-admin', 'wp-includes'];
    $found = [];
    $it = new RecursiveIteratorIterator(new RecursiveDirectoryIterator($root, FilesystemIterator::SKIP_DOTS));
    foreach ($it as $f) {
      if (!$f->isFile()) continue;
      foreach ($skip as $s) { if (strpos($f->getPathname(), "/$s/") !== false) continue 2; }
      if ($f->getMTime() > $cutoff) {
        $found[] = ['path' => str_replace($root, '', $f->getPathname()), 'mtime' => date('c', $f->getMTime()), 'ext' => $f->getExtension()];
      }
      if (count($found) >= 500) break;
    }
    echo json_encode($found);
  `);
  const recentFiles = JSON.parse(recentFilesRaw || '[]');
  console.log(`  Recent files: ${recentFiles.length} entries`);

  console.log('Collecting .htaccess files...');
  const htaccessRaw = wp(`
    $root = ABSPATH; $files = [];
    foreach (new RecursiveIteratorIterator(new RecursiveDirectoryIterator($root, FilesystemIterator::SKIP_DOTS)) as $f) {
      if ($f->getFilename() === '.htaccess') $files[$f->getPathname()] = @file_get_contents($f->getPathname());
    }
    echo json_encode($files);
  `);
  const htaccess = JSON.parse(htaccessRaw || '{}');
  console.log(`  .htaccess files: ${Object.keys(htaccess).length} files`);

  console.log('Collecting DB data...');
  const dbRaw = wp(`
    global $wpdb;
    $auto = $wpdb->get_col("SELECT option_name FROM {$wpdb->options} WHERE autoload='yes'");
    $posts = $wpdb->get_results("SELECT ID, post_title, LEFT(post_content, 500) AS content_preview, post_status, post_type FROM {$wpdb->posts} LIMIT 200", ARRAY_A);
    $critical = $wpdb->get_results("SELECT option_name, LEFT(option_value, 300) as option_value FROM {$wpdb->options} WHERE option_name IN ('siteurl','home','active_plugins','cron') LIMIT 10", ARRAY_A);
    $tables = $wpdb->get_col('SHOW TABLES');
    $std = array_map(fn($t) => $wpdb->prefix . $t, ['posts','postmeta','comments','commentmeta','terms','termmeta','term_taxonomy','term_relationships','users','usermeta','options','links']);
    $extra = array_diff($tables, $std);
    echo json_encode(['autoloaded' => $auto, 'posts' => $posts, 'critical' => $critical, 'nonStandardTables' => array_values($extra)]);
  `);
  const dbData = JSON.parse(dbRaw || '{}');
  console.log(`  Autoloaded options: ${(dbData.autoloaded||[]).length}`);
  console.log(`  Posts: ${(dbData.posts||[]).length}`);

  // Build what the ORIGINAL (broken) data looks like
  const originalData = {
    installName: sandboxName,
    pluginDirectoriesRaw:   JSON.stringify(pluginDirs, null, 2),
    unexpectedFilesRaw:     JSON.stringify(recentFiles, null, 2),
    htaccessPathsRaw:       Object.keys(htaccess).join('\n'),
    nonStandardTablesRaw:   (dbData.nonStandardTables||[]).join('\n'),
    autoloadedOptionsRaw:   (dbData.autoloaded||[]).join('\n'),
    coreChecksums:          '(not collected)',
    pluginChecksums:        '(not collected)',
    configPhpMtime:         '(not collected)',
    patternScanOutput:      '(not collected)',
    htaccessContents:       JSON.stringify(htaccess, null, 2),
    recentlyModifiedFiles:  JSON.stringify(recentFiles, null, 2),
    postsContent:           JSON.stringify((dbData.posts||[]).slice(0,50), null, 2),
    autoloadedOptions:      JSON.stringify(dbData.autoloaded, null, 2),
    criticalOptions:        JSON.stringify(dbData.critical, null, 2),
    adminUsermeta:          '(not collected)',
    recentComments:         '(not collected)',
    nonStandardTableData:   JSON.stringify(dbData.nonStandardTables, null, 2),
    standardResponse:       { status: 200, headers: {}, bodyPreview: '' },
    googlebotResponse:      { status: 200, headers: {}, bodyPreview: '' },
    googleReferrerResponse: { status: 200, headers: {}, bodyPreview: '' },
    loginPageStatus: 200, xmlrpcStatus: 200, usersApiStatus: 200,
    usersApiBody: '', randomPostStatuses: '(not collected)',
    siteCreatedAt: 'unknown', compromiseWindowEstimate: null, siteUrl: `https://${sandboxName}.wpengine.com`,
  };

  // Measure each specialist prompt with ORIGINAL data
  console.log('\n── ORIGINAL (large JSON dumps) ──');
  const specialists = [
    ['Enumerator', enumeratorSpec, { ...originalData }],
    ['Integrity',  integritySpec,  { ...originalData }],
    ['Pattern',    patternSpec,    { ...originalData }],
    ['Database',   databaseSpec,   { ...originalData }],
    ['Behavioral', behavioralSpec, { ...originalData }],
    ['Synthesizer',synthSpec,      { installName: sandboxName, environment: 'production', postCount: 16, siteCreatedAt: 'unknown', lastSyncAt: 'unknown', tier1Signals: '[HIGH] ABS-01: Default admin\n[CRITICAL] ABS-05: Backdoor plugin', enumeratorResult: {}, integrityResult: {}, patternResult: { temporalCluster: { detected: true } }, databaseResult: {}, behavioralResult: {} }],
  ];
  const schemaStr = (s) => JSON.stringify(s.schema, null, 2);
  let origTotal = 0;
  for (const [name, spec, data] of specialists) {
    const prompt = spec.buildPrompt(data);
    const schema = schemaStr(spec);
    const total = prompt.length + schema.length;
    origTotal += total;
    console.log(`  ${name.padEnd(12)} prompt=${prompt.length.toLocaleString()} + schema=${schema.length.toLocaleString()} = ${total.toLocaleString()} chars (~${Math.round(total/4).toLocaleString()} tokens)`);
  }
  console.log(`  TOTAL: ${origTotal.toLocaleString()} chars (~${Math.round(origTotal/4).toLocaleString()} tokens across all calls)`);

  console.log('\n(Compact format numbers would show here after fix is applied)\n');
  console.log('Test script threshold: prompts over ~6000 chars (~1500 tokens) risk timeout with Gemini Flash');
}

main().catch(e => { console.error(e.message); process.exit(1); });
