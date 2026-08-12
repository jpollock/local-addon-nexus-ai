/**
 * ExternalHostAddWizard — "Add an external SSH host" wizard.
 *
 * Step 1: pick an existing, not-yet-registered SSH config alias (or create a
 * new entry). Step 2: a multi-issue probe checklist — all four check rows
 * (connection / hostKey / wpCli / installs) stay visible at all times, and
 * every non-OK finding gets its own resolution card (parallel diagnosis, not
 * a one-issue-at-a-time wizard). Steps 3/4 and mounting this component from
 * SettingsTab are a separate, later task; this file will be extended by that
 * task, not replaced.
 *
 * Class-based, React.createElement only — no JSX, no hooks, matching every
 * other file in src/renderer.
 */
import * as React from 'react';
import { IPC_CHANNELS } from '../../../common/constants';
import { rendererGql } from '../../utils/rendererGql';
import { nexusStore } from '../../store/NexusStateManager';

// ---------------------------------------------------------------------------
// Host-key / multi-issue probe timeout
// ---------------------------------------------------------------------------

/**
 * Same value as HOST_PROBE_CLIENT_TIMEOUT_MS in
 * src/renderer/components/SettingsTab.tsx (and HOST_PROBE_CLIENT_TIMEOUT_MS
 * in src/cli/commands/host.ts) — sized for probeExternalHost's documented
 * ~155s sequential worst case. Duplicated rather than imported because
 * SettingsTab.tsx does not export its constant; if you raise one, raise all
 * three.
 */
const HOST_PROBE_CLIENT_TIMEOUT_MS = 210000;

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface SshConfigHostLike {
  alias: string;
  hostname: string;
  user: string;
  port: number | string;
  identityFile?: string;
  proxyJump?: string;
  alreadyRegistered: boolean;
}

export interface NexusHostCheckStateLike {
  status: 'ok' | 'warn' | 'fail' | 'idle';
  detail: string;
}

export interface NexusHostIssueLike {
  kind: string;
  title: string;
  detail: string;
  remedy: string;
  fingerprint?: string;
  keyType?: string;
  previousFingerprint?: string;
}

export interface NexusHostMultiIssueProbeLike {
  checks: {
    connection: NexusHostCheckStateLike;
    hostKey: NexusHostCheckStateLike;
    wpCli: NexusHostCheckStateLike;
    installs: NexusHostCheckStateLike;
  };
  issues: NexusHostIssueLike[];
  wpCliVersion: string | null;
  installs: string[] | null;
}

interface NewEntryForm {
  alias: string;
  hostname: string;
  user: string;
  port: string;
  keySource: 'agent' | 'file';
  identityFile: string;
}

type CollisionLike =
  | { kind: 'none' }
  | { kind: 'exact'; file: string; line: number }
  | { kind: 'pattern'; pattern: string; file: string };

interface PreviewState {
  block: string;
  collision: CollisionLike;
}

export type SiteEnvironment = 'production' | 'staging' | 'development';

export interface SiteSelection {
  /** Filesystem path to the WordPress install, from multiIssue.installs[i]
   *  or the manual "add a path discovery missed" input. Sent as-is to
   *  nexusHostAddSites so it can disambiguate multiple installs. */
  path: string;
  /** Editable site name/slug -- the 'site' field of NexusHostSiteEnvironmentInput. */
  site: string;
  include: boolean;
  environment: SiteEnvironment;
  /** Never populated today -- probeHostMultiIssue's installs array is a bare
   *  string[] with no multisite signal. Kept so the row renderer can show a
   *  badge the day that data exists, without inventing it now. */
  multisite?: boolean;
}

export interface SiteVerificationResult {
  site: string;
  verified: boolean;
  error?: string | null;
}

/** Derives a default site slug from a discovered install path, e.g.
 *  '/var/www/example.com/htdocs' -> 'htdocs'. Best-effort only -- the field
 *  stays editable in Step 3 so a bad guess never blocks registration. */
function deriveSiteNameFromPath(path: string): string {
  const trimmed = path.replace(/\/+$/, '');
  const last = trimmed.split('/').filter(Boolean).pop() || trimmed;
  return slugify(last || trimmed);
}

function slugify(raw: string): string {
  const slug = (raw || 'site').toLowerCase().replace(/[^a-z0-9-]+/g, '-').replace(/^-+|-+$/g, '');
  return slug || 'site';
}

/**
 * Derives one site slug per discovered path, disambiguating collisions
 * instead of letting them through -- a standard shared-host layout like
 * '/home/u/domains/foo.com/public_html' and
 * '/home/u/domains/bar.com/public_html' both derive 'public_html' from their
 * last path segment alone, and since externalSiteId(alias, site) keys on
 * that slug, an undisambiguated collision means the second nexusHostAddSites
 * call in the batch silently overwrites the first site's registration while
 * Step 4 still reports "2 of 2 verified".
 *
 * Only paths that actually collide grow an extra path segment (e.g.
 * 'foo.com-public_html' vs 'bar.com-public_html') -- an already-unique name
 * elsewhere in the batch is left alone rather than churned just because some
 * unrelated pair collided. If two paths are identical all the way to their
 * root (segments exhausted) a numeric suffix breaks the remaining tie.
 */
function deriveUniqueSiteNames(paths: string[]): string[] {
  const segsList = paths.map((p) => p.replace(/\/+$/, '').split('/').filter(Boolean));
  const result = new Array<string>(paths.length);

  const assign = (indices: number[], depth: number): void => {
    const groups = new Map<string, number[]>();
    for (const i of indices) {
      const segs = segsList[i];
      const candidate = slugify(segs.slice(-depth).join('-'));
      const group = groups.get(candidate) ?? [];
      group.push(i);
      groups.set(candidate, group);
    }
    for (const [candidate, idxs] of groups) {
      if (idxs.length === 1) {
        result[idxs[0]] = candidate;
        continue;
      }
      const canGoDeeper = idxs.some((i) => segsList[i].length > depth);
      if (canGoDeeper) {
        assign(idxs, depth + 1);
      } else {
        idxs.forEach((i, n) => {
          result[i] = n === 0 ? candidate : `${candidate}-${n + 1}`;
        });
      }
    }
  };

  assign(paths.map((_, i) => i), 1);
  return result;
}

export interface ExternalHostAddWizardProps {
  electron: any;
  onClose: () => void;
  onCompleted: (alias: string) => void;
  /**
   * Fired when Step 2's Continue button advances the wizard past the
   * zero-issue state. The wizard itself now also transitions internally to
   * Step 3 (see advanceToStep3) -- this prop remains a separate notification
   * hook so a parent (SettingsTab) can react (e.g. logging) without owning
   * the wizard's own step machinery.
   */
  onProbeClean: (alias: string) => void;
}

interface ExternalHostAddWizardState {
  step: 1 | 2 | 3 | 4;
  step1Mode: 'pick' | 'new';
  loadingHosts: boolean;
  hosts: SshConfigHostLike[];
  loadHostsError: string | null;

  newEntry: NewEntryForm;
  preview: PreviewState | null;
  writing: boolean;
  writeError: string | null;

  alias: string;
  probing: boolean;
  probeError: string | null;
  multiIssue: NexusHostMultiIssueProbeLike | null;

  approvingKind: string | null;
  applyingRootMode: boolean;

  // ── Step 3: site picker ──────────────────────────────────────────────────
  siteSelections: SiteSelection[];
  manualPath: string;
  registering: boolean;
  registerError: string | null;

  // ── Step 4: registration result ──────────────────────────────────────────
  /** The exact set of sites submitted by submitStep3, in submission order --
   *  siteVerification's order mirrors this per the mutation's contract, and
   *  a failed row's Retry needs this entry's path/environment/site to re-call
   *  nexusHostAddSites scoped to just that one site. */
  includedSelections: SiteSelection[];
  siteVerification: SiteVerificationResult[] | null;
  retryingIndex: number | null;
}

const emptyNewEntry: NewEntryForm = { alias: '', hostname: '', user: '', port: '22', keySource: 'agent', identityFile: '' };

// ---------------------------------------------------------------------------
// Style palette — reuses GenericApprovalDrawer's --ag-* custom properties.
// ---------------------------------------------------------------------------

const scrimStyle: React.CSSProperties = {
  position: 'fixed', inset: 0, background: 'rgba(8,9,12,0.55)', zIndex: 40,
};
const panelStyle: React.CSSProperties = {
  position: 'fixed', top: 0, right: 0, bottom: 0, width: 560,
  background: 'var(--ag-bg-card)', borderLeft: '1px solid var(--ag-border)',
  zIndex: 41, display: 'flex', flexDirection: 'column',
};
const headerStyle: React.CSSProperties = {
  display: 'flex', alignItems: 'flex-start', gap: 16, padding: '24px 24px 20px',
  borderBottom: '1px solid var(--ag-border-subtle)',
};
const bodyStyle: React.CSSProperties = { flex: 1, overflowY: 'auto', padding: 24 };
const footerStyle: React.CSSProperties = {
  display: 'flex', gap: 10, padding: '16px 24px', borderTop: '1px solid var(--ag-border-subtle)',
};
const primaryButtonStyle: React.CSSProperties = {
  flex: 1, background: 'var(--ag-teal)', border: 'none', borderRadius: 8, padding: '10px 0',
  fontSize: 13.5, fontWeight: 600, color: 'var(--ag-on-teal)', cursor: 'pointer',
};
const secondaryButtonStyle: React.CSSProperties = {
  background: 'var(--ag-bg-elevated)', border: '1px solid var(--ag-border-control)', borderRadius: 8,
  padding: '10px 14px', fontSize: 13.5, fontWeight: 500, color: 'var(--ag-text-secondary)', cursor: 'pointer',
};
const inputStyle: React.CSSProperties = {
  width: '100%', fontSize: 13, padding: '8px 10px', borderRadius: 6,
  border: '1px solid var(--ag-border-control)', background: 'var(--ag-bg-inset)',
  color: 'var(--ag-text-primary)', fontFamily: 'inherit', boxSizing: 'border-box',
};
const labelStyle: React.CSSProperties = {
  fontSize: 11.5, fontWeight: 600, color: 'var(--ag-text-muted)', marginBottom: 5, marginTop: 12,
  textTransform: 'uppercase', letterSpacing: '0.05em',
};
const rowLine: React.CSSProperties = {
  display: 'flex', alignItems: 'center', justifyContent: 'space-between',
  padding: '10px 0', borderBottom: '1px solid var(--ag-border-subtle)',
};

function statusColor(status: NexusHostCheckStateLike['status']): string {
  switch (status) {
    case 'ok': return 'var(--ag-green)';
    case 'warn': return 'var(--ag-amber)';
    case 'fail': return 'var(--ag-red)';
    default: return 'var(--ag-text-faint)';
  }
}

function statusDot(status: NexusHostCheckStateLike['status']): React.ReactNode {
  return React.createElement('div', {
    style: { width: 8, height: 8, borderRadius: '50%', background: statusColor(status), flexShrink: 0 },
  });
}

/** Card border/background for a "fail"-severity resolution card. */
const failCardStyle: React.CSSProperties = {
  border: '1px solid var(--ag-red)', borderColor: 'var(--ag-red)',
  background: 'rgba(239,68,68,0.06)', borderRadius: 8, padding: '12px 14px', marginBottom: 10,
};
/** Card border/background for a "warn"-severity resolution card — deliberately
 * distinct from failCardStyle: wpCliMissing/wpCliInteractivePathOnly correspond
 * to `checks.wpCli.status === 'warn'`, not a hard failure. */
const warnCardStyle: React.CSSProperties = {
  border: '1px solid var(--ag-amber)', borderColor: 'var(--ag-amber)',
  background: 'rgba(245,158,11,0.06)', borderRadius: 8, padding: '12px 14px', marginBottom: 10,
};

// ---------------------------------------------------------------------------
// Dedup helper
// ---------------------------------------------------------------------------

function dedupeIssuesByKind(issues: NexusHostIssueLike[]): NexusHostIssueLike[] {
  const seen = new Set<string>();
  const out: NexusHostIssueLike[] = [];
  for (const issue of issues) {
    if (seen.has(issue.kind)) continue;
    seen.add(issue.kind);
    out.push(issue);
  }
  return out;
}

const CONNECTION_ISSUE_KINDS = new Set([
  'authKeyNotLoaded', 'authPassphraseNoAgent', 'connRefused', 'connTimeout', 'proxyJumpFailed', 'aliasNotFound',
]);

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export class ExternalHostAddWizard extends React.Component<ExternalHostAddWizardProps, ExternalHostAddWizardState> {
  mounted = false;

  // Bumped at the start of every probeAlias() call. A response that resolves
  // late (superseded by a newer probe — e.g. a fast re-probe or picking a
  // different alias) is discarded rather than overwriting a newer result.
  // Same pattern as SettingsTab.tsx's hostKeyCheckSeq.
  private probeSeq = 0;
  // Bumped at the start of every previewEntry() call, since the create-entry
  // form calls PREVIEW_SSH_HOST_ENTRY on every keystroke and out-of-order
  // responses are a real risk.
  private previewSeq = 0;

  state: ExternalHostAddWizardState = {
    step: 1,
    step1Mode: 'pick',
    loadingHosts: true,
    hosts: [],
    loadHostsError: null,

    newEntry: emptyNewEntry,
    preview: null,
    writing: false,
    writeError: null,

    alias: '',
    probing: false,
    probeError: null,
    multiIssue: null,

    approvingKind: null,
    applyingRootMode: false,

    siteSelections: [],
    manualPath: '',
    registering: false,
    registerError: null,

    includedSelections: [],
    siteVerification: null,
    retryingIndex: null,
  };

  async componentDidMount(): Promise<void> {
    this.mounted = true;
    // Tell the docked panel to stand down: this wizard reaches the right edge, where the
    // collapsed tab floats, and the tab was covering the "Already registered" column.
    nexusStore.update({ overlayOpen: true });
    await this.loadHosts();
  }

  componentWillUnmount(): void {
    this.mounted = false;
    // Cleared on unmount rather than on each close path, so an early return, an error
    // or a parent swapping the screen out cannot leave the tab permanently hidden.
    nexusStore.update({ overlayOpen: false });
  }

  // ── Step 1a: alias picker ────────────────────────────────────────────────

  async loadHosts(): Promise<void> {
    this.setState({ loadingHosts: true, loadHostsError: null });
    try {
      const result = await this.props.electron.ipcRenderer.invoke(IPC_CHANNELS.LIST_SSH_CONFIG_HOSTS);
      if (!this.mounted) return;
      if (result?.success) {
        this.setState({ hosts: result.hosts ?? [], loadingHosts: false });
      } else {
        this.setState({ loadHostsError: result?.error ?? 'Could not list SSH config hosts.', loadingHosts: false });
      }
    } catch (e: any) {
      if (!this.mounted) return;
      this.setState({ loadHostsError: e?.message ?? String(e), loadingHosts: false });
    }
  }

  selectAlias = async (alias: string): Promise<void> => {
    const host = this.state.hosts.find(h => h.alias === alias);
    if (host?.alreadyRegistered) return; // dimmed/non-selectable — refuse the click.
    await this.probeAlias(alias);
  };

  switchToCreateNew = (): void => {
    this.setState({ step1Mode: 'new', newEntry: emptyNewEntry, preview: null, writeError: null });
  };

  backToPicker = (): void => {
    this.setState({ step1Mode: 'pick' });
  };

  // ── Step 1b: create-entry form ───────────────────────────────────────────

  updateNewEntryField = (field: keyof NewEntryForm, value: string): void => {
    this.setState(prev => {
      const updated = { ...prev.newEntry, [field]: value };
      // When switching to agent mode, clear the identity file path
      if (field === 'keySource' && value === 'agent') {
        updated.identityFile = '';
      }
      return { newEntry: updated };
    });
    // Fire-and-forget: preview updates live as the user types.
    void this.previewEntry();
  };

  async previewEntry(): Promise<void> {
    const mySeq = ++this.previewSeq;
    const { alias, hostname, user, port, keySource, identityFile } = this.state.newEntry;
    if (!alias || !hostname) return;
    try {
      const result = await this.props.electron.ipcRenderer.invoke(IPC_CHANNELS.PREVIEW_SSH_HOST_ENTRY, {
        alias, hostname, user, port, identityFile: keySource === 'agent' ? '' : identityFile,
      });
      if (!this.mounted || mySeq !== this.previewSeq) return;
      if (result?.success) {
        this.setState({ preview: { block: result.block, collision: result.collision } });
      }
    } catch {
      // Best-effort preview — a failure here should not block typing.
    }
  }

  writeEntryAndProbe = async (): Promise<void> => {
    const { newEntry, preview } = this.state;
    if (preview?.collision.kind === 'exact') return;
    if (!newEntry.alias || !newEntry.hostname || !newEntry.user || !newEntry.port) return;
    this.setState({ writing: true, writeError: null });
    try {
      const result = await this.props.electron.ipcRenderer.invoke(IPC_CHANNELS.WRITE_SSH_HOST_ENTRY, {
        alias: newEntry.alias, hostname: newEntry.hostname, user: newEntry.user,
        port: newEntry.port, identityFile: newEntry.keySource === 'agent' ? '' : newEntry.identityFile,
      });
      if (!this.mounted) return;
      if (!result?.success) {
        this.setState({ writing: false, writeError: result?.error ?? 'Could not write SSH config entry.' });
        return;
      }
      this.setState({ writing: false });
      await this.probeAlias(newEntry.alias);
    } catch (e: any) {
      if (this.mounted) this.setState({ writing: false, writeError: e?.message ?? String(e) });
    }
  };

  // ── Step 2: probe ────────────────────────────────────────────────────────

  async probeAlias(alias: string): Promise<void> {
    const mySeq = ++this.probeSeq;
    this.setState({ alias, probing: true, probeError: null });
    try {
      const data = await rendererGql<{ nexusHostProbe: { success: boolean; error: string | null; multiIssue: NexusHostMultiIssueProbeLike | null } }>(`
        mutation($alias: String!) {
          nexusHostProbe(alias: $alias) {
            success error
            multiIssue {
              checks { connection { status detail } hostKey { status detail } wpCli { status detail } installs { status detail } }
              issues { kind title detail remedy fingerprint keyType previousFingerprint }
              wpCliVersion installs
            }
          }
        }
      `, { alias }, HOST_PROBE_CLIENT_TIMEOUT_MS);
      if (!this.mounted || mySeq !== this.probeSeq) return;
      const result = data.nexusHostProbe;
      if (!result.success || !result.multiIssue) {
        this.setState({ probing: false, probeError: result.error ?? 'Probe failed — no result returned.', step: 2 });
        return;
      }
      this.setState({ probing: false, multiIssue: result.multiIssue, step: 2 });
    } catch (e: any) {
      if (!this.mounted || mySeq !== this.probeSeq) return;
      this.setState({ probing: false, probeError: e?.message ?? String(e), step: 2 });
    }
  }

  reProbe = async (): Promise<void> => {
    if (!this.state.alias) return;
    await this.probeAlias(this.state.alias);
  };

  approveHostKey = async (issue: NexusHostIssueLike): Promise<void> => {
    if (!issue.fingerprint) return;
    this.setState({ approvingKind: issue.kind });
    try {
      const result = await this.props.electron.ipcRenderer.invoke(
        IPC_CHANNELS.TRUST_EXTERNAL_HOST_KEY, this.state.alias, issue.fingerprint,
      );
      if (!this.mounted) return;
      if (result?.success) {
        this.setState({ approvingKind: null });
        await this.probeAlias(this.state.alias);
      } else {
        this.setState({ approvingKind: null, probeError: result?.error ?? 'Could not approve host key.' });
      }
    } catch (e: any) {
      if (this.mounted) this.setState({ approvingKind: null, probeError: e?.message ?? String(e) });
    }
  };

  applyRootMode = async (allowRoot: boolean): Promise<void> => {
    this.setState({ applyingRootMode: true });
    try {
      const result = await this.props.electron.ipcRenderer.invoke(
        IPC_CHANNELS.SET_EXTERNAL_HOST_ROOT_MODE, this.state.alias, allowRoot,
      );
      if (!this.mounted) return;
      if (result?.success) {
        // Apply-and-continue: remove just the rootUser card locally, no re-probe.
        this.setState(prev => ({
          applyingRootMode: false,
          multiIssue: prev.multiIssue
            ? { ...prev.multiIssue, issues: prev.multiIssue.issues.filter(i => i.kind !== 'rootUser') }
            : prev.multiIssue,
        }));
      } else {
        this.setState({ applyingRootMode: false, probeError: result?.error ?? 'Could not set root mode.' });
      }
    } catch (e: any) {
      if (this.mounted) this.setState({ applyingRootMode: false, probeError: e?.message ?? String(e) });
    }
  };

  /** rootUser card's second option — routes back to the alias picker. Deliberately
   * does NOT call SET_EXTERNAL_HOST_ROOT_MODE at all. */
  useDifferentAlias = (): void => {
    this.setState({ step: 1, step1Mode: 'pick' });
  };

  // ── Render: Step 1 ───────────────────────────────────────────────────────

  renderPicker(): React.ReactNode {
    const { hosts, loadingHosts, loadHostsError } = this.state;
    return React.createElement('div', null,
      loadingHosts ? React.createElement('div', { style: { fontSize: 13, color: 'var(--ag-text-muted)' } }, 'Loading SSH config hosts…') : null,
      loadHostsError ? React.createElement('div', { style: { fontSize: 13, color: 'var(--ag-red)' } }, loadHostsError) : null,
      !loadingHosts && hosts.length === 0
        ? React.createElement('div', { style: { fontSize: 13, color: 'var(--ag-text-muted)' } }, 'No hosts found in your SSH config.')
        : null,
      ...hosts.map(h => {
        const disabled = h.alreadyRegistered;
        return React.createElement('div', {
          key: h.alias,
          onClick: disabled ? undefined : () => this.selectAlias(h.alias),
          style: {
            display: 'flex', alignItems: 'center', justifyContent: 'space-between',
            padding: '10px 12px', borderRadius: 8, border: '1px solid var(--ag-border-subtle)',
            marginBottom: 6, cursor: disabled ? 'not-allowed' : 'pointer',
            opacity: disabled ? 0.45 : 1, background: 'var(--ag-bg-elevated)',
          },
        },
          React.createElement('div', null,
            React.createElement('div', { style: { fontSize: 13.5, fontWeight: 600, color: 'var(--ag-text-primary)' } }, h.alias),
            React.createElement('div', { style: { fontSize: 11.5, color: 'var(--ag-text-muted)' } },
              `${h.user ? h.user + '@' : ''}${h.hostname}${h.port ? ':' + h.port : ''}`),
          ),
          disabled
            ? React.createElement('span', { style: { fontSize: 11, color: 'var(--ag-text-faint)' } }, 'Already registered')
            : null,
        );
      }),
      React.createElement('button', {
        onClick: this.switchToCreateNew,
        style: { ...secondaryButtonStyle, marginTop: 10, width: '100%' },
      }, 'Not listed — create a new SSH config entry'),
    );
  }

  renderCreateForm(): React.ReactNode {
    const { newEntry, preview, writing, writeError } = this.state;
    const field = (labelText: string, fieldName: keyof NewEntryForm, placeholder: string) =>
      React.createElement('div', null,
        React.createElement('div', { style: labelStyle }, labelText),
        React.createElement('input', {
          type: 'text',
          placeholder,
          name: fieldName,
          value: newEntry[fieldName],
          onChange: (e: any) => this.updateNewEntryField(fieldName, e.target.value),
          style: inputStyle,
        }),
      );

    // identityFile is genuinely optional (the backend omits its directive
    // line entirely when blank) -- alias/hostname/user/port are not, since a
    // bare directive with no value makes ssh terminate parsing entirely.
    const missingRequired = !newEntry.alias || !newEntry.hostname || !newEntry.user || !newEntry.port;
    const blocked = preview?.collision.kind === 'exact' || missingRequired;

    return React.createElement('div', null,
      React.createElement('button', {
        onClick: this.backToPicker,
        style: { ...secondaryButtonStyle, marginBottom: 12, fontSize: 12, padding: '5px 10px' },
      }, '← Back to picker'),
      field('Alias', 'alias', 'my-host'),
      field('Hostname', 'hostname', 'example.com'),
      field('User', 'user', 'ssh-user'),
      field('Port', 'port', '22'),
      React.createElement('div', { style: { marginTop: 12 } },
        React.createElement('div', { style: labelStyle }, 'Which key should Nexus use?'),
        React.createElement('div', { style: { fontSize: 12, color: 'var(--ag-text-muted)', marginTop: 6, marginBottom: 12 } },
          'Nexus connects on a schedule with nobody watching, so there is no one to answer a password prompt — it needs a key.'),
        React.createElement('div', { style: { display: 'flex', flexDirection: 'column', gap: 10 } },
          React.createElement('label', {
            style: { display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer' },
          },
            React.createElement('input', {
              type: 'radio',
              name: 'keySource',
              value: 'agent',
              checked: newEntry.keySource === 'agent',
              onChange: (e: any) => this.updateNewEntryField('keySource', e.target.value),
              style: { cursor: 'pointer' },
            }),
            React.createElement('span', { style: { fontSize: 13, color: 'var(--ag-text-primary)' } }, 'Use the SSH agent'),
          ),
          React.createElement('label', {
            style: { display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer' },
          },
            React.createElement('input', {
              type: 'radio',
              name: 'keySource',
              value: 'file',
              checked: newEntry.keySource === 'file',
              onChange: (e: any) => this.updateNewEntryField('keySource', e.target.value),
              style: { cursor: 'pointer' },
            }),
            React.createElement('span', { style: { fontSize: 13, color: 'var(--ag-text-primary)' } }, 'Use a specific key file'),
          ),
        ),
        newEntry.keySource === 'file'
          ? React.createElement('div', { style: { marginTop: 8 } },
              React.createElement('input', {
                type: 'text',
                placeholder: '~/.ssh/id_ed25519',
                name: 'identityFile',
                value: newEntry.identityFile,
                onChange: (e: any) => this.updateNewEntryField('identityFile', e.target.value),
                style: inputStyle,
              }),
            )
          : null,
        React.createElement('div', { style: { fontSize: 11.5, color: 'var(--ag-text-muted)', marginTop: 6, fontStyle: 'italic' } },
          'Nexus keeps no secrets of its own — it remembers which key to ask for, and the key stays where it already lives.'),
      ),
      preview?.collision.kind === 'exact'
        ? React.createElement('div', { style: { ...failCardStyle, marginTop: 12 } },
            `'${newEntry.alias}' already exists in ${preview.collision.file}:${preview.collision.line}.`)
        : null,
      preview?.collision.kind === 'pattern'
        ? React.createElement('div', { style: { ...warnCardStyle, marginTop: 12 } },
            `This alias matches an existing pattern '${preview.collision.pattern}' in ${preview.collision.file}. It may be shadowed.`)
        : null,
      preview?.block
        ? React.createElement('pre', {
            style: { fontSize: 11.5, background: 'var(--ag-bg-code)', borderRadius: 6, padding: '10px 12px', marginTop: 12, whiteSpace: 'pre-wrap', color: 'var(--ag-text-secondary)' },
          }, preview.block)
        : null,
      writeError ? React.createElement('div', { style: { ...failCardStyle, marginTop: 12 } }, writeError) : null,
      React.createElement('button', {
        onClick: this.writeEntryAndProbe,
        disabled: blocked || writing,
        style: { ...primaryButtonStyle, marginTop: 16, opacity: (blocked || writing) ? 0.5 : 1, cursor: (blocked || writing) ? 'not-allowed' : 'pointer' },
      }, writing ? 'Writing…' : 'Write entry & probe'),
    );
  }

  renderStep1(): React.ReactNode {
    return this.state.step1Mode === 'pick' ? this.renderPicker() : this.renderCreateForm();
  }

  // ── Render: Step 2 ───────────────────────────────────────────────────────

  renderCheckRow(label: string, check: NexusHostCheckStateLike): React.ReactNode {
    return React.createElement('div', { style: rowLine, key: label },
      React.createElement('div', { style: { display: 'flex', alignItems: 'center', gap: 8 } },
        statusDot(check.status),
        React.createElement('span', { style: { fontSize: 13, color: 'var(--ag-text-primary)' } }, label),
      ),
      React.createElement('span', { style: { fontSize: 12, color: 'var(--ag-text-muted)' } }, check.detail),
    );
  }

  renderRemedyCard(style: React.CSSProperties, title: string, remedy: string, extra?: React.ReactNode): React.ReactNode {
    return React.createElement('div', { style },
      React.createElement('div', { style: { fontSize: 13, fontWeight: 600, color: 'var(--ag-text-primary)', marginBottom: 6 } }, title),
      React.createElement('div', { style: { fontSize: 12.5, color: 'var(--ag-text-secondary)', whiteSpace: 'pre-wrap' } }, remedy),
      extra ?? null,
    );
  }

  renderUnknownHostKeyCard(issue: NexusHostIssueLike): React.ReactNode {
    const approving = this.state.approvingKind === issue.kind;
    return this.renderRemedyCard(failCardStyle, issue.title, issue.remedy,
      React.createElement('div', { style: { marginTop: 10, display: 'flex', gap: 8, alignItems: 'center' } },
        issue.fingerprint
          ? React.createElement('span', { style: { fontSize: 11.5, fontFamily: 'JetBrains Mono, monospace', color: 'var(--ag-text-muted)' } },
              `${issue.keyType ?? ''} ${issue.fingerprint}`)
          : null,
        React.createElement('button', {
          onClick: () => this.approveHostKey(issue),
          disabled: approving,
          style: { ...primaryButtonStyle, flex: 'none', padding: '6px 14px', fontSize: 12.5, opacity: approving ? 0.5 : 1 },
        }, approving ? 'Approving…' : 'Approve this host key'),
      ),
    );
  }

  renderChangedHostKeyCard(issue: NexusHostIssueLike): React.ReactNode {
    return this.renderRemedyCard(failCardStyle, issue.title, issue.remedy,
      React.createElement('div', { style: { marginTop: 10 } },
        React.createElement('button', {
          onClick: this.props.onClose,
          style: { ...secondaryButtonStyle, padding: '6px 14px', fontSize: 12.5 },
        }, 'Close'),
      ),
    );
  }

  renderConnectionIssueCard(issue: NexusHostIssueLike): React.ReactNode {
    return this.renderRemedyCard(failCardStyle, issue.title, issue.remedy);
  }

  renderRootUserCard(issue: NexusHostIssueLike): React.ReactNode {
    const applying = this.state.applyingRootMode;
    return this.renderRemedyCard(warnCardStyle, issue.title, issue.remedy,
      React.createElement('div', { style: { marginTop: 10, display: 'flex', flexDirection: 'column', gap: 8 } },
        React.createElement('button', {
          onClick: () => this.applyRootMode(true),
          disabled: applying,
          style: { ...primaryButtonStyle, flex: 'none', padding: '6px 14px', fontSize: 12.5, opacity: applying ? 0.5 : 1 },
        }, applying ? 'Applying…' : 'Pass --allow-root for this host'),
        React.createElement('button', {
          onClick: this.useDifferentAlias,
          style: { ...secondaryButtonStyle, padding: '6px 14px', fontSize: 12.5 },
        }, "Use an alias that connects as the site's own user"),
      ),
    );
  }

  renderWpCliMissingCard(issue: NexusHostIssueLike): React.ReactNode {
    return this.renderRemedyCard(warnCardStyle, issue.title, issue.remedy);
  }

  renderWpCliInteractivePathOnlyCard(issue: NexusHostIssueLike): React.ReactNode {
    return this.renderRemedyCard(warnCardStyle, issue.title, issue.remedy);
  }

  renderWordPressNotFoundCard(issue: NexusHostIssueLike): React.ReactNode {
    return this.renderRemedyCard(failCardStyle, issue.title, issue.remedy);
  }

  renderIssueCard(issue: NexusHostIssueLike): React.ReactNode {
    switch (issue.kind) {
      case 'unknownHostKey': return this.renderUnknownHostKeyCard(issue);
      case 'changedHostKey': return this.renderChangedHostKeyCard(issue);
      case 'rootUser': return this.renderRootUserCard(issue);
      case 'wpCliMissing': return this.renderWpCliMissingCard(issue);
      case 'wpCliInteractivePathOnly': return this.renderWpCliInteractivePathOnlyCard(issue);
      case 'wordPressNotFound': return this.renderWordPressNotFoundCard(issue);
      default:
        if (CONNECTION_ISSUE_KINDS.has(issue.kind)) return this.renderConnectionIssueCard(issue);
        return this.renderRemedyCard(failCardStyle, issue.title, issue.remedy);
    }
  }

  renderStep2(): React.ReactNode {
    const { multiIssue, probing, probeError, alias } = this.state;

    if (probing && !multiIssue) {
      return React.createElement('div', { style: { fontSize: 13, color: 'var(--ag-text-muted)' } }, `Probing ${alias}…`);
    }
    if (probeError && !multiIssue) {
      return React.createElement('div', { style: failCardStyle }, probeError);
    }
    if (!multiIssue) return null;

    const dedupedIssues = dedupeIssuesByKind(multiIssue.issues);
    const hasChangedHostKey = dedupedIssues.some(i => i.kind === 'changedHostKey');

    return React.createElement('div', null,
      React.createElement('div', { style: { marginBottom: 14 } },
        this.renderCheckRow('connection', multiIssue.checks.connection),
        this.renderCheckRow('host key', multiIssue.checks.hostKey),
        this.renderCheckRow('WP-CLI', multiIssue.checks.wpCli),
        this.renderCheckRow('installs', multiIssue.checks.installs),
      ),
      probeError ? React.createElement('div', { style: { ...failCardStyle, marginBottom: 10 } }, probeError) : null,
      ...dedupedIssues.map(issue => React.createElement('div', { key: issue.kind }, this.renderIssueCard(issue))),
      !hasChangedHostKey
        ? React.createElement('button', {
            onClick: this.reProbe,
            disabled: probing,
            style: { ...secondaryButtonStyle, marginTop: 8, width: '100%', opacity: probing ? 0.5 : 1 },
          }, probing ? 'Re-probing…' : 'Re-probe everything')
        : null,
      dedupedIssues.length === 0
        ? React.createElement('button', {
            onClick: () => this.advanceToStep3(alias),
            style: { ...primaryButtonStyle, marginTop: 14, width: '100%' },
          }, 'Continue')
        : null,
    );
  }

  // ── Step 3: site picker ──────────────────────────────────────────────────

  /**
   * Advances from Step 2's zero-issue state into Step 3, seeding one
   * SiteSelection per discovered install (default-checked, default
   * 'production' per nexusHostAdd's own default). When the probe found no
   * installs, Step 3 starts empty and relies on the manual "add a path
   * discovery missed" input -- there is nothing else to seed it with.
   * Still notifies the onProbeClean prop, unchanged from Task 4's contract.
   */
  advanceToStep3 = (alias: string): void => {
    const installs = this.state.multiIssue?.installs ?? [];
    const uniqueNames = deriveUniqueSiteNames(installs);
    const siteSelections: SiteSelection[] = installs.map((path, i) => ({
      path,
      site: uniqueNames[i],
      include: true,
      environment: 'production',
    }));
    this.setState({ step: 3, siteSelections, manualPath: '', registerError: null });
    this.props.onProbeClean(alias);
  };

  toggleSiteInclude = (index: number): void => {
    this.setState(prev => ({
      siteSelections: prev.siteSelections.map((s, i) => (i === index ? { ...s, include: !s.include } : s)),
    }));
  };

  updateSiteField = (index: number, field: 'site' | 'environment', value: string): void => {
    this.setState(prev => ({
      siteSelections: prev.siteSelections.map((s, i) => (i === index ? { ...s, [field]: value } : s)),
    }));
  };

  addManualSite = (): void => {
    const path = this.state.manualPath.trim();
    if (!path) return;
    this.setState(prev => {
      let site = deriveSiteNameFromPath(path);
      const existingNames = new Set(prev.siteSelections.map(s => s.site));
      if (existingNames.has(site)) {
        let n = 2;
        while (existingNames.has(`${site}-${n}`)) n++;
        site = `${site}-${n}`;
      }
      return {
        siteSelections: [...prev.siteSelections, { path, site, include: true, environment: 'production' }],
        manualPath: '',
      };
    });
  };

  submitStep3 = async (): Promise<void> => {
    const included = this.state.siteSelections.filter(s => s.include);
    if (included.length === 0) return;
    this.setState({ registering: true, registerError: null });
    try {
      const data = await rendererGql<{ nexusHostAddSites: {
        success: boolean; error: string | null; siteVerification: SiteVerificationResult[];
      } }>(`
        mutation($alias: String!, $sites: [NexusHostSiteEnvironmentInput!]!) {
          nexusHostAddSites(alias: $alias, sites: $sites) {
            success error
            siteVerification { site verified error }
          }
        }
      `, {
        alias: this.state.alias,
        sites: included.map(s => ({ site: s.site, environment: s.environment, path: s.path })),
      }, HOST_PROBE_CLIENT_TIMEOUT_MS);
      if (!this.mounted) return;
      const result = data.nexusHostAddSites;
      if (!result.success) {
        this.setState({ registering: false, registerError: result.error ?? 'Could not register sites.' });
        return;
      }
      this.setState({
        registering: false,
        step: 4,
        includedSelections: included,
        siteVerification: result.siteVerification,
      });
    } catch (e: any) {
      if (this.mounted) this.setState({ registering: false, registerError: e?.message ?? String(e) });
    }
  };

  renderSiteRow(s: SiteSelection, index: number): React.ReactNode {
    return React.createElement('div', {
      key: `${s.path}-${index}`,
      style: { ...rowLine, flexDirection: 'column', alignItems: 'stretch' },
    },
      React.createElement('div', { style: { display: 'flex', alignItems: 'center', gap: 8 } },
        React.createElement('input', {
          type: 'checkbox', checked: s.include, onChange: () => this.toggleSiteInclude(index),
        }),
        React.createElement('input', {
          type: 'text', value: s.site,
          onChange: (e: any) => this.updateSiteField(index, 'site', e.target.value),
          style: { ...inputStyle, flex: 1 },
        }),
        s.multisite
          ? React.createElement('span', {
              style: { fontSize: 10, fontWeight: 600, color: 'var(--ag-text-muted)', border: '1px solid var(--ag-border-control)', borderRadius: 4, padding: '2px 6px' },
            }, 'Multisite')
          : null,
      ),
      React.createElement('div', { style: { fontSize: 11, color: 'var(--ag-text-muted)', marginTop: 4 } }, s.path || '(manually added)'),
      React.createElement('select', {
        value: s.environment,
        disabled: !s.include,
        onChange: (e: any) => this.updateSiteField(index, 'environment', e.target.value),
        style: { ...inputStyle, marginTop: 6, width: 180, opacity: s.include ? 1 : 0.5 },
      },
        React.createElement('option', { value: 'production' }, 'Production'),
        React.createElement('option', { value: 'staging' }, 'Staging'),
        React.createElement('option', { value: 'development' }, 'Development'),
      ),
    );
  }

  renderStep3(): React.ReactNode {
    const { siteSelections, manualPath, registering, registerError } = this.state;
    const includedCount = siteSelections.filter(s => s.include).length;
    return React.createElement('div', null,
      React.createElement('div', { style: { fontSize: 12.5, color: 'var(--ag-text-muted)', marginBottom: 14 } },
        'Writes are refused on a site whose environment is Production unless you grant WP-CLI write access in Settings → WP Engine Access.'),
      siteSelections.length === 0
        ? React.createElement('div', { style: { fontSize: 13, color: 'var(--ag-text-muted)', marginBottom: 10 } }, 'No installs were discovered automatically — add a path below.')
        : null,
      ...siteSelections.map((s, i) => this.renderSiteRow(s, i)),
      React.createElement('div', { style: { fontSize: 12, color: 'var(--ag-text-muted)', marginTop: 14, marginBottom: 6 } },
        'Don’t see a site that should be here? Enter the full path to its wp-config.php directory on the server, then click Add.'),
      React.createElement('div', { style: { display: 'flex', gap: 8 } },
        React.createElement('input', {
          type: 'text', placeholder: '/home/user/public_html',
          value: manualPath,
          onChange: (e: any) => this.setState({ manualPath: e.target.value }),
          style: { ...inputStyle, flex: 1 },
        }),
        React.createElement('button', {
          onClick: this.addManualSite,
          style: { ...secondaryButtonStyle, flex: 'none' },
        }, 'Add'),
      ),
      registerError ? React.createElement('div', { style: { ...failCardStyle, marginTop: 12 } }, registerError) : null,
      React.createElement('button', {
        onClick: this.submitStep3,
        disabled: registering || includedCount === 0,
        style: { ...primaryButtonStyle, marginTop: 16, opacity: (registering || includedCount === 0) ? 0.5 : 1, cursor: (registering || includedCount === 0) ? 'not-allowed' : 'pointer' },
      }, registering ? 'Connecting…' : `Connect ${includedCount} site${includedCount === 1 ? '' : 's'}`),
    );
  }

  // ── Step 4: registration result ─────────────────────────────────────────

  retryVerification = async (index: number): Promise<void> => {
    const sel = this.state.includedSelections[index];
    if (!sel) return;
    this.setState({ retryingIndex: index });
    try {
      const data = await rendererGql<{ nexusHostAddSites: {
        success: boolean; error: string | null; siteVerification: SiteVerificationResult[];
      } }>(`
        mutation($alias: String!, $sites: [NexusHostSiteEnvironmentInput!]!) {
          nexusHostAddSites(alias: $alias, sites: $sites) {
            success error
            siteVerification { site verified error }
          }
        }
      `, {
        alias: this.state.alias,
        sites: [{ site: sel.site, environment: sel.environment, path: sel.path }],
      }, HOST_PROBE_CLIENT_TIMEOUT_MS);
      if (!this.mounted) return;
      const result = data.nexusHostAddSites;
      const updated: SiteVerificationResult = result.siteVerification[0]
        ?? { site: sel.site, verified: false, error: result.error ?? 'Retry failed.' };
      this.setState(prev => ({
        retryingIndex: null,
        siteVerification: (prev.siteVerification ?? []).map((r, i) => (i === index ? updated : r)),
      }));
    } catch (e: any) {
      if (!this.mounted) return;
      this.setState(prev => ({
        retryingIndex: null,
        siteVerification: (prev.siteVerification ?? []).map((r, i) =>
          i === index ? { site: sel.site, verified: false, error: e?.message ?? String(e) } : r),
      }));
    }
  };

  renderVerificationRow(r: SiteVerificationResult, index: number): React.ReactNode {
    const retrying = this.state.retryingIndex === index;
    return React.createElement('div', {
      key: `${r.site}-${index}`,
      style: { ...rowLine, flexDirection: 'column', alignItems: 'stretch' },
    },
      React.createElement('div', { style: { display: 'flex', alignItems: 'center', gap: 8 } },
        statusDot(r.verified ? 'ok' : 'fail'),
        React.createElement('span', { style: { fontSize: 13, fontWeight: 600, color: 'var(--ag-text-primary)' } }, r.site),
      ),
      !r.verified
        ? React.createElement('div', { style: { fontSize: 12, color: 'var(--ag-text-secondary)', marginTop: 4 } }, r.error || 'Verification failed.')
        : null,
      !r.verified
        ? React.createElement('button', {
            onClick: () => this.retryVerification(index),
            disabled: retrying,
            style: { ...secondaryButtonStyle, marginTop: 6, fontSize: 12, padding: '5px 10px', alignSelf: 'flex-start', opacity: retrying ? 0.5 : 1 },
          }, retrying ? 'Retrying…' : 'Retry verification')
        : null,
    );
  }

  renderStep4(): React.ReactNode {
    const { siteVerification, alias } = this.state;
    const results = siteVerification ?? [];
    const verifiedCount = results.filter(r => r.verified).length;
    const total = results.length;
    const allVerified = total > 0 && verifiedCount === total;
    return React.createElement('div', null,
      React.createElement('div', {
        style: { fontSize: 14, fontWeight: 600, marginBottom: 14, color: allVerified ? 'var(--ag-green)' : 'var(--ag-amber)' },
      }, `${verifiedCount} of ${total} verified`),
      ...results.map((r, i) => this.renderVerificationRow(r, i)),
      React.createElement('button', {
        onClick: () => this.props.onCompleted(alias),
        style: { ...primaryButtonStyle, marginTop: 16, width: '100%' },
      }, 'Close'),
    );
  }

  // ── Main render ───────────────────────────────────────────────────────────

  render(): React.ReactNode {
    const { step } = this.state;
    const stepLabel =
      step === 1 ? 'Step 1 of 4 — Choose or create a host' :
      step === 2 ? 'Step 2 of 4 — Resolve any issues' :
      step === 3 ? 'Step 3 of 4 — Choose sites to register' :
      'Step 4 of 4 — Registration complete';
    return React.createElement('div', null,
      // No scrim-click-to-dismiss on Step 4 -- the host is already saved and
      // there is nothing left to cancel out of.
      React.createElement('div', { onClick: step === 4 ? undefined : this.props.onClose, style: scrimStyle }),
      React.createElement('div', { style: panelStyle },
        React.createElement('div', { style: headerStyle },
          // Step 4 has no Cancel: the host row and its sites are already
          // persisted by submitStep3, and there is no rollback. Only the
          // footer's Close button (which calls onCompleted) is offered.
          step === 4
            ? null
            : React.createElement('button', {
                onClick: this.props.onClose,
                style: { background: 'none', border: 'none', color: 'var(--ag-text-secondary)', cursor: 'pointer', fontSize: 18, padding: 0, flexShrink: 0 },
              }, '✕'),
          React.createElement('div', null,
            React.createElement('div', { style: { fontSize: 17, fontWeight: 600, color: 'var(--ag-text-primary)', marginBottom: 4 } }, 'Add an external SSH host'),
            React.createElement('div', { style: { fontSize: 12.5, color: 'var(--ag-text-muted)' } }, stepLabel),
          ),
        ),
        React.createElement('div', { style: bodyStyle },
          step === 1 ? this.renderStep1() :
          step === 2 ? this.renderStep2() :
          step === 3 ? this.renderStep3() :
          this.renderStep4(),
        ),
      ),
    );
  }
}
