#!/usr/bin/env node
/**
 * Nexus AI Eval Scorer — local web UI
 *
 * Usage: node tests/evals/viewer/server.js
 * Then open http://localhost:4242
 */

const express = require('express');
const fs = require('fs');
const path = require('path');

const app = express();
app.use(express.json());
app.use((req, res, next) => { res.set("Cache-Control", "no-store"); next(); });

const RESULTS_DIR = path.join(__dirname, '..', 'results');
const CASES_DIR = path.join(__dirname, '..', 'cases');
const SCORES_FILE = path.join(__dirname, '..', 'scores.json');
const SCORES_HISTORY_FILE = path.join(__dirname, '..', 'scores-history.jsonl');
const PORT = 4242;

// ---------------------------------------------------------------------------
// Central scores store (survives across runs)
// ---------------------------------------------------------------------------

function loadScores() {
  try {
    return fs.existsSync(SCORES_FILE) ? JSON.parse(fs.readFileSync(SCORES_FILE, 'utf-8')) : {};
  } catch { return {}; }
}

function saveScoresToStore(caseId, mode, scores, notes, runDir) {
  const store = loadScores();
  if (!store[caseId]) store[caseId] = {};
  const weighted = (
    (scores.task ?? 0) * 40 +
    (scores.steps ?? 0) * 30 +
    (scores.friction ?? 0) * 20 +
    (scores.clarity ?? 0) * 10
  ) / 100;

  store[caseId][mode] = {
    task: scores.task,
    steps: scores.steps,
    friction: scores.friction,
    clarity: scores.clarity,
    weighted: parseFloat(weighted.toFixed(1)),
    notes: notes || '',
    scoredAt: new Date().toISOString().slice(0, 10),
    runDir,
  };

  fs.writeFileSync(SCORES_FILE, JSON.stringify(store, null, 2));

  // Append to history
  const historyEntry = {
    timestamp: new Date().toISOString(),
    caseId, mode, runDir,
    scores: { ...scores },
    weighted: parseFloat(weighted.toFixed(1)),
    notes: notes || '',
  };
  fs.appendFileSync(SCORES_HISTORY_FILE, JSON.stringify(historyEntry) + '\n');

  return weighted;
}

function getScoresForCase(caseId) {
  const store = loadScores();
  return store[caseId] ?? {};
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function getRuns() {
  if (!fs.existsSync(RESULTS_DIR)) return [];
  return fs.readdirSync(RESULTS_DIR)
    .filter(d => fs.statSync(path.join(RESULTS_DIR, d)).isDirectory())
    .sort().reverse();
}

function getLatestRunForMode(mode) {
  return getRuns().find(r => r.endsWith(`-${mode}`));
}

function getCases() {
  if (!fs.existsSync(CASES_DIR)) return [];
  return fs.readdirSync(CASES_DIR)
    .filter(f => f.endsWith('.yaml'))
    .map(f => f.replace('.yaml', ''))
    .sort();
}

function getTranscript(runDir, caseId) {
  const file = path.join(RESULTS_DIR, runDir, `${caseId}-transcript.txt`);
  return fs.existsSync(file) ? fs.readFileSync(file, 'utf-8') : null;
}

function getScorecard(runDir, caseId) {
  const file = path.join(RESULTS_DIR, runDir, `${caseId}-scorecard.md`);
  return fs.existsSync(file) ? fs.readFileSync(file, 'utf-8') : null;
}

function parseAutoMetrics(transcript) {
  if (!transcript) return { cost: '—', calls: '—', duration: '—' };
  const cost = transcript.match(/^Cost:\s*\$?([\d.]+)/m)?.[1];
  const calls = transcript.match(/^Tool calls:\s*(\d+)/m)?.[1];
  const duration = transcript.match(/^Duration:\s*([\d.]+)/m)?.[1];
  return {
    cost: cost ? `$${parseFloat(cost).toFixed(4)}` : '—',
    calls: calls ?? '—',
    duration: duration ? `${Math.round(parseFloat(duration))}s` : '—',
  };
}

function parseExistingScores(scorecard) {
  // Legacy: parse from scorecard markdown (used when central store has no entry)
  if (!scorecard) return {};
  const parse = (pattern) => {
    const m = scorecard.match(pattern);
    if (!m || m[1] === 'TBD') return null;
    return parseInt(m[1], 10); // parseInt handles '0' correctly (returns 0, not falsy null)
  };
  return {
    task: parse(/Task completed.*?\|\s*(\d+|TBD)/),
    steps: parse(/Steps correct.*?\|\s*(\d+|TBD)/),
    friction: parse(/Friction.*?\|\s*(\d+|TBD)/),
    clarity: parse(/Output clarity.*?\|\s*(\d+|TBD)/),
  };
}

function saveScores(runDir, caseId, mode, scores, notes) {
  // Write to central store (primary — survives across runs)
  const weighted = saveScoresToStore(caseId, mode, scores, notes, runDir);

  // Also write to run-specific scorecard for backwards compat / human readable
  const file = path.join(RESULTS_DIR, runDir, `${caseId}-scorecard.md`);
  if (fs.existsSync(file)) {
    let content = fs.readFileSync(file, 'utf-8');
    const scoreBlock = `
## Human Scores (${mode}) — scored ${new Date().toISOString().slice(0,10)}

| Dimension | Score | Weight |
|-----------|-------|--------|
| Task completed | ${scores.task ?? 'TBD'} | 40% |
| Steps correct | ${scores.steps ?? 'TBD'} | 30% |
| Friction | ${scores.friction ?? 'TBD'} | 20% |
| Output clarity | ${scores.clarity ?? 'TBD'} | 10% |
| **Weighted Score** | **${weighted.toFixed(1)}** | |

**Notes:** ${notes || '—'}
`;
    content = content.includes('## Human Scores')
      ? content.replace(/## Human Scores[\s\S]*$/, scoreBlock)
      : content.replace('## Human Scores Needed', '~~Human Scores Needed~~') + scoreBlock;
    fs.writeFileSync(file, content);
  }

  return weighted;
}

// ---------------------------------------------------------------------------
// API Routes
// ---------------------------------------------------------------------------

app.get('/api/cases', (req, res) => {
  const cases = getCases();
  const cliRun = getLatestRunForMode('cli-skills');
  const mcpRun = getLatestRunForMode('mcp');

  const result = cases.map(caseId => {
    // Load scores from central store (primary); fall back to run scorecard
    const centralScores = getScoresForCase(caseId);
    const cliScores = centralScores['cli-skills'] ?? parseExistingScores(cliRun ? getScorecard(cliRun, caseId) : null);
    const mcpScores = centralScores['mcp'] ?? parseExistingScores(mcpRun ? getScorecard(mcpRun, caseId) : null);
    const cliMetrics = parseAutoMetrics(cliRun ? getTranscript(cliRun, caseId) : null);
    const mcpMetrics = parseAutoMetrics(mcpRun ? getTranscript(mcpRun, caseId) : null);
    const scored = !!(centralScores['cli-skills'] || centralScores['mcp']);
    return { caseId, scored, cliMetrics, mcpMetrics, cliScores, mcpScores };
  });

  res.json({ cases: result, cliRun, mcpRun });
});

app.get('/api/case/:caseId', (req, res) => {
  const { caseId } = req.params;
  const cliRun = req.query.cliRun || getLatestRunForMode('cli-skills');
  const mcpRun = req.query.mcpRun || getLatestRunForMode('mcp');

  const cliTranscript = cliRun ? getTranscript(cliRun, caseId) : null;
  const mcpTranscript = mcpRun ? getTranscript(mcpRun, caseId) : null;
  const cliScorecard = cliRun ? getScorecard(cliRun, caseId) : null;
  const mcpScorecard = mcpRun ? getScorecard(mcpRun, caseId) : null;

  // Load scores from central store; fall back to run scorecard
  const centralScores = getScoresForCase(caseId);
  const cliScores = centralScores['cli-skills'] ?? parseExistingScores(cliScorecard);
  const mcpScores = centralScores['mcp'] ?? parseExistingScores(mcpScorecard);

  res.json({
    caseId,
    cliRun, mcpRun,
    cliTranscript, mcpTranscript,
    cliMetrics: parseAutoMetrics(cliTranscript),
    mcpMetrics: parseAutoMetrics(mcpTranscript),
    cliScores,
    mcpScores,
  });
});

app.post('/api/score/:caseId', (req, res) => {
  const { caseId } = req.params;
  const { mode, runDir, scores, notes } = req.body;
  const weighted = saveScores(runDir, caseId, mode, scores, notes);
  res.json({ success: true, weighted });
});

app.get('/api/runs', (req, res) => {
  res.json({ runs: getRuns() });
});

app.get('/api/scores', (req, res) => {
  res.json(loadScores());
});

app.get('/api/scores/history', (req, res) => {
  try {
    if (!fs.existsSync(SCORES_HISTORY_FILE)) return res.json([]);
    const lines = fs.readFileSync(SCORES_HISTORY_FILE, 'utf-8').split('\n').filter(Boolean);
    res.json(lines.map(l => JSON.parse(l)));
  } catch { res.json([]); }
});

// ---------------------------------------------------------------------------
// UI
// ---------------------------------------------------------------------------

app.get('/', (req, res) => {
  res.send(/* html */`<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>Nexus AI Eval Scorer</title>
<style>
  * { box-sizing: border-box; margin: 0; padding: 0; }
  body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; background: #f5f5f5; color: #1a1a1a; }

  .header { background: #0ECAD4; color: white; padding: 14px 24px; display: flex; align-items: center; gap: 12px; }
  .header h1 { font-size: 18px; font-weight: 600; }
  .header .subtitle { font-size: 13px; opacity: 0.85; }

  .layout { display: grid; grid-template-columns: 280px 1fr; height: calc(100vh - 52px); }

  /* Sidebar */
  .sidebar { background: white; border-right: 1px solid #e5e7eb; overflow-y: auto; }
  .sidebar-header { padding: 16px; border-bottom: 1px solid #e5e7eb; font-size: 11px; font-weight: 600; text-transform: uppercase; letter-spacing: 0.05em; color: #6b7280; }
  .case-item { padding: 12px 16px; border-bottom: 1px solid #f3f4f6; cursor: pointer; display: flex; flex-direction: column; gap: 4px; }
  .case-item:hover { background: #f9fafb; }
  .case-item.active { background: #f0fdff; border-left: 3px solid #0ECAD4; }
  .case-name { font-size: 13px; font-weight: 500; }
  .case-meta { font-size: 11px; color: #9ca3af; display: flex; gap: 8px; }
  .scored-badge { background: #d1fae5; color: #065f46; font-size: 10px; padding: 1px 6px; border-radius: 10px; font-weight: 600; }

  /* Main */
  .main { overflow: hidden; display: flex; flex-direction: column; }
  .main-header { padding: 16px 24px; border-bottom: 1px solid #e5e7eb; background: white; display: flex; align-items: center; justify-content: space-between; }
  .main-header h2 { font-size: 15px; font-weight: 600; }
  .run-selector { font-size: 12px; color: #6b7280; }

  .panels { display: grid; grid-template-columns: 1fr 1fr; flex: 1; overflow: hidden; gap: 0; }

  .panel { display: flex; flex-direction: column; overflow: hidden; border-right: 1px solid #e5e7eb; }
  .panel:last-child { border-right: none; }
  .panel-header { padding: 12px 16px; background: #f9fafb; border-bottom: 1px solid #e5e7eb; display: flex; align-items: center; justify-content: space-between; }
  .panel-title { font-size: 13px; font-weight: 600; }
  .panel-metrics { font-size: 11px; color: #6b7280; display: flex; gap: 10px; }
  .metric { display: flex; gap: 3px; }
  .metric-label { color: #9ca3af; }

  .transcript { flex: 1; overflow-y: auto; padding: 16px; font-family: 'SF Mono', 'Monaco', monospace; font-size: 11px; line-height: 1.6; white-space: pre-wrap; word-break: break-word; background: #fafafa; }
  .transcript .tool-call { color: #7c3aed; }
  .transcript .tool-result { color: #047857; }
  .transcript .final-result { color: #1d4ed8; font-weight: 600; }
  .transcript .prompt { color: #b45309; font-weight: 600; }
  .no-transcript { padding: 32px; text-align: center; color: #9ca3af; font-size: 13px; font-family: -apple-system, sans-serif; }

  /* Scoring */
  .scoring { border-top: 1px solid #e5e7eb; background: white; padding: 16px 24px; display: grid; grid-template-columns: 1fr 1fr; gap: 24px; }
  .score-panel h3 { font-size: 12px; font-weight: 600; text-transform: uppercase; letter-spacing: 0.05em; color: #6b7280; margin-bottom: 12px; }
  .score-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 8px; margin-bottom: 10px; }
  .score-field label { font-size: 11px; color: #6b7280; display: block; margin-bottom: 3px; }
  .score-field input[type=range] { width: 100%; accent-color: #0ECAD4; }
  .score-field .val { font-size: 13px; font-weight: 600; color: #1a1a1a; }
  .notes-field { margin-bottom: 10px; }
  .notes-field label { font-size: 11px; color: #6b7280; display: block; margin-bottom: 3px; }
  .notes-field textarea { width: 100%; font-size: 12px; padding: 6px 8px; border: 1px solid #e5e7eb; border-radius: 6px; resize: none; height: 52px; }
  .save-btn { background: #0ECAD4; color: white; border: none; padding: 8px 20px; border-radius: 6px; font-size: 13px; font-weight: 600; cursor: pointer; width: 100%; }
  .save-btn:hover { background: #0ab5be; }
  .save-btn.saved { background: #10b981; }
  .weighted { font-size: 12px; color: #6b7280; text-align: center; margin-top: 6px; }

  .empty-state { display: flex; align-items: center; justify-content: center; height: 100%; color: #9ca3af; font-size: 14px; }
</style>
</head>
<body>

<div class="header">
  <div>
    <div class="header h1">Nexus AI Eval Scorer</div>
    <div class="subtitle">CLI/Skills vs MCP — side-by-side review</div>
  </div>
</div>

<div class="layout">
  <div class="sidebar">
    <div class="sidebar-header">Cases</div>
    <div id="case-list"></div>
  </div>

  <div class="main">
    <div class="main-header">
      <h2 id="case-title">Select a case</h2>
      <div class="run-selector" id="run-info"></div>
    </div>

    <div class="panels" id="panels">
      <div class="empty-state">Select a case from the sidebar</div>
    </div>

    <div class="scoring" id="scoring" style="display:none">
      <div class="score-panel">
        <h3>CLI/Skills Score</h3>
        <div class="score-grid">
          <div class="score-field">
            <label>Task completed <span class="val" id="cli-task-val">—</span></label>
            <input type="range" min="0" max="100" value="0" id="cli-task" oninput="updateVal('cli-task')">
          </div>
          <div class="score-field">
            <label>Steps correct <span class="val" id="cli-steps-val">—</span></label>
            <input type="range" min="0" max="100" value="0" id="cli-steps" oninput="updateVal('cli-steps')">
          </div>
          <div class="score-field">
            <label>Friction (100=smooth) <span class="val" id="cli-friction-val">—</span></label>
            <input type="range" min="0" max="100" value="0" id="cli-friction" oninput="updateVal('cli-friction')">
          </div>
          <div class="score-field">
            <label>Output clarity <span class="val" id="cli-clarity-val">—</span></label>
            <input type="range" min="0" max="100" value="0" id="cli-clarity" oninput="updateVal('cli-clarity')">
          </div>
        </div>
        <div class="notes-field">
          <label>Notes</label>
          <textarea id="cli-notes" placeholder="What worked well? What failed?"></textarea>
        </div>
        <button class="save-btn" id="cli-save-btn" onclick="saveScore('cli')">Save CLI Score</button>
        <div class="weighted" id="cli-weighted"></div>
      </div>

      <div class="score-panel">
        <h3>MCP Score</h3>
        <div class="score-grid">
          <div class="score-field">
            <label>Task completed <span class="val" id="mcp-task-val">—</span></label>
            <input type="range" min="0" max="100" value="0" id="mcp-task" oninput="updateVal('mcp-task')">
          </div>
          <div class="score-field">
            <label>Steps correct <span class="val" id="mcp-steps-val">—</span></label>
            <input type="range" min="0" max="100" value="0" id="mcp-steps" oninput="updateVal('mcp-steps')">
          </div>
          <div class="score-field">
            <label>Friction (100=smooth) <span class="val" id="mcp-friction-val">—</span></label>
            <input type="range" min="0" max="100" value="0" id="mcp-friction" oninput="updateVal('mcp-friction')">
          </div>
          <div class="score-field">
            <label>Output clarity <span class="val" id="mcp-clarity-val">—</span></label>
            <input type="range" min="0" max="100" value="0" id="mcp-clarity" oninput="updateVal('mcp-clarity')">
          </div>
        </div>
        <div class="notes-field">
          <label>Notes</label>
          <textarea id="mcp-notes" placeholder="What worked well? What failed?"></textarea>
        </div>
        <button class="save-btn" id="mcp-save-btn" onclick="saveScore('mcp')">Save MCP Score</button>
        <div class="weighted" id="mcp-weighted"></div>
      </div>
    </div>
  </div>
</div>

<script>
let currentCase = null;
let currentData = null;

function updateVal(id) {
  const el = document.getElementById(id);
  document.getElementById(id + '-val').textContent = el.value;
}

function formatTranscript(text) {
  if (!text) return '<div class="no-transcript">No transcript found for this run</div>';
  return '<pre>' + text
    .replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;')
    .replace(/(⏺ (?:Bash|Read|Edit|Grep|Glob|Write|Skill|ToolSearch|mcp__\\S+)\\(.*)/g, '<span class="tool-call">$1</span>')
    .replace(/(--- FINAL RESULT ---[\s\S]*)/g, '<span class="final-result">$1</span>')
    .replace(/(PROMPT: .+)/g, '<span class="prompt">$1</span>')
    + '</pre>';
}

async function loadCases() {
  const res = await fetch('/api/cases');
  const { cases, cliRun, mcpRun } = await res.json();

  const list = document.getElementById('case-list');
  list.innerHTML = cases.map(c => {
    const cliCost = c.cliMetrics.cost || '—';
    const mcpCost = c.mcpMetrics.cost || '—';
    const cliTime = c.cliMetrics.duration || '';
    const mcpTime = c.mcpMetrics.duration || '';
    return \`<div class="case-item \${c.scored ? 'scored' : ''}" onclick="loadCase('\${c.caseId}')">
      <div class="case-name">\${c.caseId.replace(/^\\d+-/, '').replace(/-/g, ' ')}</div>
      <div class="case-meta">
        <span>CLI: \${cliCost}\${cliTime ? ' · ' + cliTime : ''}</span>
        <span>MCP: \${mcpCost}\${mcpTime ? ' · ' + mcpTime : ''}</span>
        \${c.scored ? '<span class="scored-badge">scored</span>' : ''}
      </div>
    </div>\`;
  }).join('');
}

async function loadCase(caseId) {
  document.querySelectorAll('.case-item').forEach(el => {
    el.classList.toggle('active', el.querySelector('.case-name').textContent === caseId.replace(/^\\d+-/, '').replace(/-/g, ' '));
  });

  currentCase = caseId;
  const res = await fetch(\`/api/case/\${caseId}\`);
  currentData = await res.json();

  document.getElementById('case-title').textContent = caseId;
  const fmtRun = (r) => {
    if (!r) return 'no run';
    // e.g. 2026-04-24-0552-cli-skills → Apr 24, 05:52
    const m = r.match(/(\d{4})-(\d{2})-(\d{2})-(\d{2})(\d{2})/);
    if (!m) return r;
    const months = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
    return \`\${months[+m[2]-1]} \${+m[3]}, \${m[4]}:\${m[5]}\`;
  };
  document.getElementById('run-info').textContent = \`CLI: \${fmtRun(currentData.cliRun)} · MCP: \${fmtRun(currentData.mcpRun)}\`;

  const { cliMetrics: cm, mcpMetrics: mm } = currentData;
  document.getElementById('panels').innerHTML = \`
    <div class="panel">
      <div class="panel-header">
        <div style="display:flex;flex-direction:column;gap:2px">
          <div class="panel-title">CLI / Skills</div>
          <div style="font-size:10px;color:#9ca3af">\${fmtRun(currentData.cliRun)}</div>
        </div>
        <div class="panel-metrics">
          <span class="metric"><span class="metric-label">cost</span> \${cm.cost}</span>
          <span class="metric"><span class="metric-label">calls</span> \${cm.calls}</span>
          <span class="metric"><span class="metric-label">time</span> \${cm.duration}</span>
        </div>
      </div>
      <div class="transcript">\${formatTranscript(currentData.cliTranscript)}</div>
    </div>
    <div class="panel">
      <div class="panel-header">
        <div style="display:flex;flex-direction:column;gap:2px">
          <div class="panel-title">MCP</div>
          <div style="font-size:10px;color:#9ca3af">\${fmtRun(currentData.mcpRun)}</div>
        </div>
        <div class="panel-metrics">
          <span class="metric"><span class="metric-label">cost</span> \${mm.cost}</span>
          <span class="metric"><span class="metric-label">calls</span> \${mm.calls}</span>
          <span class="metric"><span class="metric-label">time</span> \${mm.duration}</span>
        </div>
      </div>
      <div class="transcript">\${formatTranscript(currentData.mcpTranscript)}</div>
    </div>
  \`;

  // Pre-fill existing scores
  for (const mode of ['cli', 'mcp']) {
    const scores = mode === 'cli' ? currentData.cliScores : currentData.mcpScores;
    for (const dim of ['task', 'steps', 'friction', 'clarity']) {
      const el = document.getElementById(\`\${mode}-\${dim}\`);
      const val = scores[dim];
      if (val !== null && val !== undefined) {
        el.value = val;
        document.getElementById(\`\${mode}-\${dim}-val\`).textContent = val;
      }
    }
  }

  document.getElementById('scoring').style.display = 'grid';
}

async function saveScore(mode) {
  const scores = {};
  for (const dim of ['task', 'steps', 'friction', 'clarity']) {
    scores[dim] = parseInt(document.getElementById(\`\${mode}-\${dim}\`).value);
  }
  const notes = document.getElementById(\`\${mode}-notes\`).value;
  const runDir = mode === 'cli' ? currentData.cliRun : currentData.mcpRun;

  const res = await fetch(\`/api/score/\${currentCase}\`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ mode, runDir, scores, notes }),
  });
  const { weighted } = await res.json();

  const btn = document.getElementById(\`\${mode}-save-btn\`);
  btn.textContent = '✓ Saved';
  btn.classList.add('saved');
  document.getElementById(\`\${mode}-weighted\`).textContent = \`Weighted score: \${weighted.toFixed(1)} / 100\`;
  setTimeout(() => { btn.textContent = \`Save \${mode.toUpperCase()} Score\`; btn.classList.remove('saved'); }, 2000);
  loadCases();
}

(async () => {
  await loadCases();
  const params = new URLSearchParams(window.location.search);
  const c = params.get('case');
  if (c) await loadCase(c);
})();
</script>
</body>
</html>`);
});

// ---------------------------------------------------------------------------

app.listen(PORT, () => {
  console.log(`\n  Nexus AI Eval Scorer`);
  console.log(`  ─────────────────────`);
  console.log(`  http://localhost:${PORT}\n`);
});
