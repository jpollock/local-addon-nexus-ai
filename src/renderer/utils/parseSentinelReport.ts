import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import type { SentinelCase, Finding, RemediationStep, AdminAccount } from '../components/agents/SentinelTypes';

// Map signal IDs to plain-language explanations
const SIGNAL_PLAIN: Record<string, string> = {
  'FS-01': 'A PHP file was found in must-use plugins — it loads on every page request and cannot be deactivated from WP Admin.',
  'FS-02': 'Code using multi-layer encoding (eval + base64/gzinflate/rot13) was found — a known malware hiding technique.',
  'FS-04': 'PHP files were found in the uploads directory, where only media files should exist.',
  'ABS-01': "An administrator account named 'admin' exists — the most commonly targeted username in brute-force attacks.",
  'ABS-02': 'There are more administrator accounts than expected for a site this size.',
  'ABS-03': "An admin account is using @example.com — the default WordPress placeholder email, indicating an attacker-created account.",
  'ABS-04': 'File manager plugins are active — they give WP Admin users full filesystem write access.',
  'ABS-05': 'A known backdoor plugin was found — it silently creates hidden administrator accounts on each page load.',
  'ABS-06': 'Authentication salts are still set to the default placeholder value, making session cookies forgeable.',
  'EXP-01': 'The WordPress REST API exposes usernames without authentication, enabling targeted brute-force attacks.',
  'EXP-03': 'The theme and plugin file editor is enabled — a compromised admin account can inject PHP directly from WP Admin.',
  'EXP-05': 'WP_DEBUG is enabled on a production site, exposing PHP errors and internal paths to visitors.',
  'LLM-USER-01': 'The AI identified administrator usernames that appear to be programmatically generated or follow attacker naming patterns.',
  'REL-02': 'Plugins have been activated since the last scan — they could be malicious or unvetted.',
};

function parseSev(raw: string): Finding['sev'] {
  const s = raw.toLowerCase();
  if (s === 'critical') return 'critical';
  if (s === 'high')     return 'high';
  return 'medium';
}

function parseFindings(lines: string[]): Finding[] {
  const findings: Finding[] = [];
  for (const line of lines) {
    const m = line.match(/^- \[([\w]+)\]\s+([\w-]+):\s+(.+)$/);
    if (!m) continue;
    const [, sev, id, title] = m;
    findings.push({ id, sev: parseSev(sev), title, plain: SIGNAL_PLAIN[id] || title });
  }
  return findings;
}

function parseSteps(lines: string[]): RemediationStep[] {
  const steps: RemediationStep[] = [];
  for (const line of lines) {
    // ✅ Step 1: Title — detail
    // ❌ Step 5: Title — detail
    // ⚪ Step 5: Title — detail (deferred)
    const m = line.match(/^([✅❌⚪])\s+Step\s+(\d+):\s+(.+?)(?:\s+—\s+(.*))?$/u);
    if (!m) continue;
    const [, icon, nStr, title, action = ''] = m;
    const ok = icon === '✅';
    const deferred = icon === '⚪';
    const n = parseInt(nStr, 10);
    const by: 'agent' | 'wpe' = action.toLowerCase().includes('wpe platform') ||
      action.toLowerCase().includes('already enforced') ? 'wpe' : 'agent';
    const review = n === 2; // Step 2 is the account remediation step
    steps.push({ n, title, by, review, action, proof: action, ok: ok || deferred, deferred });
  }
  return steps;
}

function parseAccounts(steps: RemediationStep[]): AdminAccount[] {
  // Account data is embedded in Step 2's action string as JSON
  const step2 = steps.find(s => s.n === 2);
  if (!step2) return [];
  const jsonMatch = step2.action.match(/\{.*\}/s);
  if (!jsonMatch) return [];
  try {
    const data = JSON.parse(jsonMatch[0]) as {
      auto_deleted?: string[];
      demoted?: Array<{ username: string; score: number; note: string }>;
      app_keys_deleted?: string[];
      flagged?: string[];
    };
    const accounts: AdminAccount[] = [];
    for (const username of (data.auto_deleted || [])) {
      accounts.push({
        id: username, user: username, uid: 0, email: '', created: '',
        score: 100, breakdown: [{ t: 'Auto-deleted (score 100)', pts: '+100' }],
        staged: 'Deleted from sandbox database',
        autoDeleted: true,
      });
    }
    for (const item of (data.demoted || [])) {
      accounts.push({
        id: item.username, user: item.username, uid: 0, email: '', created: '',
        score: item.score,
        breakdown: [
          { t: 'Demoted to subscriber on sandbox', pts: `score ${item.score}` },
          { t: 'Application passwords deleted', pts: 'immediate' },
        ],
        staged: `Demoted to subscriber, app keys deleted (score: ${item.score})`,
      });
    }
    return accounts;
  } catch {
    return [];
  }
}

export function parseSentinelReport(reportPath: string): SentinelCase | null {
  try {
    const content = fs.readFileSync(reportPath, 'utf-8');
    const lines = content.split('\n');

    // Site
    const siteLine = lines.find(l => l.startsWith('**Site:**'));
    const site = siteLine ? siteLine.replace('**Site:**', '').trim() : 'unknown';

    // Date
    const dateLine = lines.find(l => l.startsWith('**Date:**'));
    const detectedAt = dateLine ? dateLine.replace('**Date:**', '').trim() : new Date().toISOString();

    // Sandbox
    const sandboxLine = lines.find(l => l.startsWith('**Sandbox:**'));
    const sandboxId = sandboxLine ? sandboxLine.replace('**Sandbox:**', '').trim() : '';

    // Verdict
    const verdictLine = lines.find(l => l.includes('READY TO PUSH') || l.includes('NOT SAFE TO PUSH'));
    const verdict: SentinelCase['verdict'] = verdictLine?.includes('READY TO PUSH') ? 'ready' : 'blocked';

    // Section boundaries
    const findingsStart = lines.findIndex(l => l.startsWith('## Findings'));
    const checklistStart = lines.findIndex(l => l.startsWith('## Remediation Checklist'));
    const verdictBannerIdx = lines.findIndex(l => l.startsWith('## Verdict'));

    const findingLines = findingsStart >= 0 && checklistStart >= 0
      ? lines.slice(findingsStart + 1, checklistStart)
      : [];
    const checklistLines = checklistStart >= 0 && verdictBannerIdx >= 0
      ? lines.slice(checklistStart + 1, verdictBannerIdx)
      : [];

    const findings = parseFindings(findingLines);
    const steps = parseSteps(checklistLines);
    const accounts = parseAccounts(steps);
    const failedSteps = steps.filter(s => !s.ok).length;

    return {
      site,
      host: `${site}.wpengine.com`,
      env: 'PRODUCTION',
      detectedAt,
      reportPath,
      sandbox: { id: sandboxId, url: '' }, // url resolved at display time
      verdict,
      failedSteps,
      findings,
      steps,
      accounts,
    };
  } catch {
    return null;
  }
}

// Find the latest report for a site
export function findLatestReport(siteName: string): string | null {
  const reportsDir = path.join(
    os.homedir(),
    'Library', 'Application Support', 'Local', 'nexus-ai',
    'agents', 'security-sentinel', 'reports', siteName,
  );
  try {
    const files = fs.readdirSync(reportsDir)
      .filter(f => f.endsWith('.md'))
      .sort()
      .reverse();
    return files.length > 0 ? path.join(reportsDir, files[0]) : null;
  } catch {
    return null;
  }
}
