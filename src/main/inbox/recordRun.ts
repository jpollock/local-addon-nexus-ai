import type { InboxStore } from './InboxStore';
import { failureCode } from './InboxStore';
import type { InboxItemInput } from './types';

// Covers both the SDK Finding shape and the renderer's SentinelTypes.Finding shape
interface RunFinding {
  id: string;
  // SDK shape (src/main/agent-sdk/types.ts:170)
  severity?: 'critical' | 'high' | 'medium' | 'low' | 'info';
  category?: 'active-compromise' | 'pre-breach' | 'misconfiguration' | 'informational';
  title?: string;
  description?: string;
  evidence?: Record<string, unknown>;
  // Renderer shape (SentinelTypes.Finding)
  sev?: string;
  plain?: string;
}

export interface RunForInbox {
  agentId: string;
  status?: 'success' | 'error' | 'timeout';
  error?: string;
  /** Preferred: per-site findings, from AgentResult.sites. */
  sites?: Record<string, { status: string; findings?: RunFinding[] }>;
  /** Fallback: run-level findings with no per-finding attribution. */
  findings?: RunFinding[];
  /** Which sites the run found something on. Only meaningful with `findings`. */
  findingsSites?: string[];
}

/**
 * Site names are display strings and collide across sources (CLAUDE.md,
 * "Names collide across sources"), so they are namespaced rather than used
 * bare. Resolving a name to a stable site id is a follow-up; the namespace
 * means that change will not silently merge two sites' items in the meantime.
 */
function siteScope(name: string): string {
  return `name:${name}`;
}

function findingItem(
  agentId: string, f: RunFinding, scope: string, scopeLabel: string,
): InboxItemInput {
  // Map severity === 'info' or category === 'informational' to kind: 'know'.
  // The original design said "Worth knowing" has no producer because the renderer
  // type had no 'info' severity, but the SDK type does.
  const kind =
    f.severity === 'info' || f.category === 'informational'
      ? 'know'
      : 'decide';

  // Serialize evidence, if present. A cyclic or unserializable evidence object must not cost the item.
  let evidenceStr: string | undefined;
  if (f.evidence !== undefined) {
    try {
      evidenceStr = JSON.stringify(f.evidence);
    } catch {
      evidenceStr = undefined;
    }
  }

  return {
    source: agentId,
    code: f.id,
    scope,
    scopeLabel,
    kind,
    title: f.title || f.id,
    detail: f.description ?? f.plain,  // SDK shape then renderer shape
    severity: f.severity ?? f.sev,     // SDK shape then renderer shape
    evidence: evidenceStr,
    payload: f,
  };
}

/** Write a run's findings and failure to the inbox. Returns items written. */
export function recordRunToInbox(
  store: InboxStore, run: RunForInbox, now: number = Date.now(),
): number {
  let written = 0;

  if (run.status === 'error' || run.status === 'timeout') {
    const message = run.error || `The run ended with status "${run.status}".`;
    store.record({
      source: run.agentId,
      code: failureCode(message),
      scope: '*',
      scopeLabel: 'This agent',
      kind: 'problem',
      title: `${run.agentId} could not finish a run`,
      detail: message,
      payload: { status: run.status },
    }, now);
    written++;
  }

  if (run.sites) {
    for (const [siteName, site] of Object.entries(run.sites)) {
      for (const f of site.findings ?? []) {
        store.record(findingItem(run.agentId, f, siteScope(siteName), siteName), now);
        written++;
      }
    }
    return written;
  }

  const findings = run.findings ?? [];
  if (findings.length === 0) return written;

  // No per-finding attribution available. One site is unambiguous; more is not,
  // so the item is fleet-scoped and labelled honestly rather than guessing.
  const sites = run.findingsSites ?? [];
  // Three distinct cases, and none of them may state something untrue:
  //   1 site   → name it
  //   n sites  → "n sites"
  //   0 sites  → we have findings but no attribution. Say that, do not say "0 sites".
  const scope = sites.length === 1 ? siteScope(sites[0]) : '*';
  const scopeLabel = sites.length === 1
    ? sites[0]
    : sites.length === 0
      ? 'Site not identified'
      : `${sites.length} sites`;

  for (const f of findings) {
    store.record(findingItem(run.agentId, f, scope, scopeLabel), now);
    written++;
  }
  return written;
}
