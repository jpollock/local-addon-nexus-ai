import * as React from 'react';
import { IPC_CHANNELS } from '../../../common/constants';
import { Ga4Binding, matchScore } from './analyticsSitesModel';
import { openNexusPreferences, openExternalUrl, parseDisabledGoogleApi } from './openNexusPreferences';

/**
 * Bind one GA4 property to one site.
 *
 * log-processor has no equivalent screen and deliberately so — its join is exact. This one exists
 * because GA4 property names are free text: the suggestion is ordered evidence, and a person makes
 * the call. Binding the wrong property puts one client's traffic in another client's report, and
 * nothing downstream would ever flag it.
 */

const MONO = "'JetBrains Mono', ui-monospace, SFMono-Regular, Menlo, monospace";

export interface Ga4Property {
  property: string;
  displayName: string;
  account: string;
}

interface Props {
  electron?: any;
  siteName: string;
  /** Present when re-binding an already-bound site. */
  current?: Ga4Binding;
  onClose: () => void;
  /** Fired after a successful bind or unbind so the caller reloads its derived set. */
  onBound: () => void;
}

interface State {
  phase: 'loading' | 'choose' | 'saving';
  properties: Ga4Property[];
  selected: string | null;
  error: { code: string; message: string } | null;
  /** The picker shows the strongest matches first and hides the tail until asked. */
  showAll: boolean;
}

const SHORTLIST = 5;

function parse(result: any): any {
  const text = result?.content?.[0]?.text;
  if (typeof text !== 'string') return { ok: false, errorCode: 'Unknown', message: 'The agent returned no response.' };
  try { return JSON.parse(text); } catch { return { ok: false, errorCode: 'Unknown', message: text }; }
}

export class Ga4PropertyModal extends React.Component<Props, State> {
  state: State = { phase: 'loading', properties: [], selected: null, error: null, showAll: false };

  componentDidMount() { void this.load(); }

  private invoke(args: Record<string, unknown>) {
    const ipc = this.props.electron?.ipcRenderer;
    if (!ipc) return Promise.resolve({ content: [{ type: 'text', text: '{"ok":false,"errorCode":"Unknown","message":"No IPC"}' }] });
    return ipc.invoke(IPC_CHANNELS.AGENT_TOOL_INVOKE, {
      agentId: 'web-analytics', toolName: 'list_properties', args,
    }).catch((e: Error) => ({ content: [{ type: 'text', text: JSON.stringify({ ok: false, errorCode: 'Unknown', message: e.message }) }] }));
  }

  private async load(): Promise<void> {
    this.setState({ phase: 'loading', error: null });
    const data = parse(await this.invoke({ format: 'json' }));
    if (!data?.ok) {
      this.setState({ phase: 'choose', error: { code: data?.errorCode ?? 'Unknown', message: data?.message ?? 'Could not read your GA4 properties.' } });
      return;
    }
    const properties: Ga4Property[] = data.properties ?? [];
    this.setState({
      phase: 'choose',
      properties,
      // Pre-select the strongest match if there is a clear one, so the common case is one click.
      // Never auto-applied — the user still confirms.
      selected: this.props.current?.property ?? this.bestGuess(properties),
    });
  }

  private bestGuess(properties: Ga4Property[]): string | null {
    const scored = properties
      .map(p => ({ p, score: matchScore(this.props.siteName, p.displayName) }))
      .filter(x => x.score > 0)
      .sort((a, b) => b.score - a.score);
    // Only when one property clearly leads. A tie means the evidence is ambiguous, and offering a
    // pre-picked answer would present a coin toss as a recommendation.
    if (scored.length === 0) return null;
    if (scored.length > 1 && scored[0].score === scored[1].score) return null;
    return scored[0].p.property;
  }

  private ranked(): Array<{ p: Ga4Property; score: number }> {
    return this.state.properties
      .map(p => ({ p, score: matchScore(this.props.siteName, p.displayName) }))
      .sort((a, b) => b.score - a.score || a.p.displayName.localeCompare(b.p.displayName));
  }

  private async commit(unbind = false): Promise<void> {
    const ipc = this.props.electron?.ipcRenderer;
    if (!ipc) return;
    this.setState({ phase: 'saving', error: null });
    const result = await ipc.invoke(IPC_CHANNELS.AGENT_TOOL_INVOKE, {
      agentId: 'web-analytics',
      toolName: 'map_property',
      args: unbind
        ? { siteId: this.props.siteName, unbind: true, format: 'json' }
        : { siteId: this.props.siteName, propertyId: this.state.selected, format: 'json' },
    }).catch((e: Error) => ({ content: [{ type: 'text', text: JSON.stringify({ ok: false, errorCode: 'Unknown', message: e.message }) }] }));

    const data = parse(result);
    if (!data?.ok) {
      this.setState({ phase: 'choose', error: { code: data?.errorCode ?? 'Unknown', message: data?.message ?? 'Could not save the binding.' } });
      return;
    }
    this.props.onBound();
    this.props.onClose();
  }

  /** A disabled Google API, if that's what failed. Cached per render — cheap and pure. */
  private disabledApi() {
    return this.state.error ? parseDisabledGoogleApi(this.state.error.message) : null;
  }

  private renderError() {
    const e = this.state.error;
    if (!e) return null;
    const credentialProblem = ['NotConnected', 'Revoked', 'TokenError'].includes(e.code);
    const disabled = this.disabledApi();

    // Google tells you exactly which API is off and where to switch it on. Leaving that as a wall
    // of unselectable text — with a project id in the URL — makes the user transcribe the fix.
    if (disabled) {
      return React.createElement('div', {
        style: {
          marginBottom: 16, padding: '13px 15px', borderRadius: 10,
          background: 'rgba(242,181,68,0.07)', border: '1px solid rgba(242,181,68,0.32)',
        },
      },
        React.createElement('div', { style: { fontSize: 13.5, fontWeight: 600, color: 'var(--ag-picker-warning)' } },
          `Enable the ${disabled.label} on this Google Cloud project`),
        React.createElement('div', { style: { fontSize: 12.5, color: 'var(--ag-picker-text-secondary)', marginTop: 5, lineHeight: 1.5 } },
          'A one-time setting on the project the OAuth client belongs to, not something to fix here. '
          + 'It can take a few minutes to take effect after you switch it on.'),
        // Both are needed and Google only ever names the one you hit first, so the second would
        // otherwise fail identically ten minutes later.
        React.createElement('div', {
          style: { fontSize: 12, color: 'var(--ag-picker-text-muted)', marginTop: 8, lineHeight: 1.5 },
        }, 'This agent needs two: the Admin API to list properties, and the Data API for every report. Enable both while you are there.'),
        React.createElement('div', {
          style: {
            marginTop: 10, padding: '8px 11px', borderRadius: 7, fontFamily: MONO, fontSize: 11.5,
            color: 'var(--ag-picker-text-dim)', background: 'var(--ag-picker-bg-sunken)',
            border: '1px solid var(--ag-picker-border-faint)', wordBreak: 'break-all' as const,
          },
        }, disabled.url),
      );
    }
    const headline: Record<string, string> = {
      NotConnected: 'This agent can\'t use your Google account yet',
      Revoked: 'Google access was revoked',
      TokenError: 'Could not refresh the Google token',
      ListFailed: 'Google would not return your properties',
      NotFound: 'That property is no longer on this account',
    };
    return React.createElement('div', {
      style: {
        marginBottom: 16, padding: '13px 15px', borderRadius: 10,
        background: 'rgba(244,104,95,0.07)', border: '1px solid rgba(244,104,95,0.32)',
      },
    },
      React.createElement('div', { style: { fontSize: 13.5, fontWeight: 600, color: 'var(--ag-picker-danger)' } },
        headline[e.code] ?? 'Could not read your GA4 properties'),
      React.createElement('div', { style: { fontSize: 12.5, color: 'var(--ag-picker-text-secondary)', marginTop: 5, lineHeight: 1.5 } },
        e.code === 'NotConnected'
          // Access is granted per agent, so "connected" and "this agent may use it" are different
          // facts. Telling someone to connect an account they can see connected is a dead end.
          ? 'Each agent is granted access separately. Grant it on the Sites tab, then reopen this.'
          : credentialProblem
            ? 'Reconnect the account, then reopen this. Nothing has been changed.'
            : 'Nothing has been changed. Try again, or reconnect the account if this persists.'),
      React.createElement('div', {
        style: {
          marginTop: 10, padding: '8px 11px', borderRadius: 7, fontFamily: MONO, fontSize: 11.5,
          color: 'var(--ag-picker-text-dim)', background: 'var(--ag-picker-bg-sunken)',
          border: '1px solid var(--ag-picker-border-faint)', wordBreak: 'break-word' as const,
        },
      }, e.message),
    );
  }

  private renderOption(p: Ga4Property, score: number) {
    const picked = this.state.selected === p.property;
    return React.createElement('div', {
      key: p.property,
      role: 'radio',
      'aria-checked': picked,
      onClick: () => this.setState({ selected: p.property }),
      style: {
        display: 'flex', alignItems: 'center', gap: 12, padding: '12px 14px', borderRadius: 9,
        border: `1px solid ${picked ? 'var(--ag-picker-teal)' : 'var(--ag-picker-border-faint)'}`,
        background: picked ? 'rgba(53,208,197,0.08)' : 'var(--ag-picker-bg-sunken)',
        marginBottom: 8, cursor: 'pointer',
      },
    },
      React.createElement('span', {
        style: {
          width: 15, height: 15, borderRadius: '50%', flex: 'none',
          border: `2px solid ${picked ? 'var(--ag-picker-teal)' : 'var(--ag-picker-border-strong)'}`,
          background: picked ? 'var(--ag-picker-teal)' : 'transparent',
        },
      }),
      React.createElement('div', { style: { minWidth: 0, flex: 1 } },
        React.createElement('div', { style: { fontSize: 13, color: 'var(--ag-picker-text-primary)' } }, p.displayName),
        React.createElement('div', {
          style: { fontFamily: MONO, fontSize: 11.5, color: 'var(--ag-picker-text-muted)', marginTop: 2, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' as const },
        }, p.account ? `${p.property} · ${p.account}` : p.property),
      ),
      // Named for what it is — a name that looks similar. Never "recommended".
      score >= 2 && React.createElement('span', {
        style: {
          flex: 'none', fontSize: 10.5, fontWeight: 700, letterSpacing: '0.4px',
          color: 'var(--ag-picker-teal)', background: 'rgba(53,208,197,0.14)', padding: '2px 8px', borderRadius: 4,
        },
      }, 'NAME MATCH'),
    );
  }

  render() {
    const { phase, showAll } = this.state;
    const ranked = this.ranked();
    const visible = showAll ? ranked : ranked.slice(0, SHORTLIST);
    const hidden = ranked.length - visible.length;
    const credentialProblem = this.state.error && ['NotConnected', 'Revoked', 'TokenError'].includes(this.state.error.code);
    const disabled = this.disabledApi();

    return React.createElement('div', {
      style: {
        position: 'fixed' as const, inset: 0, zIndex: 1000, background: 'rgba(8,10,13,0.6)',
        display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 40,
      },
      onClick: (e: any) => { if (e.target === e.currentTarget && phase !== 'saving') this.props.onClose(); },
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
          React.createElement('div', { style: { fontSize: 15.5, fontWeight: 600, color: 'var(--ag-picker-text-primary)' } },
            'Bind a property to ',
            React.createElement('span', { style: { fontFamily: MONO } }, this.props.siteName),
          ),
          React.createElement('div', { style: { fontSize: 12.5, color: 'var(--ag-picker-text-secondary)', marginTop: 5, lineHeight: 1.5 } },
            'Properties on the connected Google account. A name match is a hint — confirm it belongs to this site before binding.'),
        ),

        React.createElement('div', { style: { flex: 1, overflowY: 'auto' as const, padding: '18px 24px' } },
          this.renderError(),
          phase === 'loading'
            ? React.createElement('div', { style: { fontSize: 13, color: 'var(--ag-picker-text-muted)', padding: '10px 0' } }, 'Reading your GA4 properties…')
            : ranked.length === 0 && !this.state.error
              ? React.createElement('div', { style: { padding: '24px 0', textAlign: 'center' as const } },
                  React.createElement('div', { style: { fontSize: 13, color: 'var(--ag-picker-text-secondary)' } }, 'No GA4 properties on this account'),
                  React.createElement('div', { style: { fontSize: 12, color: 'var(--ag-picker-text-muted)', marginTop: 6 } },
                    'The connected Google account can\'t see any Analytics properties. Connect a different account, or check access in Google Analytics.'),
                )
              : React.createElement('div', null,
                  ...visible.map(x => this.renderOption(x.p, x.score)),
                  hidden > 0 && React.createElement('div', {
                    onClick: () => this.setState({ showAll: true }),
                    style: { fontSize: 12, color: 'var(--ag-picker-teal)', cursor: 'pointer', padding: '6px 2px' },
                  }, `Showing ${visible.length} of ${ranked.length} · show the rest`),
                ),
        ),

        React.createElement('div', {
          style: {
            flex: 'none', display: 'flex', gap: 11, alignItems: 'center', padding: '15px 24px',
            borderTop: '1px solid var(--ag-picker-border-faint)', background: 'var(--ag-picker-bg-footer)',
          },
        },
          // Unbinding needs no Google call, so it stays available even when listing failed.
          this.props.current && React.createElement('button', {
            onClick: () => { void this.commit(true); },
            disabled: phase === 'saving',
            style: {
              background: 'transparent', border: '1px solid var(--ag-picker-border)',
              color: 'var(--ag-picker-text-muted)', fontSize: 12.5, padding: '9px 14px',
              borderRadius: 9, cursor: phase === 'saving' ? 'not-allowed' : 'pointer',
            },
          }, 'Unbind'),
          React.createElement('div', { style: { flex: 1 } }),
          React.createElement('button', {
            onClick: this.props.onClose,
            disabled: phase === 'saving',
            style: {
              background: 'var(--ag-picker-bg-raised)', border: '1px solid var(--ag-picker-border)',
              color: 'var(--ag-picker-text-secondary)', fontWeight: 500, fontSize: 13,
              padding: '10px 18px', borderRadius: 9, cursor: phase === 'saving' ? 'not-allowed' : 'pointer',
            },
          }, disabled ? 'Close' : 'Cancel'),
          disabled && React.createElement('button', {
            onClick: () => { void this.load(); },
            style: {
              background: 'var(--ag-picker-bg-raised)', border: '1px solid var(--ag-picker-border-strong)',
              color: 'var(--ag-picker-text-primary)', fontWeight: 500, fontSize: 13,
              padding: '10px 16px', borderRadius: 9, cursor: 'pointer',
            },
          }, 'Try again'),
          disabled
            ? React.createElement('button', {
                onClick: () => openExternalUrl(disabled.url),
                style: {
                  background: 'var(--ag-picker-teal)', border: 'none', color: 'var(--ag-picker-on-teal)',
                  fontWeight: 600, fontSize: 13, padding: '10px 20px', borderRadius: 9, cursor: 'pointer',
                },
              }, 'Open Google Cloud Console')
            : credentialProblem
            ? React.createElement('button', {
                onClick: () => {
                  if (this.state.error?.code === 'NotConnected') { this.props.onClose(); return; }
                  openNexusPreferences();
                },
                style: {
                  background: 'var(--ag-picker-teal)', border: 'none', color: 'var(--ag-picker-on-teal)',
                  fontWeight: 600, fontSize: 13, padding: '10px 20px', borderRadius: 9, cursor: 'pointer',
                },
              }, this.state.error?.code === 'NotConnected' ? 'Close and grant access' : 'Open Connected accounts')
            : React.createElement('button', {
                onClick: () => { void this.commit(); },
                disabled: phase === 'saving' || !this.state.selected,
                style: {
                  background: (phase === 'saving' || !this.state.selected) ? 'var(--ag-picker-disabled-fill)' : 'var(--ag-picker-teal)',
                  border: 'none',
                  color: (phase === 'saving' || !this.state.selected) ? 'var(--ag-picker-disabled-text)' : 'var(--ag-picker-on-teal)',
                  fontWeight: 600, fontSize: 13, padding: '10px 20px', borderRadius: 9,
                  cursor: (phase === 'saving' || !this.state.selected) ? 'not-allowed' : 'pointer',
                },
              }, phase === 'saving' ? 'Binding…' : 'Bind property'),
        ),
      ),
    );
  }
}
