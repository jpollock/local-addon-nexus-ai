# Sentinel v2.2 — Deep File Examination Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Enrich existing Tier 2 signals with actual file content — reading suspicious PHP files, decoding obfuscated payloads, diffing tampered core files against wordpress.org originals, running `strings` on ELF binaries, and surfacing hardcoded C2 indicators as a new FS-07 signal.

**Architecture:** Five new async functions (`runContentExamination`, `runObfuscationDecoder`, `runCoreDiff`, `runElfStrings`, `runNetworkIndicators`) are called in `tier2Investigate` between the CHK checks and `collectSpecialistData`. Each operates on `fsSignals` in place — enriching `.evidence` arrays of existing signals or pushing a new FS-07 signal. No new files; everything goes in `agents/security-sentinel/agent.js`.

**Tech Stack:** CommonJS JS in agent.js, PHP via `tools.invoke('wp_eval')`, wordpress.org SVN API for core diff, `strings` binary (available on macOS/Linux) via `shell_exec` in PHP.

## Global Constraints

- All new functions are `async`, accept `(fsSignals, sandboxName, tools, log)`, and have try/catch — never let a content examination failure crash tier2Investigate.
- Evidence enrichment appends to existing signal `.evidence` arrays with lines prefixed `  → ` (two spaces + arrow) to distinguish metadata from file paths.
- PHP code runs in `wp_eval` with `skip_plugins: true, skip_themes: true`.
- Cap file reads at 3000 bytes per file for content preview; cap decoded payloads at 300 bytes; cap diff output at 10 lines per file.
- All five functions exported in `_test` at line 295.
- Injection point: after line 1543 (`log.info('Database scan complete...')`) and before line 1545 (`// Collect raw data for all specialists`).
- Tests go in `tests/unit/agents/security-sentinel/sentinel.test.js`, added to the existing describe block.
- Test with: `npm test -- --testPathPattern="sentinel" 2>&1 | tail -20`

---

### Task 1: Content examination — read FS-01/FS-03/ABS-09 files

Reads content of files already flagged by FS-01 (mu-plugins webshells), FS-03 (web root PHP), and ABS-09 (injected filenames). Appends dangerous function list, IPs, URLs, and a content preview to those signals' evidence arrays.

**Files:**
- Modify: `agents/security-sentinel/agent.js` — add `runContentExamination` function + call it + export it

**Interfaces:**
- Produces: `async function runContentExamination(fsSignals, sandboxName, tools, log)` — mutates `.evidence` of matching signals, returns `void`

- [ ] **Step 1: Write the failing test**

Add inside the existing `describe('security-sentinel')` block in `tests/unit/agents/security-sentinel/sentinel.test.js`:

```javascript
describe('runContentExamination', () => {
  const makeSignal = (id, evidence) => ({
    id, severity: 'critical', category: 'active-compromise',
    installName: 'test-site', title: 'test', detail: '', fix: '', evidence,
  });

  it('enriches FS-03 evidence with dangerous functions found', async () => {
    const { runContentExamination } = agent._test;
    const signal = makeSignal('FS-03', ['goods.php (unknown PHP in web root)']);
    const mockResult = JSON.stringify({
      'goods.php': {
        preview: '<?php eval(base64_decode("abc")); system($_GET["cmd"]);',
        functions: ['eval', 'base64_decode', 'system'],
        ips: ['1.2.3.4'],
        urls: ['http://evil.com/payload'],
        md5: 'abc123',
        size: 52,
      },
    });
    const tools = { invoke: jest.fn().mockResolvedValue(mockResult) };
    const log = { info: jest.fn(), warn: jest.fn() };

    await runContentExamination([signal], 'sandbox-abc', tools, log);

    expect(signal.evidence.some(e => e.includes('eval'))).toBe(true);
    expect(signal.evidence.some(e => e.includes('1.2.3.4'))).toBe(true);
    expect(signal.evidence.some(e => e.includes('evil.com'))).toBe(true);
    expect(signal.evidence.some(e => e.includes('preview'))).toBe(true);
  });

  it('skips signals that are not FS-01/FS-03/ABS-09', async () => {
    const { runContentExamination } = agent._test;
    const signal = makeSignal('FS-02', ['some/file.php — pattern: /eval/']);
    const tools = { invoke: jest.fn() };
    const log = { info: jest.fn(), warn: jest.fn() };

    await runContentExamination([signal], 'sandbox-abc', tools, log);

    expect(tools.invoke).not.toHaveBeenCalled();
  });

  it('does not throw when tools.invoke rejects', async () => {
    const { runContentExamination } = agent._test;
    const signal = makeSignal('FS-03', ['goods.php (unknown PHP in web root)']);
    const tools = { invoke: jest.fn().mockRejectedValue(new Error('wp_eval failed')) };
    const log = { info: jest.fn(), warn: jest.fn() };

    await expect(runContentExamination([signal], 'sandbox-abc', tools, log))
      .resolves.toBeUndefined();
    expect(log.warn).toHaveBeenCalledWith(expect.stringContaining('Content examination failed'));
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
npm test -- --testPathPattern="sentinel" 2>&1 | grep -A3 "runContentExamination"
```
Expected: `TypeError: runContentExamination is not a function`

- [ ] **Step 3: Implement `runContentExamination`**

Add this function before `tier2Investigate` (around line 820):

```javascript
async function runContentExamination(fsSignals, sandboxName, tools, log) {
  const DANGEROUS_FNS = ['eval', 'system', 'exec', 'passthru', 'shell_exec',
    'base64_decode', 'gzinflate', 'str_rot13', 'create_function', 'assert',
    'preg_replace', 'move_uploaded_file', 'curl_exec'];

  const toExamine = [];
  for (const signal of fsSignals) {
    if (!['FS-01', 'FS-03', 'ABS-09'].includes(signal.id)) continue;
    for (const ev of (signal.evidence || [])) {
      const p = ev.split(' ')[0];
      if (p && p.endsWith('.php') && !p.startsWith('  ')) {
        toExamine.push({ path: p, signal });
      }
    }
  }
  if (toExamine.length === 0) return;

  const paths = [...new Set(toExamine.map(f => f.path))].slice(0, 10);
  const pathsJson = JSON.stringify(paths);
  const fnsJson = JSON.stringify(DANGEROUS_FNS);

  try {
    const result = await tools.invoke('wp_eval', {
      site: sandboxName, skip_plugins: true, skip_themes: true,
      code: `
        $paths = ${pathsJson};
        $dangerous = ${fnsJson};
        $out = [];
        foreach ($paths as $rel) {
          if (strpos($rel, 'wp-content/') === 0) {
            $full = WP_CONTENT_DIR . substr($rel, strlen('wp-content'));
          } else {
            $full = ABSPATH . $rel;
          }
          if (!file_exists($full)) { $out[$rel] = ['error' => 'not found']; continue; }
          $content = @file_get_contents($full, false, null, 0, 3000);
          $found_fns = [];
          foreach ($dangerous as $fn) {
            if (stripos($content, $fn) !== false) $found_fns[] = $fn;
          }
          preg_match_all('/\\b(?:\\d{1,3}\\.){3}\\d{1,3}\\b/', $content, $ips);
          preg_match_all('/https?:\\/\\/[^\\s\'"<>]+/', $content, $urls);
          $out[$rel] = [
            'preview' => substr(preg_replace('/\\s+/', ' ', $content), 0, 200),
            'functions' => $found_fns,
            'ips' => array_values(array_unique($ips[0])),
            'urls' => array_values(array_unique($urls[0])),
            'md5' => md5($content),
            'size' => filesize($full),
          ];
        }
        echo json_encode($out);
      `,
    });

    const parsed = JSON.parse(extractResult(result) || '{}');

    for (const { path, signal } of toExamine) {
      const info = parsed[path];
      if (!info || info.error) continue;
      if (info.functions.length > 0) {
        signal.evidence.push(`  → dangerous functions: ${info.functions.join(', ')}`);
      }
      if (info.ips.length > 0) {
        signal.evidence.push(`  → hardcoded IPs: ${info.ips.join(', ')}`);
      }
      if (info.urls.length > 0) {
        signal.evidence.push(`  → external URLs: ${info.urls.slice(0, 3).join(', ')}`);
      }
      signal.evidence.push(`  → preview: ${info.preview}`);
    }

    log.info(`[Tier 2] Content examination: ${Object.keys(parsed).length} file(s) read`);
  } catch (err) {
    log.warn(`[Tier 2] Content examination failed: ${err.message}`);
  }
}
```

- [ ] **Step 4: Call it and export it**

After line 1543 in `tier2Investigate`:
```javascript
  log.info(`[Tier 2] Examining suspicious file content...`);
  await runContentExamination(fsSignals, sandboxName, tools, log);
```

In the `_test` export at line 295, add `runContentExamination` to the object.

- [ ] **Step 5: Run tests and verify they pass**

```bash
npm test -- --testPathPattern="sentinel" 2>&1 | grep -E "runContentExamination|PASS|FAIL"
```
Expected: all 3 runContentExamination tests pass.

- [ ] **Step 6: Commit**

```bash
git add agents/security-sentinel/agent.js tests/unit/agents/security-sentinel/sentinel.test.js
git commit -m "feat(sentinel-v2.2): FS content examination — reads FS-01/FS-03/ABS-09 files, appends dangerous functions + IPs + preview to evidence"
```

---

### Task 2: Obfuscation payload decoder

For FS-02 matches, attempts to decode the base64/gzinflate chain to reveal the inner payload. Appends decoded content to FS-02 evidence. Caps at 3 files and 300 bytes per decoded payload.

**Files:**
- Modify: `agents/security-sentinel/agent.js` — add `runObfuscationDecoder` function + call it + export it

**Interfaces:**
- Produces: `async function runObfuscationDecoder(fsSignals, sandboxName, tools, log)` — mutates FS-02 `.evidence`, returns `void`

- [ ] **Step 1: Write the failing test**

```javascript
describe('runObfuscationDecoder', () => {
  it('decodes base64 payloads from FS-02 evidence and appends to evidence', async () => {
    const { runObfuscationDecoder } = agent._test;
    const encodedPayload = Buffer.from('<?php system($_GET["cmd"]); ?>').toString('base64');
    const signal = {
      id: 'FS-02', severity: 'critical', category: 'active-compromise',
      installName: 'test', title: 'test', detail: '', fix: '',
      evidence: [`wp-content/plugins/noted/bad.php — pattern: /base64_decode/`],
    };
    const mockResult = JSON.stringify({
      'wp-content/plugins/noted/bad.php': [`<?php system($_GET["cmd"]); ?>`],
    });
    const tools = { invoke: jest.fn().mockResolvedValue(mockResult) };
    const log = { info: jest.fn(), warn: jest.fn() };

    await runObfuscationDecoder([signal], 'sandbox-abc', tools, log);

    expect(signal.evidence.some(e => e.includes('decoded payload'))).toBe(true);
    expect(signal.evidence.some(e => e.includes('system'))).toBe(true);
  });

  it('no-ops when no FS-02 signal present', async () => {
    const { runObfuscationDecoder } = agent._test;
    const tools = { invoke: jest.fn() };
    const log = { info: jest.fn(), warn: jest.fn() };

    await runObfuscationDecoder([], 'sandbox-abc', tools, log);
    expect(tools.invoke).not.toHaveBeenCalled();
  });

  it('does not throw when tools.invoke rejects', async () => {
    const { runObfuscationDecoder } = agent._test;
    const signal = {
      id: 'FS-02', severity: 'critical', category: 'active-compromise',
      installName: 'test', title: 'test', detail: '', fix: '',
      evidence: ['some/file.php — pattern: /base64_decode/'],
    };
    const tools = { invoke: jest.fn().mockRejectedValue(new Error('fail')) };
    const log = { info: jest.fn(), warn: jest.fn() };

    await expect(runObfuscationDecoder([signal], 'sandbox-abc', tools, log))
      .resolves.toBeUndefined();
    expect(log.warn).toHaveBeenCalledWith(expect.stringContaining('Obfuscation decoder failed'));
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
npm test -- --testPathPattern="sentinel" 2>&1 | grep "runObfuscationDecoder"
```
Expected: `TypeError: runObfuscationDecoder is not a function`

- [ ] **Step 3: Implement `runObfuscationDecoder`**

Add after `runContentExamination`:

```javascript
async function runObfuscationDecoder(fsSignals, sandboxName, tools, log) {
  const fs02 = fsSignals.find(s => s.id === 'FS-02');
  if (!fs02) return;

  const filesToDecode = (fs02.evidence || [])
    .map(e => e.split(' ')[0])
    .filter(p => p && p.includes('.php') && !p.startsWith('  '))
    .slice(0, 3);
  if (filesToDecode.length === 0) return;

  const pathsJson = JSON.stringify(filesToDecode);
  try {
    const result = await tools.invoke('wp_eval', {
      site: sandboxName, skip_plugins: true, skip_themes: true,
      code: `
        $paths = ${pathsJson};
        $out = [];
        foreach ($paths as $rel) {
          if (strpos($rel, 'wp-content/') === 0) {
            $full = WP_CONTENT_DIR . substr($rel, strlen('wp-content'));
          } else {
            $full = ABSPATH . $rel;
          }
          if (!file_exists($full)) continue;
          $content = @file_get_contents($full, false, null, 0, 20000);
          preg_match_all('/base64_decode\\s*\\(\\s*[\'"]([A-Za-z0-9+\\/=]{20,})[\'"]/', $content, $matches);
          $decoded = [];
          foreach ($matches[1] as $b64) {
            $d = @base64_decode($b64);
            if ($d === false || strlen($d) < 10) continue;
            $ungz = @gzinflate($d);
            $payload = substr(preg_replace('/\\s+/', ' ', $ungz ?: $d), 0, 300);
            if (strlen($payload) > 10) $decoded[] = $payload;
          }
          if (!empty($decoded)) $out[$rel] = $decoded;
        }
        echo json_encode($out);
      `,
    });

    const parsed = JSON.parse(extractResult(result) || '{}');
    for (const [path, payloads] of Object.entries(parsed)) {
      for (const payload of payloads) {
        fs02.evidence.push(`  → decoded payload in ${path.split('/').pop()}: ${payload}`);
      }
    }
    if (Object.keys(parsed).length > 0) {
      log.info(`[Tier 2] Obfuscation decoder: ${Object.keys(parsed).length} file(s) decoded`);
    }
  } catch (err) {
    log.warn(`[Tier 2] Obfuscation decoder failed: ${err.message}`);
  }
}
```

- [ ] **Step 4: Call it and export it**

After the `runContentExamination` call in `tier2Investigate`:
```javascript
  await runObfuscationDecoder(fsSignals, sandboxName, tools, log);
```

Add `runObfuscationDecoder` to the `_test` export.

- [ ] **Step 5: Run tests**

```bash
npm test -- --testPathPattern="sentinel" 2>&1 | grep -E "runObfuscationDecoder|PASS|FAIL"
```
Expected: all 3 tests pass.

- [ ] **Step 6: Commit**

```bash
git add agents/security-sentinel/agent.js tests/unit/agents/security-sentinel/sentinel.test.js
git commit -m "feat(sentinel-v2.2): obfuscation payload decoder — decodes base64/gzinflate chains in FS-02 files, appends inner payload to evidence"
```

---

### Task 3: Core file injection diff

For CHK-01 failures (non-wp-content PHP files), downloads the fresh original from `https://core.svn.wordpress.org/tags/{version}/{file}` and identifies lines present in the local file but not in the original — the injected code. Appends injected lines to CHK-01 evidence.

**Files:**
- Modify: `agents/security-sentinel/agent.js` — add `runCoreDiff` function + call it + export it

**Interfaces:**
- Produces: `async function runCoreDiff(fsSignals, sandboxName, tools, log)` — mutates CHK-01 `.evidence`, returns `void`

- [ ] **Step 1: Write the failing test**

```javascript
describe('runCoreDiff', () => {
  it('appends injected lines to CHK-01 evidence', async () => {
    const { runCoreDiff } = agent._test;
    const signal = {
      id: 'CHK-01', severity: 'critical', category: 'active-compromise',
      installName: 'test', title: 'test', detail: '', fix: '',
      evidence: ["Error: File doesn't verify against checksum: wp-blog-header.php"],
    };
    const mockResult = JSON.stringify({
      'wp-blog-header.php': ["<?php eval(base64_decode('INJECTED')); ?>"],
    });
    const tools = { invoke: jest.fn().mockResolvedValue(mockResult) };
    const log = { info: jest.fn(), warn: jest.fn() };

    await runCoreDiff([signal], 'sandbox-abc', tools, log);

    expect(signal.evidence.some(e => e.includes('injected lines'))).toBe(true);
    expect(signal.evidence.some(e => e.includes('INJECTED'))).toBe(true);
  });

  it('no-ops when no CHK-01 signal present', async () => {
    const { runCoreDiff } = agent._test;
    const tools = { invoke: jest.fn() };
    const log = { info: jest.fn(), warn: jest.fn() };

    await runCoreDiff([], 'sandbox-abc', tools, log);
    expect(tools.invoke).not.toHaveBeenCalled();
  });

  it('skips wp-content files', async () => {
    const { runCoreDiff } = agent._test;
    const signal = {
      id: 'CHK-01', severity: 'critical', category: 'active-compromise',
      installName: 'test', title: 'test', detail: '', fix: '',
      evidence: ["Error: File doesn't verify against checksum: wp-content/themes/t/style.css"],
    };
    const tools = { invoke: jest.fn().mockResolvedValue('{}') };
    const log = { info: jest.fn(), warn: jest.fn() };

    await runCoreDiff([signal], 'sandbox-abc', tools, log);
    // tools.invoke called but with empty files array → PHP returns {}
    const call = tools.invoke.mock.calls[0];
    expect(call[1].code).toContain('[]'); // empty $files
  });

  it('does not throw when tools.invoke rejects', async () => {
    const { runCoreDiff } = agent._test;
    const signal = {
      id: 'CHK-01', severity: 'critical', category: 'active-compromise',
      installName: 'test', title: 'test', detail: '', fix: '',
      evidence: ["Error: File doesn't verify against checksum: index.php"],
    };
    const tools = { invoke: jest.fn().mockRejectedValue(new Error('fail')) };
    const log = { info: jest.fn(), warn: jest.fn() };

    await expect(runCoreDiff([signal], 'sandbox-abc', tools, log)).resolves.toBeUndefined();
    expect(log.warn).toHaveBeenCalledWith(expect.stringContaining('Core diff failed'));
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
npm test -- --testPathPattern="sentinel" 2>&1 | grep "runCoreDiff"
```
Expected: `TypeError: runCoreDiff is not a function`

- [ ] **Step 3: Implement `runCoreDiff`**

Add after `runObfuscationDecoder`:

```javascript
async function runCoreDiff(fsSignals, sandboxName, tools, log) {
  const chk01 = fsSignals.find(s => s.id === 'CHK-01');
  if (!chk01) return;

  const coreFiles = (chk01.evidence || [])
    .map(e => e.replace(/^Error: File doesn't verify against checksum:\s*/, '').trim())
    .filter(f => !f.startsWith('wp-content/') && f.endsWith('.php') && f.length < 60)
    .slice(0, 3);

  const filesJson = JSON.stringify(coreFiles);
  try {
    const result = await tools.invoke('wp_eval', {
      site: sandboxName, skip_plugins: true, skip_themes: true,
      code: `
        global $wp_version;
        $files = ${filesJson};
        $out = [];
        foreach ($files as $rel) {
          $full = ABSPATH . $rel;
          if (!file_exists($full)) continue;
          $url = "https://core.svn.wordpress.org/tags/{$wp_version}/{$rel}";
          $resp = wp_remote_get($url, ['timeout' => 15]);
          if (is_wp_error($resp) || wp_remote_retrieve_response_code($resp) !== 200) {
            $out[$rel] = ['svn_error' => 'could not fetch original'];
            continue;
          }
          $original = wp_remote_retrieve_body($resp);
          $local = @file_get_contents($full);
          if ($local === $original) { $out[$rel] = ['injected' => []]; continue; }
          $orig_lines = explode("\\n", $original);
          $local_lines = explode("\\n", $local);
          $added = array_values(array_diff($local_lines, $orig_lines));
          $out[$rel] = ['injected' => array_slice($added, 0, 10)];
        }
        echo json_encode($out);
      `,
    });

    const parsed = JSON.parse(extractResult(result) || '{}');
    for (const [file, data] of Object.entries(parsed)) {
      if (data.svn_error) {
        chk01.evidence.push(`  → ${file}: ${data.svn_error}`);
      } else if (data.injected && data.injected.length > 0) {
        chk01.evidence.push(`  → ${file} injected lines: ${data.injected.map(l => l.trim()).filter(Boolean).slice(0, 5).join(' | ').slice(0, 300)}`);
      } else if (data.injected && data.injected.length === 0) {
        chk01.evidence.push(`  → ${file}: no line-level diff detected (binary or encoding difference)`);
      }
    }
    if (Object.keys(parsed).length > 0) {
      log.info(`[Tier 2] Core diff: ${Object.keys(parsed).length} file(s) compared`);
    }
  } catch (err) {
    log.warn(`[Tier 2] Core diff failed: ${err.message}`);
  }
}
```

- [ ] **Step 4: Call it and export it**

After `runObfuscationDecoder` call:
```javascript
  await runCoreDiff(fsSignals, sandboxName, tools, log);
```

Add `runCoreDiff` to the `_test` export.

- [ ] **Step 5: Run tests**

```bash
npm test -- --testPathPattern="sentinel" 2>&1 | grep -E "runCoreDiff|PASS|FAIL"
```
Expected: all 4 tests pass.

- [ ] **Step 6: Commit**

```bash
git add agents/security-sentinel/agent.js tests/unit/agents/security-sentinel/sentinel.test.js
git commit -m "feat(sentinel-v2.2): core file injection diff — downloads originals from wordpress.org SVN, shows injected lines in CHK-01 evidence"
```

---

### Task 4: ELF binary strings analysis

Runs `strings` on the first FS-06 binary, extracts lines matching network/command patterns (IPs, URLs, `/bin/sh`, `curl`, `connect`, etc.), and appends to FS-06 evidence. All ~2512KB ELF binaries are assumed identical (same MD5 confirmed).

**Files:**
- Modify: `agents/security-sentinel/agent.js` — add `runElfStrings` function + call it + export it

**Interfaces:**
- Produces: `async function runElfStrings(fsSignals, sandboxName, tools, log)` — mutates FS-06 `.evidence`, returns `void`

- [ ] **Step 1: Write the failing test**

```javascript
describe('runElfStrings', () => {
  it('appends strings indicators to FS-06 evidence', async () => {
    const { runElfStrings } = agent._test;
    const signal = {
      id: 'FS-06', severity: 'critical', category: 'active-compromise',
      installName: 'test', title: 'test', detail: '', fix: '',
      evidence: ['wp-content/plugins/noted/vendor/top_referrals (2512.2 KB)'],
    };
    const mockResult = JSON.stringify({
      md5: 'abc123def456',
      indicators: ['http://evil.com/c2', '/bin/sh', 'connect'],
      analyzed: 'top_referrals',
    });
    const tools = { invoke: jest.fn().mockResolvedValue(mockResult) };
    const log = { info: jest.fn(), warn: jest.fn() };

    await runElfStrings([signal], 'sandbox-abc', tools, log);

    expect(signal.evidence.some(e => e.includes('strings analysis'))).toBe(true);
    expect(signal.evidence.some(e => e.includes('evil.com'))).toBe(true);
    expect(signal.evidence.some(e => e.includes('/bin/sh'))).toBe(true);
  });

  it('no-ops when no FS-06 signal present', async () => {
    const { runElfStrings } = agent._test;
    const tools = { invoke: jest.fn() };
    const log = { info: jest.fn(), warn: jest.fn() };

    await runElfStrings([], 'sandbox-abc', tools, log);
    expect(tools.invoke).not.toHaveBeenCalled();
  });

  it('does not throw when tools.invoke rejects', async () => {
    const { runElfStrings } = agent._test;
    const signal = {
      id: 'FS-06', severity: 'critical', category: 'active-compromise',
      installName: 'test', title: 'test', detail: '', fix: '',
      evidence: ['wp-content/plugins/noted/vendor/top_referrals (2512.2 KB)'],
    };
    const tools = { invoke: jest.fn().mockRejectedValue(new Error('fail')) };
    const log = { info: jest.fn(), warn: jest.fn() };

    await expect(runElfStrings([signal], 'sandbox-abc', tools, log)).resolves.toBeUndefined();
    expect(log.warn).toHaveBeenCalledWith(expect.stringContaining('ELF strings failed'));
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
npm test -- --testPathPattern="sentinel" 2>&1 | grep "runElfStrings"
```
Expected: `TypeError: runElfStrings is not a function`

- [ ] **Step 3: Implement `runElfStrings`**

Add after `runCoreDiff`:

```javascript
async function runElfStrings(fsSignals, sandboxName, tools, log) {
  const fs06 = fsSignals.find(s => s.id === 'FS-06');
  if (!fs06 || !fs06.evidence || fs06.evidence.length === 0) return;

  const firstElf = fs06.evidence
    .map(e => e.split(' ')[0])
    .find(p => p && p.startsWith('wp-content/') && !p.startsWith('  '));
  if (!firstElf) return;

  const elfJson = JSON.stringify(firstElf);
  try {
    const result = await tools.invoke('wp_eval', {
      site: sandboxName, skip_plugins: true, skip_themes: true,
      code: `
        $rel = ${elfJson};
        $full = WP_CONTENT_DIR . substr($rel, strlen('wp-content'));
        if (!file_exists($full)) { echo json_encode(['error' => 'not found']); exit; }
        $md5 = md5_file($full);
        $output = shell_exec('strings ' . escapeshellarg($full) . ' 2>/dev/null');
        if ($output === null) { echo json_encode(['error' => 'strings not available', 'md5' => $md5]); exit; }
        $patterns = [
          '/https?:\\/\\//', '/\\b(?:\\d{1,3}\\.){3}\\d{1,3}\\b/',
          '/\\/bin\\/(sh|bash|dash)/', '/curl|wget|\\bnc\\b|ncat|netcat/',
          '/root|passwd|shadow/', '/chmod|chown|setuid/',
          '/\\/proc\\//', '/connect|socket|bind|listen/',
          '/cmd|command|shell|backdoor|reverse/',
        ];
        $interesting = [];
        foreach (explode("\\n", $output) as $line) {
          $line = trim($line);
          if (strlen($line) < 4 || strlen($line) > 200) continue;
          foreach ($patterns as $pat) {
            if (@preg_match($pat, $line)) { $interesting[] = $line; break; }
          }
        }
        echo json_encode([
          'md5' => $md5,
          'indicators' => array_values(array_unique(array_slice($interesting, 0, 30))),
          'analyzed' => basename($rel),
          'total_elf_count' => count(array_filter(${JSON.stringify(fs06.evidence.map(e => e.split(' ')[0]))}, fn($p) => $p && strpos($p, 'wp-content/') === 0)),
        ]);
      `.replace('${JSON.stringify(fs06.evidence.map(e => e.split(\' \')[0]))}',
        JSON.stringify(fs06.evidence.map(e => e.split(' ')[0]).filter(p => p && p.startsWith('wp-content/')))),
    });

    const parsed = JSON.parse(extractResult(result) || '{}');
    if (parsed.error) {
      fs06.evidence.push(`  → strings analysis unavailable: ${parsed.error}`);
      return;
    }
    if (parsed.indicators && parsed.indicators.length > 0) {
      fs06.evidence.push(`  → strings analysis of ${parsed.analyzed} (MD5: ${parsed.md5}):`);
      for (const ind of parsed.indicators.slice(0, 15)) {
        fs06.evidence.push(`    ${ind}`);
      }
    }
    log.info(`[Tier 2] ELF strings: ${parsed.indicators?.length ?? 0} indicator(s) from ${parsed.analyzed}`);
  } catch (err) {
    log.warn(`[Tier 2] ELF strings failed: ${err.message}`);
  }
}
```

Note: The PHP `total_elf_count` embedding is complex — simplify by removing it from PHP and just appending the count in JS:
```javascript
    if (parsed.indicators && parsed.indicators.length > 0) {
      const elfCount = fs06.evidence.filter(e => e.startsWith('wp-content/')).length;
      fs06.evidence.push(`  → strings analysis of ${parsed.analyzed} (MD5: ${parsed.md5}, ~${elfCount} total ELF files assumed identical):`);
      for (const ind of parsed.indicators.slice(0, 15)) {
        fs06.evidence.push(`    ${ind}`);
      }
    }
```

Use this simplified version (no PHP count embedding).

- [ ] **Step 4: Call it and export it**

After `runCoreDiff` call:
```javascript
  await runElfStrings(fsSignals, sandboxName, tools, log);
```

Add `runElfStrings` to the `_test` export.

- [ ] **Step 5: Run tests**

```bash
npm test -- --testPathPattern="sentinel" 2>&1 | grep -E "runElfStrings|PASS|FAIL"
```
Expected: all 3 tests pass.

- [ ] **Step 6: Commit**

```bash
git add agents/security-sentinel/agent.js tests/unit/agents/security-sentinel/sentinel.test.js
git commit -m "feat(sentinel-v2.2): ELF binary strings analysis — runs strings on first FS-06 binary, extracts network/command indicators into evidence"
```

---

### Task 5: Network indicators signal (FS-07)

Scans all PHP files referenced in FS-01/FS-02/FS-03/ABS-09 evidence for hardcoded IPs, external URLs, and C2 indicators. Creates a new FS-07 signal (critical) if any non-trivial indicators are found. Filters out localhost, wordpress.org, and common CDN domains.

**Files:**
- Modify: `agents/security-sentinel/agent.js` — add `runNetworkIndicators` function + call it + export it

**Interfaces:**
- Produces: `async function runNetworkIndicators(fsSignals, installName, sandboxName, tools, log)` — may push a new signal onto `fsSignals`, returns `void`

- [ ] **Step 1: Write the failing test**

```javascript
describe('runNetworkIndicators', () => {
  const makeSignal = (id, evidence) => ({
    id, severity: 'critical', category: 'active-compromise',
    installName: 'test', title: 'test', detail: '', fix: '', evidence,
  });

  it('creates FS-07 signal when IPs and URLs found', async () => {
    const { runNetworkIndicators } = agent._test;
    const signals = [makeSignal('FS-03', ['goods.php (unknown PHP in web root)'])];
    const mockResult = JSON.stringify({
      ips: ['185.220.101.5', '45.33.32.156'],
      urls: ['http://evil.com/payload.php', 'https://c2.attacker.net/gate.php'],
    });
    const tools = { invoke: jest.fn().mockResolvedValue(mockResult) };
    const log = { info: jest.fn(), warn: jest.fn() };

    await runNetworkIndicators(signals, 'test-site', 'sandbox-abc', tools, log);

    const fs07 = signals.find(s => s.id === 'FS-07');
    expect(fs07).toBeDefined();
    expect(fs07.severity).toBe('critical');
    expect(fs07.evidence.some(e => e.includes('185.220.101.5'))).toBe(true);
    expect(fs07.evidence.some(e => e.includes('evil.com'))).toBe(true);
  });

  it('does not create FS-07 when no indicators found', async () => {
    const { runNetworkIndicators } = agent._test;
    const signals = [makeSignal('FS-03', ['goods.php (unknown PHP in web root)'])];
    const mockResult = JSON.stringify({ ips: [], urls: [] });
    const tools = { invoke: jest.fn().mockResolvedValue(mockResult) };
    const log = { info: jest.fn(), warn: jest.fn() };

    await runNetworkIndicators(signals, 'test-site', 'sandbox-abc', tools, log);

    expect(signals.find(s => s.id === 'FS-07')).toBeUndefined();
  });

  it('does not throw when tools.invoke rejects', async () => {
    const { runNetworkIndicators } = agent._test;
    const signals = [makeSignal('FS-03', ['goods.php (unknown PHP in web root)'])];
    const tools = { invoke: jest.fn().mockRejectedValue(new Error('fail')) };
    const log = { info: jest.fn(), warn: jest.fn() };

    await expect(runNetworkIndicators(signals, 'test-site', 'sandbox-abc', tools, log))
      .resolves.toBeUndefined();
    expect(log.warn).toHaveBeenCalledWith(expect.stringContaining('Network indicator scan failed'));
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
npm test -- --testPathPattern="sentinel" 2>&1 | grep "runNetworkIndicators"
```
Expected: `TypeError: runNetworkIndicators is not a function`

- [ ] **Step 3: Implement `runNetworkIndicators`**

Add after `runElfStrings`:

```javascript
const TRUSTED_DOMAINS = ['wordpress.org', 'wp.com', 'w.org', 'gravatar.com',
  'jquery.com', 'googleapis.com', 'gstatic.com', 'bootstrapcdn.com'];

async function runNetworkIndicators(fsSignals, installName, sandboxName, tools, log) {
  const phpPaths = [];
  for (const sig of fsSignals) {
    if (!['FS-01', 'FS-02', 'FS-03', 'ABS-09'].includes(sig.id)) continue;
    for (const ev of (sig.evidence || [])) {
      const p = ev.split(' ')[0];
      if (p && p.endsWith('.php') && !p.startsWith('  ')) phpPaths.push(p);
    }
  }
  if (phpPaths.length === 0) return;

  const uniquePaths = [...new Set(phpPaths)].slice(0, 20);
  const pathsJson = JSON.stringify(uniquePaths);
  const trustedJson = JSON.stringify(TRUSTED_DOMAINS);

  try {
    const result = await tools.invoke('wp_eval', {
      site: sandboxName, skip_plugins: true, skip_themes: true,
      code: `
        $paths = ${pathsJson};
        $trusted = ${trustedJson};
        $all_ips = []; $all_urls = [];
        foreach ($paths as $rel) {
          if (strpos($rel, 'wp-content/') === 0) {
            $full = WP_CONTENT_DIR . substr($rel, strlen('wp-content'));
          } else {
            $full = ABSPATH . $rel;
          }
          if (!file_exists($full)) continue;
          $content = @file_get_contents($full, false, null, 0, 100000);
          preg_match_all('/\\b(?:\\d{1,3}\\.){3}\\d{1,3}\\b/', $content, $m);
          $all_ips = array_merge($all_ips, $m[0]);
          preg_match_all('/https?:\\/\\/[a-zA-Z0-9._\\-\\/\\?&=%#]+/', $content, $m);
          $all_urls = array_merge($all_urls, $m[0]);
        }
        $filtered_ips = array_values(array_unique(array_filter($all_ips, fn($ip) =>
          !in_array($ip, ['127.0.0.1', '0.0.0.0', '255.255.255.255'])
        )));
        $filtered_urls = array_values(array_unique(array_filter($all_urls, function($u) use ($trusted) {
          foreach ($trusted as $d) { if (strpos($u, $d) !== false) return false; }
          return true;
        })));
        echo json_encode(['ips' => $filtered_ips, 'urls' => array_slice($filtered_urls, 0, 20)]);
      `,
    });

    const parsed = JSON.parse(extractResult(result) || '{}');
    const ips = parsed.ips || [];
    const urls = parsed.urls || [];

    if (ips.length === 0 && urls.length === 0) return;

    const evidence = [
      ...ips.map(ip => `IP: ${ip}`),
      ...urls.map(url => `URL: ${url}`),
    ];

    fsSignals.push({
      id: 'FS-07', severity: 'critical', category: 'active-compromise',
      installName,
      title: `Hardcoded network indicators in suspicious PHP: ${ips.length} IP(s), ${urls.length} URL(s)`,
      detail: 'Suspicious PHP files contain hardcoded network indicators — likely C2 addresses, exfiltration endpoints, or attacker infrastructure.',
      fix: 'Investigate each indicator. Block at network/firewall level. Check server access logs for requests to these addresses.',
      evidence,
    });

    log.info(`[Tier 2] Network indicators: ${ips.length} IP(s), ${urls.length} URL(s) found`);
  } catch (err) {
    log.warn(`[Tier 2] Network indicator scan failed: ${err.message}`);
  }
}
```

- [ ] **Step 4: Call it and export it**

After `runElfStrings` call (note: `runNetworkIndicators` needs `install.name`):
```javascript
  await runNetworkIndicators(fsSignals, install.name, sandboxName, tools, log);
```

Add `runNetworkIndicators` to the `_test` export.

- [ ] **Step 5: Run all tests**

```bash
npm test -- --testPathPattern="sentinel" 2>&1 | tail -10
```
Expected: new tests pass, no regressions in existing 60 passing tests.

- [ ] **Step 6: Sync agents and commit**

```bash
npm run sync-agents 2>&1 | tail -2
git add agents/security-sentinel/agent.js tests/unit/agents/security-sentinel/sentinel.test.js
git commit -m "feat(sentinel-v2.2): FS-07 network indicator signal — scans suspicious PHP for hardcoded IPs/URLs, creates critical signal when C2 indicators found"
```
