# Sentinel v2.1 — Detection Gaps + Detailed Reporting

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Close six detection gaps (unknown-slug plugins with suspicious internals, anti-forensics tools, obfuscated file paths, DB content scan, core integrity, broad filesystem scan) and produce a detailed markdown report that names every artifact — specific file paths, plugin slugs, post titles, SQL table names — so "see more details" in the UI contains actionable specifics.

**Architecture:** All changes are in `agents/security-sentinel/agent.js` (CommonJS JS). New Tier 1 checks extend `runAbsoluteChecks`. New Tier 2 data collection extends `collectSpecialistData` and the inline `tier2Investigate` wp_eval calls. The report writer (`tier3Remediate`) is extended to write structured findings sections per artifact type. No TypeScript changes required.

**Tech Stack:** CommonJS JS, WP-CLI via `wp_eval`, PHP, better-sqlite3 (graph.db reads), markdown file output.

## Global Constraints

- `agent.js` stays CommonJS JavaScript — no TypeScript, no ESM imports
- All `wp_eval` code uses PHP 7.4+ syntax (WP Engine minimum)
- `npm run sync-agents` must be run after every agent.js change to deploy to Local
- No new npm packages
- `signal.id` values follow existing naming: `ABS-06`, `ABS-07`, `ABS-08`, `ABS-09`, `FS-03`, `FS-05`, `FS-06`, `FS-07`, `DB-01` through `DB-05`, `CHK-01`, `CHK-02`
- Each signal MUST have: `id`, `severity`, `category`, `installName`, `title`, `detail`, `fix`, and a new required field `evidence` (array of specific artifact strings — file paths, slugs, post titles, table names)
- The markdown report MUST list every item in `evidence` so the UI "see more details" view shows actual artifacts, not just counts

---

## File Map

**Modified (single file):**
- `agents/security-sentinel/agent.js` — all changes

**No new files.** Existing report path, checklist builder, and tier3 flow unchanged except for richer signal data and report sections.

---

### Task 1: Add `evidence` field to all existing signals + extend report writer

**Files:**
- Modify: `agents/security-sentinel/agent.js` (runAbsoluteChecks, runExposureChecks, tier3Remediate)
- Test: `tests/unit/agents/security-sentinel/sentinel.test.js` (existing)

**Interfaces:**
- Produces: Every signal object gains `evidence: string[]` — a list of specific artifact strings. Downstream `tier3Remediate` reads `signal.evidence` to write a Findings detail section.
- Existing fields (`id`, `severity`, `title`, `detail`, `fix`) are UNCHANGED — this is additive only.

The core problem: `"Remove attacker plugins"` in the report doesn't say which plugins. `evidence` fixes this by carrying the specific names/paths into the report.

- [ ] **Step 1: Add `evidence` to each existing signal in `runAbsoluteChecks`**

Find `runAbsoluteChecks` (line ~307) and update each `signals.push({...})` to include an `evidence` array:

```javascript
// ABS-01: evidence = ['admin'] (the username)
signals.push({
  id: 'ABS-01', severity: 'high', category: 'active-compromise',
  installName: install.name,
  title: "Default 'admin' username exists",
  detail: "An administrator account with username 'admin' was found.",
  fix: "Create a new administrator account, reassign content, then delete 'admin'.",
  evidence: ['username: admin'],
});

// ABS-02: evidence = list of all admin usernames
signals.push({
  id: 'ABS-02', severity: 'high', category: 'active-compromise',
  installName: install.name,
  title: `Excessive administrators (${adminUsers.length}) on a ${postCount}-post site`,
  detail: `${adminUsers.length} administrator accounts on a ${postCount}-post site is anomalous.`,
  fix: 'Audit each administrator account. Remove or demote accounts that should not have full access.',
  evidence: adminUsers.map(u => `${u.username} <${u.email || 'no email'}>`),
});

// ABS-03: evidence = the specific usernames + emails
signals.push({
  id: 'ABS-03', severity: 'critical', category: 'active-compromise',
  installName: install.name,
  title: `Admin account with @example.com email: ${matched.map(u => u.username).join(', ')}`,
  detail: "@example.com is the WordPress installer placeholder email.",
  fix: 'Verify and delete if not legitimate.',
  evidence: matched.map(u => `${u.username} <${u.email}>`),
});

// ABS-04: evidence = the specific plugin slugs
signals.push({
  id: 'ABS-04', severity: 'high', category: 'active-compromise',
  installName: install.name,
  title: `File manager plugin(s) active: ${activeFileManagers.map(p => p.slug).join(', ')}`,
  detail: 'File manager plugins provide full filesystem write access from WP Admin.',
  fix: 'Deactivate and delete these plugins.',
  evidence: activeFileManagers.map(p => `${p.slug} v${p.version || '?'}`),
});

// ABS-05: evidence = backdoor slugs + versions
signals.push({
  id: 'ABS-05', severity: 'critical', category: 'active-compromise',
  installName: install.name,
  title: `Known backdoor plugin detected: ${backdoors.map(p => p.slug).join(', ')}`,
  detail: `Plugin slug(s) match known malware.`,
  fix: 'Delete immediately via SSH: wp plugin delete <slug>.',
  evidence: backdoors.map(p => `${p.slug} (version: ${p.version || 'unknown'}, active: ${p.is_active})`),
});

// ABS-06: evidence = the specific setting value
signals.push({
  id: 'ABS-06', severity: 'high', category: 'misconfiguration',
  installName: install.name,
  title: 'Default WordPress authentication salts in use',
  detail: "Auth salts still contain the placeholder 'put your unique phrase here'.",
  fix: 'Run: wp config shuffle-salts.',
  evidence: ['wp-config.php contains default placeholder salts'],
});
```

Also update `runExposureChecks` EXP-01, EXP-03, EXP-05 similarly (evidence = specific setting values or plugin names that showed the exposure).

- [ ] **Step 2: Update `tier3Remediate` to write a Findings Details section**

In `tier3Remediate`, find the `findingsLines` construction and replace it with a richer format:

```javascript
// BEFORE (just titles):
const findingsLines = allSignals.length
  ? allSignals.map(s => `- [${(s.severity || 'unknown').toUpperCase()}] ${s.id}: ${s.title}`).join('\n')
  : '(no signals)';

// AFTER (titles + evidence items):
const findingsLines = allSignals.length
  ? allSignals.map(s => {
      const evidenceLines = (s.evidence || []).map(e => `    - ${e}`).join('\n');
      const line = `- [${(s.severity || 'unknown').toUpperCase()}] ${s.id}: ${s.title}`;
      return evidenceLines ? `${line}\n${evidenceLines}` : line;
    }).join('\n')
  : '(no signals)';
```

- [ ] **Step 3: Run existing tests**

```bash
npm test -- --testPathPattern=sentinel.test --no-coverage 2>&1 | tail -8
npm run compile 2>&1 | head -5
```

Expected: all existing tests pass, compile clean.

- [ ] **Step 4: Sync and commit**

```bash
npm run sync-agents 2>&1 | tail -2
git add agents/security-sentinel/agent.js
git commit -m "feat(sentinel-v2.1): add evidence field to all signals, report writes specific artifact details"
```

---

### Task 2: ABS-06/07 — Suspicious internal filenames + low-entropy plugin names (Tier 1)

**Files:**
- Modify: `agents/security-sentinel/agent.js` (runAbsoluteChecks + collectFleetData)

**Interfaces:**
- Consumes: `install.plugins` array (already available in Tier 1 — has `slug`, `name`, `version`, `is_active`)
- Produces: Two new signals — `ABS-06` (suspicious internal filenames — checked in Tier 2 against sandbox filesystem), `ABS-07` (low-entropy plugin name — checked in Tier 1 against fleet data)

**Note:** ABS-06 requires filesystem access (sandbox), so it belongs in Tier 2 `tier2Investigate`. ABS-07 uses only the slug name, so it runs in Tier 1.

- [ ] **Step 1: Add ABS-07 (low-entropy plugin name) to `runAbsoluteChecks`**

After the ABS-05 block (line ~373), add:

```javascript
// ABS-07: Low-entropy plugin directory names (random-looking strings — e.g. "Kz2", "a1b2")
// Heuristic: length ≤ 5, all alphanumeric, no dictionary words (checked via simple vowel pattern)
const COMMON_WORDS_RE = /^(admin|login|cache|image|video|theme|block|post|page|user|form|mail|test|demo|core|base|grid|list|menu|nav|panel|api|cron|hook|feed|link|auth|view|data|file|code|lang)$/i;
const lowEntropyPlugins = plugins.filter(p => {
  const slug = (p.slug || '').replace(/-/g, '');
  if (slug.length > 6) return false;                          // too long to be random
  if (!/^[a-zA-Z0-9]+$/.test(slug)) return false;             // must be alphanumeric only
  if (COMMON_WORDS_RE.test(slug)) return false;                // real English words are fine
  if (/^[A-Z][a-z]+$/.test(slug)) return false;               // proper capitalized word is fine
  return true;
});
if (lowEntropyPlugins.length > 0) {
  signals.push({
    id: 'ABS-07', severity: 'high', category: 'active-compromise',
    installName: install.name,
    title: `Low-entropy plugin name(s) — likely attacker-created: ${lowEntropyPlugins.map(p => p.slug).join(', ')}`,
    detail: 'Plugin directory names that are short random strings (e.g. "Kz2", "a1b") are not legitimate plugin names. Attackers use these to hide tools.',
    fix: 'Inspect the contents of each directory. Delete if not a recognized legitimate plugin.',
    evidence: lowEntropyPlugins.map(p => `${p.slug} (active: ${p.is_active === '1' ? 'yes' : 'no'})`),
  });
}
```

- [ ] **Step 2: Add ABS-06 (suspicious internal filenames) to `tier2Investigate` filesystem checks**

In `tier2Investigate`, after the FS-04 check (PHP in uploads), add a new wp_eval call:

```javascript
// ABS-06: Suspicious internal filenames within plugins
// Files named check_file.php, shell.php, cmd.php, c99.php, r57.php, etc. signal attacker tools
// regardless of whether they use obfuscation
const suspiciousFileResult = await tools.invoke('wp_eval', {
  site: sandboxName, skip_plugins: true, skip_themes: true,
  code: `
    $dir = WP_PLUGIN_DIR;
    $suspicious = [
      'check_file.php', 'shell.php', 'cmd.php', 'c99.php', 'r57.php', 'php.php',
      'eval.php', 'exec.php', 'bypass.php', 'b374k.php', 'wso.php',
      'FilesMan.php', 'b374.php', 'indoxploit.php',
    ];
    $found = [];
    if (!is_dir($dir)) { echo json_encode($found); exit; }
    foreach (new RecursiveIteratorIterator(new RecursiveDirectoryIterator($dir, FilesystemIterator::SKIP_DOTS)) as $f) {
      if (in_array(strtolower($f->getFilename()), array_map('strtolower', $suspicious))) {
        $found[] = [
          'path' => str_replace(ABSPATH, '', $f->getPathname()),
          'size' => $f->getSize(),
          'mtime' => date('Y-m-d H:i:s', $f->getMTime()),
        ];
      }
    }
    echo json_encode($found);
  `,
});
try {
  const suspiciousFiles = JSON.parse(extractResult(suspiciousFileResult) || '[]');
  if (suspiciousFiles.length > 0) {
    fsSignals.push({
      id: 'ABS-06', severity: 'critical', category: 'active-compromise',
      installName: install.name,
      title: `Suspicious internal filenames in plugins: ${suspiciousFiles.map(f => f.path.split('/').pop()).join(', ')}`,
      detail: 'Files with names matching known attacker tool patterns were found inside plugin directories.',
      fix: 'Inspect each file. Delete if not part of a legitimate plugin.',
      evidence: suspiciousFiles.map(f => `${f.path} (${f.size} bytes, modified ${f.mtime})`),
    });
  }
} catch {}
```

- [ ] **Step 3: Add ABS-08 (anti-forensics timestamp manipulation) to filesystem checks**

After ABS-06 in `tier2Investigate`:

```javascript
// ABS-08: Anti-forensics tools — PHP that recursively modifies file timestamps
// The touch() + scandir() pattern is specific to timestamp-backdating tools
const antiForensicsResult = await tools.invoke('wp_eval', {
  site: sandboxName, skip_plugins: true, skip_themes: true,
  code: `
    $dir = WP_PLUGIN_DIR;
    $found = [];
    if (!is_dir($dir)) { echo json_encode($found); exit; }
    foreach (new RecursiveIteratorIterator(new RecursiveDirectoryIterator($dir, FilesystemIterator::SKIP_DOTS)) as $f) {
      if ($f->getExtension() !== 'php') continue;
      $content = @file_get_contents($f->getPathname());
      if (!$content) continue;
      // touch() + scandir/glob/RecursiveIterator in same file = timestamp manipulation
      if (preg_match('/touch\\s*\\(/', $content) &&
          preg_match('/scandir|glob|RecursiveIterator/', $content)) {
        $found[] = [
          'path' => str_replace(ABSPATH, '', $f->getPathname()),
          'snippet' => substr($content, 0, 200),
        ];
      }
    }
    echo json_encode($found);
  `,
});
try {
  const antiForensics = JSON.parse(extractResult(antiForensicsResult) || '[]');
  if (antiForensics.length > 0) {
    fsSignals.push({
      id: 'ABS-08', severity: 'critical', category: 'active-compromise',
      installName: install.name,
      title: `Anti-forensics tool detected: timestamp manipulation code in ${antiForensics.length} file(s)`,
      detail: 'PHP code using touch() to recursively modify file timestamps was found. This is used by attackers to hide when files were planted.',
      fix: 'Delete the containing plugin/directory. The attacker used this to backdate all planted files, so timestamp-based analysis of the site is unreliable.',
      evidence: antiForensics.map(f => f.path),
    });
  }
} catch {}
```

- [ ] **Step 4: Test and sync**

```bash
node -e "require('/Users/jeremy.pollock/Library/Application Support/Local/nexus-ai/agents/security-sentinel/agent.js'); console.log('OK')" 2>&1
npm run sync-agents 2>&1 | tail -2
```

Expected: loads OK, sync completes.

- [ ] **Step 5: Commit**

```bash
git add agents/security-sentinel/agent.js
git commit -m "feat(sentinel-v2.1): ABS-06 suspicious filenames, ABS-07 low-entropy names, ABS-08 anti-forensics tools"
```

---

### Task 3: FS improvements — report file paths, scan broader locations, detect non-PHP executables

**Files:**
- Modify: `agents/security-sentinel/agent.js` (tier2Investigate filesystem checks)

**What changes:**
- **FS-02**: Currently returns count only. Change to report each file path + pattern matched
- **FS-03** (new): Scan `languages/`, `uploads/`, and web root (not just `plugins/`, `mu-plugins/`, `themes/`)
- **FS-05** (new): `.htaccess` content analysis — flag PHP re-enable and external redirects
- **FS-06** (new): ELF binary detection in `wp-content/`

- [ ] **Step 1: Extend FS-02 to report file paths**

Find the obfuscation scan wp_eval code in `tier2Investigate` (around line 662 in current code). The result is already returned as `{ matches: [...], scanned: N }` with `file`, `pattern`, `snippet` per match. Update the signal construction to use `evidence`:

```javascript
// Find: fsSignals.push({ id: 'FS-02', ... title: `Obfuscated code ... found in ${obfFiles.length} file(s)` })
// Replace with:
if (obfFiles.length > 0) {
  fsSignals.push({
    id: 'FS-02', severity: 'critical', category: 'active-compromise',
    installName: install.name,
    title: `Obfuscated code (eval+base64/gzinflate/rot13) found in ${obfFiles.length} file(s)`,
    detail: `Files containing obfuscation chains: ${obfFiles.map(f=>f.file||f).join(', ')}`,
    fix: 'Inspect each file. Delete if not part of a legitimate plugin/theme. Compare with original plugin source.',
    evidence: obfFiles.map(f => typeof f === 'string' ? f : `${f.file} — pattern: ${f.pattern||'?'}`),
  });
}
```

**Note:** The `obfFiles` variable already has `file`, `pattern`, `snippet` from the wp_eval. The old code extracted just the paths. Keep both.

- [ ] **Step 2: Add FS-03 — scan broader locations (languages/, web root, uploads/)**

After the existing FS-02 check, add:

```javascript
// FS-03: PHP files in unexpected non-plugin locations: languages/, web root, uploads/
const broadScanResult = await tools.invoke('wp_eval', {
  site: sandboxName, skip_plugins: true, skip_themes: true,
  code: `
    $patterns = ['/eval\\s*\\(.*base64_decode/s', '/eval\\s*\\(.*gzinflate/s', '/eval\\s*\\(.*str_rot13/s'];
    $scanDirs = [
      ABSPATH . 'wp-content/languages',
      ABSPATH . 'wp-content/uploads',
    ];
    $rootPhp = glob(ABSPATH . '*.php') ?: [];
    // Also scan root PHP files (excluding wp-*.php and index.php — compare names)
    $knownRoot = ['index.php','wp-activate.php','wp-blog-header.php','wp-comments-post.php',
                  'wp-config.php','wp-cron.php','wp-links-opml.php','wp-load.php',
                  'wp-login.php','wp-mail.php','wp-settings.php','wp-signup.php',
                  'wp-trackback.php','xmlrpc.php','wp-config-sample.php'];
    $found = [];
    foreach ($rootPhp as $f) {
      if (!in_array(basename($f), $knownRoot)) {
        $found[] = ['path' => str_replace(ABSPATH, '', $f), 'reason' => 'unknown PHP in web root'];
      }
    }
    foreach ($scanDirs as $dir) {
      if (!is_dir($dir)) continue;
      foreach (new RecursiveIteratorIterator(new RecursiveDirectoryIterator($dir, FilesystemIterator::SKIP_DOTS)) as $file) {
        if ($file->getExtension() !== 'php') continue;
        $content = @file_get_contents($file->getPathname());
        foreach ($patterns as $p) {
          if (preg_match($p, $content)) {
            $found[] = ['path' => str_replace(ABSPATH, '', $file->getPathname()), 'reason' => 'obfuscated code'];
            break;
          }
        }
      }
    }
    echo json_encode($found);
  `,
});
try {
  const broadFiles = JSON.parse(extractResult(broadScanResult) || '[]');
  if (broadFiles.length > 0) {
    fsSignals.push({
      id: 'FS-03', severity: 'critical', category: 'active-compromise',
      installName: install.name,
      title: `Suspicious PHP files outside plugins/themes: ${broadFiles.length} file(s)`,
      detail: 'PHP files were found in unexpected locations (web root, languages/, uploads/) or contain obfuscation.',
      fix: 'Delete unknown PHP files from web root and languages/. PHP should not exist in uploads/.',
      evidence: broadFiles.map(f => `${f.path} (${f.reason})`),
    });
  }
} catch {}
```

- [ ] **Step 3: Add FS-05 — .htaccess content analysis**

```javascript
// FS-05: Suspicious .htaccess rules — PHP re-enable, external redirects
const htaccessResult = await tools.invoke('wp_eval', {
  site: sandboxName, skip_plugins: true, skip_themes: true,
  code: `
    $root = ABSPATH;
    $findings = [];
    foreach (new RecursiveIteratorIterator(new RecursiveDirectoryIterator($root, FilesystemIterator::SKIP_DOTS)) as $f) {
      if ($f->getFilename() !== '.htaccess') continue;
      $content = @file_get_contents($f->getPathname());
      $path = str_replace($root, '', $f->getPathname());
      // PHP re-enabled in non-root .htaccess (especially in uploads/)
      if (strpos($path, '/uploads/') !== false && preg_match('/\\.php/i', $content)) {
        $findings[] = ['path' => $path, 'reason' => 'PHP execution enabled in uploads/', 'snippet' => substr($content, 0, 300)];
      }
      // External redirect rules
      if (preg_match('/RewriteRule.*https?:\\/\\/(?!'.preg_quote($_SERVER["HTTP_HOST"] ?? 'localhost', '/').')/', $content, $m)) {
        $findings[] = ['path' => $path, 'reason' => 'RewriteRule redirecting to external domain', 'snippet' => $m[0]];
      }
      // php_value re-enabling execution
      if (preg_match('/php_value\\s+auto_prepend_file|php_value\\s+auto_append_file/', $content, $m)) {
        $findings[] = ['path' => $path, 'reason' => 'auto_prepend/append_file set via php_value', 'snippet' => $m[0]];
      }
    }
    echo json_encode($findings);
  `,
});
try {
  const htaccess = JSON.parse(extractResult(htaccessResult) || '[]');
  if (htaccess.length > 0) {
    fsSignals.push({
      id: 'FS-05', severity: 'critical', category: 'active-compromise',
      installName: install.name,
      title: `Suspicious .htaccess rules in ${htaccess.length} location(s)`,
      detail: 'htaccess files with rules that re-enable PHP execution or redirect to external domains were found.',
      fix: 'Review each file. Remove rules that allow PHP in uploads/ or redirect to external domains.',
      evidence: htaccess.map(f => `${f.path}: ${f.reason} — ${(f.snippet||'').slice(0,80)}`),
    });
  }
} catch {}
```

- [ ] **Step 4: Add FS-06 — ELF binary detection**

```javascript
// FS-06: Non-PHP executables (ELF binaries) in wp-content/
const elfResult = await tools.invoke('wp_eval', {
  site: sandboxName, skip_plugins: true, skip_themes: true,
  code: `
    $dir = WP_CONTENT_DIR;
    $found = [];
    $skipExts = ['php','js','css','html','htm','txt','md','json','xml','svg','png','jpg','jpeg','gif','webp','woff','woff2','ttf','eot','ico','map','pot','po','mo','log','ini','conf'];
    foreach (new RecursiveIteratorIterator(new RecursiveDirectoryIterator($dir, FilesystemIterator::SKIP_DOTS)) as $f) {
      if (!$f->isFile()) continue;
      $ext = strtolower($f->getExtension());
      if (in_array($ext, $skipExts)) continue;
      $fh = @fopen($f->getPathname(), 'rb');
      if (!$fh) continue;
      $header = fread($fh, 4);
      fclose($fh);
      // ELF header: \x7fELF
      if ($header === "\x7fELF") {
        $found[] = ['path' => str_replace(WP_CONTENT_DIR, 'wp-content', $f->getPathname()), 'size' => $f->getSize()];
      }
    }
    echo json_encode($found);
  `,
});
try {
  const elfs = JSON.parse(extractResult(elfResult) || '[]');
  if (elfs.length > 0) {
    fsSignals.push({
      id: 'FS-06', severity: 'critical', category: 'active-compromise',
      installName: install.name,
      title: `ELF binary (Linux executable) found in wp-content: ${elfs.length} file(s)`,
      detail: 'Linux executables inside wp-content/ are not legitimate WordPress files. They are likely backdoors or crypto miners.',
      fix: 'Delete immediately. Investigate when each was placed using filesystem timestamps and access logs.',
      evidence: elfs.map(f => `${f.path} (${(f.size/1024).toFixed(1)} KB)`),
    });
  }
} catch {}
```

- [ ] **Step 5: Test and sync**

```bash
node -e "require('/Users/jeremy.pollock/Library/Application Support/Local/nexus-ai/agents/security-sentinel/agent.js'); console.log('OK')" 2>&1
npm run sync-agents 2>&1 | tail -2
```

- [ ] **Step 6: Commit**

```bash
git add agents/security-sentinel/agent.js
git commit -m "feat(sentinel-v2.1): FS-02 reports paths, FS-03 broad location scan, FS-05 htaccess analysis, FS-06 ELF binary detection"
```

---

### Task 4: DB content scan — wp_posts content, wp_options payloads, wp_usermeta, wp_comments

**Files:**
- Modify: `agents/security-sentinel/agent.js` (tier2Investigate — after existing DB checks)

These run in Tier 2 (sandbox) using wp_eval on the real site data.

- [ ] **Step 1: Add DB-01 — wp_posts content scan**

In `tier2Investigate` after the existing FS checks, add DB checks (grouped as a DB phase):

```javascript
log.info(`[Tier 2] Running database content scan...`);

// DB-01: wp_posts content scan — injected scripts, hidden spam content
const postsContentResult = await tools.invoke('wp_eval', {
  site: sandboxName,
  code: `
    global $wpdb;
    $posts = $wpdb->get_results(
      "SELECT ID, post_title, post_status, post_type, post_date, LEFT(post_content, 1000) as content
       FROM {$wpdb->posts}
       WHERE post_status IN ('publish','draft','private','future','pending')
         AND post_type NOT IN ('revision','auto-draft')
       ORDER BY post_date DESC LIMIT 200",
      ARRAY_A
    );
    $suspicious = [];
    $spamPatterns = ['/<script/i', '/javascript:/i', '/base64_decode/i', '/eval\\s*\\(/i', '/document\\.write/i', '/\\.onload\\s*=/i'];
    $spamKeywords = ['/casino/i', '/poker/i', '/slots?/i', '/gambling/i', '/kasyno/i', '/spielautomat/i', '/scommesse/i'];
    foreach ($posts as $post) {
      $content = $post['content'] ?? '';
      $title = $post['post_title'] ?? '';
      $reasons = [];
      foreach ($spamPatterns as $p) {
        if (preg_match($p, $content)) { $reasons[] = 'injected script/eval'; break; }
      }
      foreach ($spamKeywords as $p) {
        if (preg_match($p, $title) || preg_match($p, $content)) { $reasons[] = 'casino/gambling spam'; break; }
      }
      if ($reasons) {
        $suspicious[] = [
          'id' => $post['ID'],
          'title' => $post['post_title'],
          'status' => $post['post_status'],
          'date' => $post['post_date'],
          'reasons' => $reasons,
        ];
      }
    }
    echo json_encode(['total' => count($posts), 'suspicious' => $suspicious]);
  `,
});
try {
  const postsData = JSON.parse(extractResult(postsContentResult) || '{}');
  if ((postsData.suspicious || []).length > 0) {
    fsSignals.push({
      id: 'DB-01', severity: 'high', category: 'active-compromise',
      installName: install.name,
      title: `Suspicious post content: ${postsData.suspicious.length} of ${postsData.total} posts flagged`,
      detail: 'Posts contain injected scripts or blackhat SEO spam content (casino/gambling keywords).',
      fix: 'Delete spam posts. Inspect posts with injected scripts — remove the script tag or delete the post.',
      evidence: postsData.suspicious.map(p => `[${p.status}] "${p.title}" (ID:${p.id}, ${p.date}) — ${p.reasons.join(', ')}`),
    });
  }
} catch {}
```

- [ ] **Step 2: Add DB-02 — wp_options serialized payload scan**

```javascript
// DB-02: wp_options scan for injected code in autoloaded options
const optionsScanResult = await tools.invoke('wp_eval', {
  site: sandboxName,
  code: `
    global $wpdb;
    $options = $wpdb->get_results(
      "SELECT option_name, LEFT(option_value, 500) as val FROM {$wpdb->options} WHERE autoload='yes'",
      ARRAY_A
    );
    $suspicious = [];
    $patterns = ['/eval\\s*\\(/i', '/base64_decode/i', '/<script/i', '/exec\\s*\\(/i', '/system\\s*\\(/i'];
    foreach ($options as $opt) {
      foreach ($patterns as $p) {
        if (preg_match($p, $opt['val'])) {
          $suspicious[] = ['name' => $opt['option_name'], 'snippet' => substr($opt['val'], 0, 150)];
          break;
        }
      }
    }
    echo json_encode(['total' => count($options), 'suspicious' => $suspicious]);
  `,
});
try {
  const optData = JSON.parse(extractResult(optionsScanResult) || '{}');
  if ((optData.suspicious || []).length > 0) {
    fsSignals.push({
      id: 'DB-02', severity: 'critical', category: 'active-compromise',
      installName: install.name,
      title: `Suspicious code in wp_options: ${optData.suspicious.length} autoloaded option(s) contain eval/exec/script`,
      detail: 'Autoloaded options containing code patterns that execute on every page load.',
      fix: 'Update or delete each flagged option: wp option update <name> ""',
      evidence: optData.suspicious.map(o => `${o.name}: ${o.snippet.slice(0,80)}...`),
    });
  }
} catch {}
```

- [ ] **Step 3: Add DB-03 — wp_usermeta serialized objects**

```javascript
// DB-03: wp_usermeta — serialized PHP objects with callable methods
const usermetaResult = await tools.invoke('wp_eval', {
  site: sandboxName,
  code: `
    global $wpdb;
    $admins = $wpdb->get_col(
      "SELECT u.ID FROM {$wpdb->users} u
       JOIN {$wpdb->usermeta} m ON u.ID = m.user_id
       WHERE m.meta_key = 'wp_capabilities' AND m.meta_value LIKE '%administrator%'"
    );
    $suspicious = [];
    if ($admins) {
      $meta = $wpdb->get_results(
        "SELECT user_id, meta_key, LEFT(meta_value, 300) as meta_value
         FROM {$wpdb->usermeta}
         WHERE user_id IN (" . implode(',', array_map('intval', $admins)) . ")
         AND meta_value LIKE 'O:%'",
        ARRAY_A
      );
      foreach ($meta as $m) {
        if (preg_match('/O:\\d+:"[^"]+":/', $m['meta_value'])) {
          $suspicious[] = ['user_id' => $m['user_id'], 'key' => $m['meta_key'], 'snippet' => substr($m['meta_value'], 0, 100)];
        }
      }
    }
    echo json_encode($suspicious);
  `,
});
try {
  const metaData = JSON.parse(extractResult(usermetaResult) || '[]');
  if (metaData.length > 0) {
    fsSignals.push({
      id: 'DB-03', severity: 'high', category: 'active-compromise',
      installName: install.name,
      title: `Serialized PHP objects in admin user meta: ${metaData.length} entry(ies)`,
      detail: 'Serialized objects in wp_usermeta can execute code on deserialization. Used for persistence.',
      fix: 'Inspect each meta value. Delete if not from a known legitimate plugin.',
      evidence: metaData.map(m => `User ${m.user_id}, meta_key: ${m.key} — ${m.snippet}`),
    });
  }
} catch {}
```

- [ ] **Step 4: Add DB-04 — wp_comments SEO spam**

```javascript
// DB-04: wp_comments — SEO spam injection
const commentsResult = await tools.invoke('wp_eval', {
  site: sandboxName,
  code: `
    global $wpdb;
    $count = (int)$wpdb->get_var("SELECT COUNT(*) FROM {$wpdb->comments}");
    $sample = $wpdb->get_results(
      "SELECT comment_ID, comment_author, comment_content, comment_date
       FROM {$wpdb->comments}
       WHERE comment_approved = '1'
       ORDER BY comment_date DESC LIMIT 50",
      ARRAY_A
    );
    $spamKeywords = ['/casino/i', '/poker/i', '/slot/i', '/gambling/i', '/kasyno/i', '/https?:\\/\\/[^\\s]{30,}/'];
    $suspicious = [];
    foreach ($sample as $c) {
      foreach ($spamKeywords as $p) {
        if (preg_match($p, $c['comment_content'])) {
          $suspicious[] = ['id' => $c['comment_ID'], 'author' => $c['comment_author'], 'date' => $c['comment_date'], 'snippet' => substr($c['comment_content'], 0, 100)];
          break;
        }
      }
    }
    echo json_encode(['total' => $count, 'suspicious' => $suspicious]);
  `,
});
try {
  const commData = JSON.parse(extractResult(commentsResult) || '{}');
  if ((commData.suspicious || []).length > 0) {
    fsSignals.push({
      id: 'DB-04', severity: 'medium', category: 'active-compromise',
      installName: install.name,
      title: `Spam content in comments: ${commData.suspicious.length} of ${commData.total} total comments`,
      detail: 'Approved comments with casino/gambling keywords or long URLs — common SEO spam injection vector.',
      fix: 'Delete flagged comments: wp comment delete <id> --force',
      evidence: commData.suspicious.map(c => `Comment ${c.id} by "${c.author}" (${c.date}): ${c.snippet}`),
    });
  }
} catch {}
```

- [ ] **Step 5: Test and sync**

```bash
node -e "require('/Users/jeremy.pollock/Library/Application Support/Local/nexus-ai/agents/security-sentinel/agent.js'); console.log('OK')" 2>&1
npm run sync-agents 2>&1 | tail -2
```

- [ ] **Step 6: Commit**

```bash
git add agents/security-sentinel/agent.js
git commit -m "feat(sentinel-v2.1): DB-01 post content scan, DB-02 wp_options payloads, DB-03 usermeta objects, DB-04 comment spam"
```

---

### Task 5: Core integrity — CHK-01 wp core checksums (required, not deferred) + CHK-02 plugin checksums

**Files:**
- Modify: `agents/security-sentinel/agent.js` (tier2Investigate — replace deferred step 5)

Currently Step 5 is deferred with a comment. This task makes it a real check. The trick: `wp core verify-checksums` works via `shell_exec` inside `wp_eval` on Local sandboxes (shell_exec is available there unlike on managed WPE hosting).

- [ ] **Step 1: Replace deferred core checksums with real check in `tier2Investigate`**

After the DB-04 check, add:

```javascript
// CHK-01: WP core file integrity
log.info(`[Tier 2] Running core integrity checks...`);
const coreCheckResult = await tools.invoke('wp_eval', {
  site: sandboxName, skip_plugins: true, skip_themes: true,
  code: `
    $output = shell_exec('wp --skip-plugins --skip-themes core verify-checksums 2>&1');
    if ($output === null) {
      echo json_encode(['status' => 'unavailable', 'failures' => [], 'raw' => '']);
    } else {
      $lines = explode("\\n", trim($output));
      $failures = array_filter($lines, fn($l) => strpos($l, 'Error:') !== false || strpos($l, 'Warning:') !== false);
      $ok = strpos($output, 'WordPress installation verifies against checksums') !== false;
      echo json_encode([
        'status' => $ok ? 'passed' : (count($failures) > 0 ? 'failed' : 'unknown'),
        'failures' => array_values($failures),
        'raw' => substr($output, 0, 500),
      ]);
    }
  `,
});
try {
  const coreCheck = JSON.parse(extractResult(coreCheckResult) || '{"status":"unavailable","failures":[]}');
  if (coreCheck.status === 'failed' && coreCheck.failures.length > 0) {
    fsSignals.push({
      id: 'CHK-01', severity: 'critical', category: 'active-compromise',
      installName: install.name,
      title: `WordPress core file tampering detected: ${coreCheck.failures.length} file(s) fail checksum`,
      detail: 'Core file checksums do not match WordPress.org — files may have been injected or modified by the attacker.',
      fix: 'Run: wp core download --skip-content --force to re-download core files. Then re-verify.',
      evidence: coreCheck.failures.map(f => f.trim()),
    });
  }
  log.info(`[Tier 2] Core integrity: ${coreCheck.status}`);
} catch {}
```

- [ ] **Step 2: Also update `buildRemediationChecklist` to REMOVE the deferred Step 5**

Find in `buildRemediationChecklist` (around line 1219):
```javascript
// The deferred note is now written separately in tier3Remediate:
// '⚪ Step 5: WP core checksums — deferred...'
```

Remove that deferred line from `tier3Remediate` (line ~1475):
```javascript
// REMOVE this line:
try { fs.appendFileSync(reportPath, '⚪ Step 5: WP core checksums — deferred (run: wp core verify-checksums on sandbox via SSH)\n'); } catch { /* non-fatal */ }
```

The CHK-01 signal now handles this in Tier 2. If CHK-01 fires, the remediation checklist will include a step for it via the existing signal→checklist mapping. If CHK-01 doesn't fire (checksums pass), there's no need for a deferred note.

- [ ] **Step 3: Add CHK-02 — plugin checksums for wordpress.org plugins**

```javascript
// CHK-02: Plugin integrity for wordpress.org plugins
const pluginCheckResult = await tools.invoke('wp_eval', {
  site: sandboxName, skip_plugins: true, skip_themes: true,
  code: `
    $output = shell_exec('wp --skip-plugins --skip-themes plugin verify-checksums --all 2>&1');
    if ($output === null) { echo json_encode(['status'=>'unavailable','failures':[]]); exit; }
    $lines = explode("\\n", trim($output));
    $failures = [];
    $unverifiable = [];
    foreach ($lines as $l) {
      if (strpos($l, 'Error:') !== false) $failures[] = $l;
      if (strpos($l, 'This plugin version was not found') !== false ||
          strpos($l, 'could not be found') !== false) $unverifiable[] = $l;
    }
    echo json_encode([
      'status' => count($failures) > 0 ? 'failed' : 'passed',
      'failures' => $failures,
      'unverifiable' => $unverifiable,
    ]);
  `,
});
try {
  const pluginCheck = JSON.parse(extractResult(pluginCheckResult) || '{"status":"unavailable","failures":[]}');
  if (pluginCheck.failures.length > 0) {
    fsSignals.push({
      id: 'CHK-02', severity: 'critical', category: 'active-compromise',
      installName: install.name,
      title: `Plugin file tampering: ${pluginCheck.failures.length} plugin(s) fail checksum verification`,
      detail: 'Plugin files do not match WordPress.org checksums — the attacker may have injected code into a legitimate plugin file.',
      fix: 'For each failing plugin: wp plugin install <slug> --force to reinstall from WordPress.org.',
      evidence: pluginCheck.failures.map(f => f.trim()),
    });
  }
  if (pluginCheck.unverifiable.length > 0) {
    log.info(`[Tier 2] ${pluginCheck.unverifiable.length} plugin(s) not verifiable (not on wordpress.org or version mismatch)`);
  }
} catch {}
```

- [ ] **Step 4: Update report to include DB and CHK sections**

In `tier3Remediate`, add a new report section after Findings:

```javascript
// Add after findingsLines, before Synthesis section:
const dbSignals = allSignals.filter(s => s.id.startsWith('DB-'));
const chkSignals = allSignals.filter(s => s.id.startsWith('CHK-'));

const dbSection = dbSignals.length > 0 ? [
  '',
  '## Database Findings',
  dbSignals.map(s => {
    const evidence = (s.evidence || []).map(e => `  - ${e}`).join('\n');
    return `### ${s.id}: ${s.title}\n${evidence}`;
  }).join('\n\n'),
].join('\n') : '';

const chkSection = chkSignals.length > 0 ? [
  '',
  '## Integrity Check Results',
  chkSignals.map(s => {
    const evidence = (s.evidence || []).map(e => `  - ${e}`).join('\n');
    return `### ${s.id}: ${s.title}\n${evidence}`;
  }).join('\n\n'),
].join('\n') : '';
```

And include in the header string.

- [ ] **Step 5: Test and sync**

```bash
node -e "require('/Users/jeremy.pollock/Library/Application Support/Local/nexus-ai/agents/security-sentinel/agent.js'); console.log('OK')" 2>&1
npm run sync-agents 2>&1 | tail -2
```

- [ ] **Step 6: Commit**

```bash
git add agents/security-sentinel/agent.js
git commit -m "feat(sentinel-v2.1): CHK-01 core checksums (required not deferred), CHK-02 plugin checksums, DB/CHK report sections"
```

---

### Task 6: Detailed report sections — named artifacts per finding type + blind spots disclosure

**Files:**
- Modify: `agents/security-sentinel/agent.js` (tier3Remediate report writer)

**Goal:** The markdown report becomes a full forensic document. Every finding section names the specific artifacts. A "Blind Spots" section explicitly states what was NOT checked.

- [ ] **Step 1: Restructure the report header to include per-section evidence tables**

Replace the current `findingsLines` construction in `tier3Remediate` with a full section-based format:

```javascript
// Group signals by category for structured report sections
const groupBy = (arr, fn) => arr.reduce((acc, x) => { const k = fn(x); (acc[k] = acc[k] || []).push(x); return acc; }, {});
const byCategory = groupBy(allSignals, s => s.id.startsWith('DB-') ? 'database' :
                                           s.id.startsWith('CHK-') ? 'integrity' :
                                           s.id.startsWith('FS-') ? 'filesystem' :
                                           s.id.startsWith('TC-') ? 'temporal' : 'plugins_users');

const renderCategory = (title, signals) => {
  if (!signals || signals.length === 0) return '';
  const lines = signals.map(s => {
    const sev = (s.severity || 'unknown').toUpperCase();
    const evidence = (s.evidence || []).map(e => `  - ${e}`).join('\n');
    return `- [${sev}] **${s.id}:** ${s.title}\n${evidence}`;
  }).join('\n');
  return `### ${title}\n${lines}`;
};

const findingsBody = [
  renderCategory('Plugin / User Anomalies', byCategory.plugins_users),
  renderCategory('Filesystem Findings', byCategory.filesystem),
  renderCategory('Temporal Cluster', byCategory.temporal),
  renderCategory('Database Findings', byCategory.database),
  renderCategory('Core / Plugin Integrity', byCategory.integrity),
].filter(Boolean).join('\n\n');

const blindSpots = [
  '- **Runtime-assembled payloads**: code that fetches and assembles its payload at request time leaves no local trace',
  '- **Time-triggered or IP-conditional code**: only fires under specific conditions invisible to static analysis',
  '- **Upstream compromised plugins**: if a plugin was backdoored before installation, its checksum matches the backdoored version',
  '- **Image EXIF data**: not scanned for embedded PHP',
  '- **Premium / non-wordpress.org plugins**: cannot verify checksums',
  '- **Network-fetched payloads**: malware that downloads itself at runtime',
  allSignals.some(s => s.id === 'DB-02') ? null : '- **Full wp_options table**: only autoloaded options were scanned',
].filter(Boolean).join('\n');

const header = [
  '# Security Remediation Report',
  `**Site:** ${install.name}  `,
  `**Date:** ${dateStr}T${now.toISOString().slice(11, 16)}  `,
  `**Sandbox:** ${sandboxName}  `,
  `**Signals:** ${allSignals.length} total — ${allSignals.filter(s=>s.severity==='critical').length} critical, ${allSignals.filter(s=>s.severity==='high').length} high`,
  '',
  '## What the Sentinel Found',
  '',
  findingsBody || '(no signals detected)',
  '',
  '## Synthesis',
  synthesis || '(no synthesis)',
  '',
  '## Coverage Gaps (Blind Spots)',
  blindSpots,
  '',
  '## Remediation Checklist',
  '',
].join('\n');
```

- [ ] **Step 2: Test the report structure by running a mock**

```bash
node -e "
const agent = require('/Users/jeremy.pollock/Library/Application Support/Local/nexus-ai/agents/security-sentinel/agent.js');
// Check _test exports exist
console.log('buildRemediationChecklist:', typeof agent._test.buildRemediationChecklist);
console.log('tier3Remediate:', typeof agent._test.tier3Remediate);
console.log('OK');
" 2>&1
```

- [ ] **Step 3: Sync and commit**

```bash
npm run sync-agents 2>&1 | tail -2
git add agents/security-sentinel/agent.js
git commit -m "feat(sentinel-v2.1): structured report sections with named artifacts, blind spots disclosure, coverage summary"
```

---

## Self-Review

**Spec coverage check:**
- ABS-06 (suspicious filenames): ✅ Task 2
- ABS-07 (low-entropy names): ✅ Task 2
- ABS-08 (anti-forensics tools): ✅ Task 2
- FS-02 reports paths: ✅ Task 3
- FS-03 broader scan: ✅ Task 3
- FS-05 htaccess analysis: ✅ Task 3
- FS-06 ELF binaries: ✅ Task 3
- DB-01 post content: ✅ Task 4
- DB-02 options payloads: ✅ Task 4
- DB-03 usermeta objects: ✅ Task 4
- DB-04 comment spam: ✅ Task 4
- CHK-01 core checksums required: ✅ Task 5
- CHK-02 plugin checksums: ✅ Task 5
- Named artifacts in report: ✅ Tasks 1 + 6
- Blind spots section: ✅ Task 6

**Not covered in this plan (future work):**
- ABS-09 filesystem enumeration tools (scandir+curl pattern) — defer to v2.2
- DB-05 non-standard table content read — partially covered by CHK-01 approach
- CHK-02 unverifiable plugins flagging — included as a log line, not a full signal
- "See more details" UI wiring — the report markdown is richer, the UI reads it via the existing overlay; the `parseSentinelReport` was deleted and replaced by typed data, so the overlay will show synthesis + evidence from the `RemediationPlan.attackerItems` field once the synthesizer includes them
