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

export interface ExternalHostAddWizardProps {
  electron: any;
  onClose: () => void;
  onCompleted: (alias: string) => void;
  /**
   * Fired once the zero-issue state is reached in Step 2. This task only
   * renders a placeholder "Continue" button that calls this — Task 5 wires
   * it to advance into its own Step 3.
   */
  onProbeClean: (alias: string) => void;
}

interface ExternalHostAddWizardState {
  step: 1 | 2;
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
}

const emptyNewEntry: NewEntryForm = { alias: '', hostname: '', user: '', port: '22', identityFile: '' };

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
  };

  async componentDidMount(): Promise<void> {
    this.mounted = true;
    await this.loadHosts();
  }

  componentWillUnmount(): void {
    this.mounted = false;
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
    this.setState(prev => ({ newEntry: { ...prev.newEntry, [field]: value } }));
    // Fire-and-forget: preview updates live as the user types.
    void this.previewEntry();
  };

  async previewEntry(): Promise<void> {
    const mySeq = ++this.previewSeq;
    const { alias, hostname, user, port, identityFile } = this.state.newEntry;
    if (!alias || !hostname) return;
    try {
      const result = await this.props.electron.ipcRenderer.invoke(IPC_CHANNELS.PREVIEW_SSH_HOST_ENTRY, {
        alias, hostname, user, port, identityFile,
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
    if (!newEntry.alias || !newEntry.hostname) return;
    this.setState({ writing: true, writeError: null });
    try {
      const result = await this.props.electron.ipcRenderer.invoke(IPC_CHANNELS.WRITE_SSH_HOST_ENTRY, {
        alias: newEntry.alias, hostname: newEntry.hostname, user: newEntry.user,
        port: newEntry.port, identityFile: newEntry.identityFile,
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

    const blocked = preview?.collision.kind === 'exact';

    return React.createElement('div', null,
      React.createElement('button', {
        onClick: this.backToPicker,
        style: { ...secondaryButtonStyle, marginBottom: 12, fontSize: 12, padding: '5px 10px' },
      }, '← Back to picker'),
      field('Alias', 'alias', 'my-host'),
      field('Hostname', 'hostname', 'example.com'),
      field('User', 'user', 'ssh-user'),
      field('Port', 'port', '22'),
      field('Identity file (optional)', 'identityFile', '~/.ssh/id_ed25519'),
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
            onClick: () => this.props.onProbeClean(alias),
            style: { ...primaryButtonStyle, marginTop: 14, width: '100%' },
          }, 'Continue')
        : null,
    );
  }

  // ── Main render ───────────────────────────────────────────────────────────

  render(): React.ReactNode {
    const { step } = this.state;
    return React.createElement('div', null,
      React.createElement('div', { onClick: this.props.onClose, style: scrimStyle }),
      React.createElement('div', { style: panelStyle },
        React.createElement('div', { style: headerStyle },
          React.createElement('button', {
            onClick: this.props.onClose,
            style: { background: 'none', border: 'none', color: 'var(--ag-text-secondary)', cursor: 'pointer', fontSize: 18, padding: 0, flexShrink: 0 },
          }, '✕'),
          React.createElement('div', null,
            React.createElement('div', { style: { fontSize: 17, fontWeight: 600, color: 'var(--ag-text-primary)', marginBottom: 4 } }, 'Add an external SSH host'),
            React.createElement('div', { style: { fontSize: 12.5, color: 'var(--ag-text-muted)' } },
              step === 1 ? 'Step 1 of 4 — Choose or create a host' : 'Step 2 of 4 — Resolve any issues'),
          ),
        ),
        React.createElement('div', { style: bodyStyle },
          step === 1 ? this.renderStep1() : this.renderStep2(),
        ),
      ),
    );
  }
}
