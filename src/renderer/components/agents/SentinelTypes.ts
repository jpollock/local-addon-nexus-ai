export type FindingSev = 'critical' | 'high' | 'medium';

export interface Finding {
  id: string;       // 'FS-01', 'ABS-05'
  sev: FindingSev;
  title: string;    // plain-language title
  plain: string;    // one-sentence explanation (derived from id for now)
}

export interface RemediationStep {
  n: number;
  title: string;
  by: 'agent' | 'wpe';  // 'wpe' when title contains "already enforced by WPE"
  review: boolean;       // true for Step 2 (account remediation)
  action: string;        // detail after the dash
  proof: string;         // same as action for now
  ok: boolean;           // ✅ = true, ❌/⚪ = false
  deferred?: boolean;    // ⚪ deferred steps
}

export interface AdminAccount {
  id: string;       // username
  user: string;     // username (monospace display)
  uid: number;      // placeholder uid (0 if unknown)
  email: string;
  created: string;
  score: number;    // 0–100
  breakdown: Array<{ t: string; pts: string }>;
  staged: string;   // what the agent did on the sandbox
  autoDeleted?: boolean;
  legitimate?: boolean;
}

export type AccountDecision = 'delete' | 'keep' | null;

export interface SentinelSignal {
  id: string;
  severity: string;
  category: string;
  installName: string;
  title: string;
  detail: string;
  fix: string;
  evidence: string[];
}

export interface SentinelCase {
  site: string;
  host: string;           // site + '.wpengine.com'
  env: 'PRODUCTION' | 'STAGING' | 'DEVELOPMENT';
  detectedAt: string;     // ISO from report Date field
  reportPath: string;     // full path to the report file
  sandbox: { id: string; url: string };
  verdict: 'ready' | 'blocked';
  failedSteps: number;
  findings: Finding[];
  steps: RemediationStep[];
  accounts: AdminAccount[];
  pendingApproval?: boolean;
  signals?: SentinelSignal[];
}
