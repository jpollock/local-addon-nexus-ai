import * as React from 'react';
import { IPC_CHANNELS } from '../../../common/constants';
import { AwsCredential, normalizeLogPrefix } from './logSourcesModel';
import { ScopeSite } from './fetchScopeSites';
import { openNexusPreferences, AWS_CREDENTIAL_LOCATION } from './openNexusPreferences';

/**
 * Connect (or re-point) log-processor's one account-level S3 log bucket.
 *
 * Four bodies, per handoff_log_sources_v3/README.md §6: bucket form, scanning, scan result, and
 * the failure variant of the form. No action lives only inside the scrolling body — every fix is
 * the footer's primary button, because at short window heights the body scrolls and a fix the
 * user cannot see is a dead end (BEHAVIOR.md §2).
 */

export const AWS_REGIONS = [
  'us-east-1', 'us-east-2', 'us-west-1', 'us-west-2',
  'ca-central-1', 'eu-west-1', 'eu-west-2', 'eu-central-1',
  'ap-south-1', 'ap-southeast-1', 'ap-southeast-2', 'ap-northeast-1', 'sa-east-1',
];

export interface ScanInstall {
  installId: string;
  objectCount: number;
  bytes: number;
  oldest: string;
  newest: string;
  sampleKey: string;
}

export interface ScanPayload {
  totalObjects: number;
  apacheStyleObjects: number;
  unparsedObjects: number;
  installs: ScanInstall[];
  truncated: boolean;
}

export interface ScanFailure {
  errorCode: string;
  message: string;
  suggestedRegion?: string;
  suggestedPrefix?: string;
}

interface Props {
  electron?: any;
  aws: AwsCredential;
  fleet: ScopeSite[];
  /** Pre-filled when re-pointing an already-connected bucket. */
  initial?: { bucket: string; region: string; prefix: string };
  onClose: () => void;
  /** Fired after a successful commit, so the caller reloads its derived set. */
  onConnected: () => void;
}

interface State {
  phase: 'form' | 'scanning' | 'result';
  bucket: string;
  region: string;
  prefix: string;
  failure: ScanFailure | null;
  scan: ScanPayload | null;
  /** True once the scan has committed — drives which install rows are shown as saved. */
  cleared: { aggregates: number; ledger: number } | null;
}

/**
 * Agent tools answer as `AgentToolResult`, so the JSON payload is one level down in
 * `content[0].text`. Structured errors are the whole point (DATA-MODEL.md §4) — a failure that
 * arrives as unparseable text is reported as such rather than guessed at.
 */
export function parseToolJson(result: any): { ok: true; data: any } | { ok: false; message: string } {
  const text = result?.content?.[0]?.text;
  if (typeof text !== 'string') return { ok: false, message: 'The agent returned no response.' };
  try {
    return { ok: true, data: JSON.parse(text) };
  } catch {
    return { ok: false, message: text };
  }
}

const ENV_CHIP: Record<string, { color: string; bg: string }> = {
  production:  { color: 'var(--ag-picker-danger)',  bg: 'rgba(244,104,95,0.12)' },
  staging:     { color: 'var(--ag-picker-warning)', bg: 'rgba(242,181,68,0.12)' },
  development: { color: 'var(--ag-picker-violet)',  bg: 'rgba(123,140,255,0.13)' },
  local:       { color: 'var(--ag-picker-text-dim)', bg: 'rgba(139,146,156,0.12)' },
};

const MONO = "'JetBrains Mono', ui-monospace, SFMono-Regular, Menlo, monospace";

export class LogBucketModal extends React.Component<Props, State> {
  constructor(props: Props) {
    super(props);
    this.state = {
      phase: 'form',
      bucket: props.initial?.bucket ?? '',
      region: props.initial?.region ?? 'us-east-1',
      prefix: props.initial?.prefix ?? '',
      failure: null,
      scan: null,
      cleared: null,
    };
  }

  /**
   * One submit runs the scan AND commits it — the agent writes nothing unless the scan finds
   * apache-style objects, so "validate before write" is satisfied without a second round trip
   * (DATA-MODEL.md §3). A failure therefore leaves the form exactly as the user typed it.
   */
  private submit = async (): Promise<void> => {
    const ipc = this.props.electron?.ipcRenderer;
    if (!ipc) return;
    this.setState({ phase: 'scanning', failure: null });

    const result = await ipc.invoke(IPC_CHANNELS.AGENT_TOOL_INVOKE, {
      agentId: 'log-processor',
      toolName: 'set_log_bucket',
      args: {
        bucket: this.state.bucket.trim(),
        region: this.state.region,
        prefix: this.state.prefix.trim(),
        format: 'json',
      },
    }).catch((e: Error) => ({ content: [{ type: 'text', text: e.message }], isError: true }));

    const parsed = parseToolJson(result);
    if (!parsed.ok) {
      this.setState({ phase: 'form', failure: { errorCode: 'Unknown', message: parsed.message } });
      return;
    }
    if (!parsed.data?.ok) {
      this.setState({
        phase: 'form',
        failure: {
          errorCode: parsed.data?.errorCode ?? 'Unknown',
          message: parsed.data?.message ?? 'The scan failed.',
          suggestedRegion: parsed.data?.suggestedRegion,
          suggestedPrefix: parsed.data?.suggestedPrefix,
        },
      });
      return;
    }

    this.setState({ phase: 'result', scan: parsed.data.scan, cleared: parsed.data.cleared ?? null });
    this.props.onConnected();
  };

  private applySuggestionAndRetry = (patch: { region?: string; prefix?: string }): void => {
    this.setState(
      prev => ({ ...prev, region: patch.region ?? prev.region, prefix: patch.prefix ?? prev.prefix }),
      () => { void this.submit(); },
    );
  };

  // ── credential strip ───────────────────────────────────────────────────────
  // Leads the form, so its state is visible at the moment the user is asked to submit.

  private renderCredStrip(marginBottom: number) {
    const { aws } = this.props;
    const connected = aws.connected;
    return React.createElement('div', {
      style: {
        display: 'flex', gap: 11, alignItems: 'flex-start', marginBottom,
        padding: '12px 15px', borderRadius: 9,
        background: connected ? 'var(--ag-picker-bg-sunken)' : 'rgba(242,181,68,0.06)',
        border: `1px solid ${connected ? 'var(--ag-picker-border-faint)' : 'rgba(242,181,68,0.3)'}`,
      },
    },
      React.createElement('span', {
        style: {
          flex: 'none', width: 8, height: 8, borderRadius: '50%', marginTop: 5,
          background: connected ? 'var(--ag-picker-success)' : 'var(--ag-picker-warning)',
        },
      }),
      React.createElement('div', { style: { flex: 1, minWidth: 0 } },
        React.createElement('div', { style: { fontSize: 12.5, fontWeight: 500, color: 'var(--ag-picker-text-primary)' } },
          connected ? 'AWS · connected' : 'AWS account not connected'),
        React.createElement('div', {
          style: { fontSize: 11.5, color: 'var(--ag-picker-text-dim)', marginTop: 2, fontFamily: MONO, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' as const },
        }, connected
          ? (aws.label ?? 'access key stored') + (aws.createdAt ? ` · added ${new Date(aws.createdAt).toLocaleDateString()}` : '')
          : 'Needed to read access logs from S3'),
      ),
      React.createElement('button', {
        onClick: () => openNexusPreferences(),
        style: {
          flex: 'none', background: 'none', border: 'none', padding: 0, cursor: 'pointer',
          fontSize: 12, fontWeight: 500, color: 'var(--ag-picker-teal)',
        },
      }, connected ? 'Manage' : 'Connect in Settings →'),
    );
  }

  // ── bodies ─────────────────────────────────────────────────────────────────

  private renderFailure() {
    const f = this.state.failure;
    if (!f) return null;
    const headline: Record<string, string> = {
      InvalidAccessKeyId: 'AWS rejected the access key',
      SignatureDoesNotMatch: 'AWS rejected the secret access key',
      NoSuchBucket: `No bucket named ${this.state.bucket} in ${this.state.region}`,
      AccessDenied: 'The key cannot list this bucket',
      EmptyPrefix: 'No apache-style logs at that prefix',
      NotConnected: 'AWS is not connected',
    };
    const body: Record<string, string> = {
      InvalidAccessKeyId: `Re-enter the key in ${AWS_CREDENTIAL_LOCATION}. Nothing has been saved.`,
      SignatureDoesNotMatch: `Re-copy the secret from AWS and re-enter it in ${AWS_CREDENTIAL_LOCATION}.`,
      NoSuchBucket: f.suggestedRegion
        ? `The bucket exists, but in ${f.suggestedRegion}. S3 buckets are region-scoped and a name only resolves in its own region.`
        : 'Check the name for a typo, or pick the region the bucket was created in.',
      AccessDenied: 'The credential is valid but its IAM policy does not allow s3:ListBucket here. It needs list and read on this bucket.',
      EmptyPrefix: f.suggestedPrefix
        ? `Nothing ingestible is under this prefix, but ${f.suggestedPrefix} does hold apache-style logs.`
        : 'The bucket is reachable, but nothing under this prefix is an apache-style log. Only *.apachestyle.log.gz objects are read.',
      NotConnected: `Add the AWS access key in ${AWS_CREDENTIAL_LOCATION}, then come back.`,
    };
    return React.createElement('div', {
      style: {
        marginBottom: 18, padding: '13px 15px', borderRadius: 10,
        background: 'rgba(244,104,95,0.07)', border: '1px solid rgba(244,104,95,0.32)',
      },
    },
      React.createElement('div', { style: { fontSize: 13.5, fontWeight: 600, color: 'var(--ag-picker-danger)' } },
        headline[f.errorCode] ?? 'The scan failed'),
      React.createElement('div', { style: { fontSize: 12.5, color: 'var(--ag-picker-text-secondary)', marginTop: 5, lineHeight: 1.5 } },
        body[f.errorCode] ?? 'Nothing has been saved — correct a field and try again.'),
      // Raw AWS text is always secondary to the plain-language sentence, never the only message.
      f.message && React.createElement('div', {
        style: {
          marginTop: 10, padding: '8px 11px', borderRadius: 7, fontFamily: MONO, fontSize: 11.5,
          color: 'var(--ag-picker-text-dim)', background: 'var(--ag-picker-bg-sunken)',
          border: '1px solid var(--ag-picker-border-faint)', wordBreak: 'break-word' as const,
        },
      }, f.message),
    );
  }

  private renderForm() {
    const labelStyle = { fontSize: 12, fontWeight: 500, color: 'var(--ag-picker-text-secondary)', marginBottom: 7 };
    const inputStyle = {
      width: '100%', boxSizing: 'border-box' as const,
      background: 'var(--ag-picker-bg-sunken)', border: '1px solid var(--ag-picker-control-border)',
      borderRadius: 9, padding: '11px 14px', fontSize: 13, fontFamily: MONO,
      color: 'var(--ag-picker-text-primary)', outline: 'none',
    };
    return React.createElement('div', null,
      this.renderCredStrip(18),
      this.renderFailure(),
      React.createElement('div', { style: { display: 'flex', gap: 12 } },
        React.createElement('div', { style: { flex: 1, minWidth: 0 } },
          React.createElement('div', { style: labelStyle }, 'S3 bucket'),
          React.createElement('input', {
            value: this.state.bucket,
            placeholder: 'wpejpp',
            onChange: (e: any) => this.setState({ bucket: e.target.value }),
            style: inputStyle,
          }),
        ),
        React.createElement('div', { style: { width: 190, flex: 'none' } },
          React.createElement('div', { style: labelStyle }, 'Region'),
          React.createElement('select', {
            value: this.state.region,
            onChange: (e: any) => this.setState({ region: e.target.value }),
            style: { ...inputStyle, padding: '11px 12px' },
          }, ...AWS_REGIONS.map(r => React.createElement('option', { key: r, value: r }, r))),
        ),
      ),
      React.createElement('div', { style: { marginTop: 16 } },
        React.createElement('div', { style: { display: 'flex', alignItems: 'baseline', gap: 8, marginBottom: 7 } },
          React.createElement('div', { style: { ...labelStyle, marginBottom: 0 } }, 'Prefix'),
          React.createElement('div', { style: { fontSize: 11.5, color: 'var(--ag-picker-text-muted)' } }, 'optional'),
        ),
        React.createElement('input', {
          value: this.state.prefix,
          placeholder: 'wpe_logs/nginx/',
          onChange: (e: any) => this.setState({ prefix: e.target.value }),
          style: inputStyle,
        }),
        // A prefix names a folder, and the agent concatenates a date onto it when it lists a
        // day's objects — so `wpe_logs/nginx` scans perfectly and then asks S3 for
        // `wpe_logs/nginx20260808`, which matches nothing. A leading slash is wrong at both ends.
        // The agent normalizes both, and this says so BEFORE submit rather than quietly changing
        // the field under the cursor: the saved value is shown, the typed value is left alone.
        normalizeLogPrefix(this.state.prefix) !== this.state.prefix && React.createElement('div', {
          style: { fontSize: 11.5, color: 'var(--ag-picker-text-dim)', marginTop: 7, lineHeight: 1.55 },
        },
          'Will be saved as ',
          React.createElement('span', { style: { fontFamily: MONO, color: 'var(--ag-picker-text-secondary)' } },
            normalizeLogPrefix(this.state.prefix) || '(bucket root)'),
          ' — a prefix names a folder, and a date is appended to it when each day is listed.',
        ),
        React.createElement('div', { style: { fontSize: 11.5, color: 'var(--ag-picker-text-muted)', marginTop: 7, lineHeight: 1.55 } },
          'One prefix for the whole account. WP Engine writes every install into the same folder and separates them by filename, so there is nothing to set per site.',
        ),
      ),
    );
  }

  private renderScanning() {
    // Three checks, in order. The third names the apache-style filter explicitly — that is what
    // stops the halved object count in the result from reading as data loss (BEHAVIOR.md §2).
    const checks: Array<{ label: string; state: 'done' | 'run' | 'wait'; detail?: string }> = [
      { label: 'Credential accepted', state: 'done', detail: this.props.aws.label },
      { label: `Listing ${this.state.prefix || '(root)'}`, state: 'run' },
      { label: 'Keeping apache-style objects', state: 'wait' },
    ];
    return React.createElement('div', null,
      React.createElement('div', {
        style: {
          fontFamily: MONO, fontSize: 12, color: 'var(--ag-picker-text-dim)', padding: '12px 14px',
          background: 'var(--ag-picker-bg-sunken)', border: '1px solid var(--ag-picker-border-faint)',
          borderRadius: 9, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' as const,
        },
      }, `s3://${this.state.bucket}/${this.state.prefix}`),
      React.createElement('div', { style: { marginTop: 16, display: 'flex', flexDirection: 'column' as const, gap: 12 } },
        ...checks.map(c => React.createElement('div', {
          key: c.label,
          style: { display: 'flex', alignItems: 'center', gap: 11 },
        },
          React.createElement('span', {
            style: {
              flex: 'none', width: 18, height: 18, borderRadius: '50%', display: 'flex',
              alignItems: 'center', justifyContent: 'center', fontSize: 11, fontWeight: 700,
              color: c.state === 'done' ? 'var(--ag-picker-on-teal)' : 'transparent',
              background: c.state === 'done' ? 'var(--ag-picker-success)' : 'transparent',
              border: c.state === 'run'
                ? '2px solid var(--ag-picker-teal)'
                : c.state === 'wait' ? '2px solid var(--ag-picker-border)' : 'none',
            },
          }, c.state === 'done' ? '✓' : ''),
          React.createElement('span', {
            style: { fontSize: 13, color: c.state === 'wait' ? 'var(--ag-picker-text-muted)' : 'var(--ag-picker-text-primary)' },
          }, c.label),
          React.createElement('div', { style: { flex: 1 } }),
          c.detail && React.createElement('span', {
            style: { fontSize: 11.5, color: 'var(--ag-picker-text-muted)', fontFamily: MONO, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' as const, maxWidth: 220 },
          }, c.detail),
        )),
      ),
    );
  }

  private renderResult() {
    const scan = this.state.scan;
    if (!scan) return null;
    const fleetNames = new Set(this.props.fleet.map(f => f.name));
    const byName = new Map(this.props.fleet.map(f => [f.name, f]));
    const recognised = scan.installs.filter(i => fleetNames.has(i.installId));
    const orphans = scan.installs.filter(i => !fleetNames.has(i.installId));
    const noLogs = this.props.fleet.filter(f => !scan.installs.some(i => i.installId === f.name));
    const oldest = scan.installs.reduce<string | null>((m, i) => (!m || i.oldest < m ? i.oldest : m), null);
    const newest = scan.installs.reduce<string | null>((m, i) => (!m || i.newest > m ? i.newest : m), null);

    const noteParts: string[] = [];
    if (noLogs.length > 0) {
      noteParts.push(
        noLogs.length === 1
          ? `${noLogs[0].name} has no logs here.`
          : `${noLogs.length} of your installs have no logs here.`,
      );
    }
    if (orphans.length > 0) {
      noteParts.push(
        orphans.length === 1
          ? `${orphans[0].installId} in the bucket is not on this account, so its logs are ignored.`
          : `${orphans.length} installs in the bucket are not on this account, so their logs are ignored.`,
      );
    }
    noteParts.push('Switch the installs you want on from the Sites tab.');

    return React.createElement('div', null,
      React.createElement('div', {
        style: {
          display: 'flex', alignItems: 'center', gap: 11, padding: '14px 16px', borderRadius: 11,
          background: 'rgba(62,207,142,0.07)', border: '1px solid rgba(62,207,142,0.32)',
        },
      },
        React.createElement('span', {
          style: {
            flex: 'none', width: 22, height: 22, borderRadius: '50%', display: 'flex',
            alignItems: 'center', justifyContent: 'center', fontSize: 12, fontWeight: 800,
            color: 'var(--ag-picker-on-teal)', background: 'var(--ag-picker-success)',
          },
        }, '✓'),
        React.createElement('div', { style: { flex: 1 } },
          React.createElement('div', { style: { fontSize: 13.5, fontWeight: 600, color: 'var(--ag-picker-success)' } },
            // "1 of your installs" — the noun stays plural whatever the count, matching the
            // bucket card's own line so the two never read as different facts.
            `${scan.apacheStyleObjects.toLocaleString()} apache-style object${scan.apacheStyleObjects === 1 ? '' : 's'} · ` +
            `${recognised.length} of your installs`),
          React.createElement('div', { style: { fontSize: 12, color: 'var(--ag-picker-text-secondary)', marginTop: 4 } },
            (oldest && newest ? `Logs from ${oldest} to ${newest} · ` : '') +
            'access logs in the same folder are ignored'),
        ),
      ),
      scan.truncated && React.createElement('div', {
        style: { fontSize: 11.5, color: 'var(--ag-picker-warning)', marginTop: 10, lineHeight: 1.5 },
      }, 'The listing hit its object cap, so these counts are a floor rather than a total. Ingestion is unaffected — it lists per day.'),
      this.state.cleared && (this.state.cleared.aggregates > 0 || this.state.cleared.ledger > 0) && React.createElement('div', {
        style: { fontSize: 11.5, color: 'var(--ag-picker-text-dim)', marginTop: 10, lineHeight: 1.5 },
      }, `Cleared ${this.state.cleared.aggregates} processed day(s) collected from the previous bucket. They will be rebuilt on the next run.`),
      recognised.length > 0 && React.createElement('div', {
        style: {
          marginTop: 14, border: '1px solid var(--ag-picker-border-faint)', borderRadius: 10,
          background: 'var(--ag-picker-bg-sunken)', overflow: 'hidden',
        },
      },
        ...recognised.map(i => {
          const env = byName.get(i.installId)?.environment ?? 'production';
          const chip = ENV_CHIP[env] ?? ENV_CHIP.production;
          return React.createElement('div', {
            key: i.installId,
            style: { display: 'flex', alignItems: 'center', gap: 11, padding: '12px 15px', borderBottom: '1px solid var(--ag-picker-border-faint)' },
          },
            React.createElement('span', { style: { flex: 'none', width: 7, height: 7, borderRadius: '50%', background: 'var(--ag-picker-success)' } }),
            React.createElement('span', {
              style: { fontFamily: MONO, fontSize: 12.5, width: 160, flex: 'none', color: 'var(--ag-picker-text-primary)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' as const },
            }, i.installId),
            React.createElement('span', {
              style: { fontSize: 9.5, fontWeight: 700, letterSpacing: '0.4px', color: chip.color, background: chip.bg, padding: '2px 7px', borderRadius: 4, flex: 'none' },
            }, env.toUpperCase()),
            React.createElement('div', { style: { flex: 1 } }),
            React.createElement('span', {
              style: { fontSize: 11.5, color: 'var(--ag-picker-text-dim)', fontFamily: MONO },
            }, `${i.objectCount.toLocaleString()} objects`),
          );
        }),
      ),
      React.createElement('div', {
        style: { fontSize: 11.5, color: 'var(--ag-picker-text-muted)', marginTop: 12, lineHeight: 1.6 },
      }, noteParts.join(' ')),
    );
  }

  // ── footer ─────────────────────────────────────────────────────────────────

  private footerPrimary(): { label: string; onClick: () => void; disabled: boolean } {
    const { phase, failure } = this.state;
    if (phase === 'scanning') return { label: 'Scanning…', onClick: () => {}, disabled: true };
    if (phase === 'result')   return { label: 'Go to sites', onClick: this.props.onClose, disabled: false };

    // The fix IS the primary button, so it can never be scrolled out of reach. Drop it back to a
    // plain retry when the backend could not name an alternative — an explanation with no button
    // beats a button that guesses.
    if (failure?.suggestedRegion) {
      const region = failure.suggestedRegion;
      return { label: `Use ${region}`, onClick: () => this.applySuggestionAndRetry({ region }), disabled: false };
    }
    if (failure?.suggestedPrefix) {
      const prefix = failure.suggestedPrefix;
      return { label: `Use ${prefix}`, onClick: () => this.applySuggestionAndRetry({ prefix }), disabled: false };
    }
    // A credential problem — whether it arrived as a scan failure or was already missing when the
    // modal opened (reachable via Change after the key was revoked) — makes the credential the
    // action. Offering a disabled "Scan bucket" instead would present the blocked step as the
    // primary and leave the user to find the real one in the body.
    if (!this.props.aws.connected
      || (failure && ['InvalidAccessKeyId', 'SignatureDoesNotMatch', 'NotConnected'].includes(failure.errorCode))) {
      return { label: 'Open Connected accounts', onClick: () => openNexusPreferences(), disabled: false };
    }
    return {
      label: failure ? 'Scan again' : 'Scan bucket',
      onClick: () => { void this.submit(); },
      disabled: this.state.bucket.trim().length === 0,
    };
  }

  render() {
    const { phase } = this.state;
    const primary = this.footerPrimary();
    const title = phase === 'scanning' ? 'Scanning the bucket'
      : phase === 'result' ? 'Installs found'
      : 'Connect the log bucket';
    const sub = phase === 'scanning' ? 'Listing objects and keeping the apache-style logs.'
      : phase === 'result' ? 'Matched against the installs on your WP Engine account.'
      : 'One bucket and prefix for the whole account. Installs are recognised by the name in each filename.';

    return React.createElement('div', {
      style: {
        position: 'fixed' as const, inset: 0, zIndex: 1000, background: 'rgba(8,10,13,0.6)',
        display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 40,
      },
      onClick: (e: any) => { if (e.target === e.currentTarget && phase !== 'scanning') this.props.onClose(); },
    },
      React.createElement('div', {
        style: {
          width: 600, maxWidth: '100%', maxHeight: '100%', display: 'flex', flexDirection: 'column' as const,
          background: 'var(--ag-picker-bg-raised)', border: '1px solid var(--ag-picker-border)',
          borderRadius: 14, boxShadow: '0 24px 60px rgba(0,0,0,0.55)', overflow: 'hidden',
        },
      },
        React.createElement('div', {
          style: { flex: 'none', padding: '20px 24px 16px', borderBottom: '1px solid var(--ag-picker-border-faint)' },
        },
          React.createElement('div', { style: { fontSize: 15.5, fontWeight: 600, color: 'var(--ag-picker-text-primary)' } }, title),
          React.createElement('div', { style: { fontSize: 12.5, color: 'var(--ag-picker-text-secondary)', marginTop: 5, lineHeight: 1.5 } }, sub),
        ),
        React.createElement('div', { style: { flex: 1, overflowY: 'auto' as const, padding: '20px 24px' } },
          phase === 'form' ? this.renderForm() : phase === 'scanning' ? this.renderScanning() : this.renderResult(),
        ),
        React.createElement('div', {
          style: {
            flex: 'none', display: 'flex', gap: 11, alignItems: 'center', padding: '16px 24px',
            borderTop: '1px solid var(--ag-picker-border-faint)', background: 'var(--ag-picker-bg-footer)',
          },
        },
          React.createElement('div', { style: { flex: 1 } }),
          React.createElement('button', {
            onClick: this.props.onClose,
            disabled: phase === 'scanning',
            style: {
              background: 'var(--ag-picker-bg-raised)', border: '1px solid var(--ag-picker-border)',
              color: 'var(--ag-picker-text-secondary)', fontWeight: 500, fontSize: 13,
              padding: '10px 18px', borderRadius: 9,
              cursor: phase === 'scanning' ? 'not-allowed' : 'pointer',
              opacity: phase === 'scanning' ? 0.5 : 1,
            },
          }, phase === 'result' ? 'Close' : 'Cancel'),
          React.createElement('button', {
            onClick: primary.onClick,
            disabled: primary.disabled,
            style: {
              background: primary.disabled ? 'var(--ag-picker-disabled-fill)' : 'var(--ag-picker-teal)',
              border: 'none',
              color: primary.disabled ? 'var(--ag-picker-disabled-text)' : 'var(--ag-picker-on-teal)',
              fontWeight: 600, fontSize: 13, padding: '10px 20px', borderRadius: 9,
              cursor: primary.disabled ? 'not-allowed' : 'pointer',
              maxWidth: 280, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' as const,
            },
          }, primary.label),
        ),
      ),
    );
  }
}
