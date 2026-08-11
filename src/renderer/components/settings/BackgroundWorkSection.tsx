/**
 * BackgroundWorkSection — what background work costs.
 *
 * The section that carries Spec 6a's argument: tells the user what Nexus costs
 * them on a timer. Everything displayed is computed in `derived.ts` — no
 * arithmetic, no toLocaleString, no counts in string literals here.
 */
import * as React from 'react';
import type { Derived, JobRow, Destination } from './derived';
import type { NexusSettings } from '../../../common/types';

interface Props {
  derived: Derived;
  onSave: (patch: Partial<NexusSettings>) => void;
}

// Map job rows to their enable/interval keys
const JOB_KEYS: Record<string, { enableKey: keyof NexusSettings | null; intervalKey: keyof NexusSettings }> = {
  wpeRefresh:           { enableKey: 'wpeRefreshAutoEnabled',           intervalKey: 'wpeRefreshIntervalHours' },
  wpeSync:              { enableKey: 'wpeSyncAutoEnabled',              intervalKey: 'wpeSyncIntervalHours' },
  wpeContentIndex:      { enableKey: 'wpeContentIndexAutoEnabled',      intervalKey: 'wpeContentIndexIntervalHours' },
  externalRefresh:      { enableKey: 'externalRefreshAutoEnabled',      intervalKey: 'externalRefreshIntervalHours' },
  externalContentIndex: { enableKey: 'externalContentIndexAutoEnabled', intervalKey: 'externalContentIndexIntervalHours' },
  localContentIndex:    { enableKey: 'localContentIndexAutoEnabled',    intervalKey: 'localContentIndexIntervalHours' },
  haltedSiteRefresh:    { enableKey: null,                             intervalKey: 'haltedSiteRefreshIntervalHours' },
};

const JOB_DESCRIPTIONS: Record<string, string> = {
  wpeRefresh:           'Reads which plugins, themes and versions are on each install. This is the expensive one.',
  wpeSync:              'URLs, admin emails and post counts. Opens its own connection to each install.',
  wpeContentIndex:      'Indexes page and post text. Rides along with the check above.',
  externalRefresh:      'Reads plugins, themes and versions on sites that are not at WP Engine.',
  externalContentIndex: 'Indexes page and post text on those same sites.',
  localContentIndex:    'Starts a stopped site, reads its content, stops it again.',
  haltedSiteRefresh:    'Reads files on disk. Nothing starts up and nothing connects anywhere.',
};

export class BackgroundWorkSection extends React.Component<Props> {
  handleToggle = (key: keyof NexusSettings, value: boolean): void => {
    this.props.onSave({ [key]: value });
  };

  handleIntervalChange = (key: keyof NexusSettings, value: number): void => {
    // Clamp to [1, 168] as enforced by UpdateSettingsSchema
    const clamped = Math.max(1, Math.min(168, value));
    this.props.onSave({ [key]: clamped });
  };

  renderMasterSwitch(): React.ReactElement {
    const { paused } = this.props.derived;

    const label = paused
      ? 'Background work is paused'
      : 'Nexus is keeping itself up to date';

    const sub = paused
      ? 'Nothing is running on a schedule and what Nexus knows will go stale. Your settings below are kept — switching this back on restores them.'
      : 'Pausing this stops every schedule below and keeps your per-job settings exactly as they are — you can still run anything by hand.';

    return React.createElement('div', {
      style: {
        marginBottom: 24,
        padding: 16,
        background: 'var(--nxai-card-bg)',
        border: '1px solid var(--nxai-card-border)',
        borderRadius: 6,
      },
    },
      React.createElement('div', {
        style: { display: 'flex', alignItems: 'center', marginBottom: 8 },
      },
        React.createElement('input', {
          type: 'checkbox',
          checked: !paused,
          onChange: (e: any) => this.props.onSave({ backgroundWorkPaused: !e.target.checked }),
          style: { marginRight: 12 },
        }),
        React.createElement('span', {
          style: {
            fontSize: 14,
            fontWeight: 600,
            color: 'var(--nxai-card-text)',
          },
        }, label),
      ),
      React.createElement('div', {
        style: {
          fontSize: 13,
          lineHeight: 1.5,
          color: 'var(--nxai-card-sub)',
          marginLeft: 24,
        },
      }, sub),
    );
  }

  renderSummary(): React.ReactElement {
    const { summary } = this.props.derived;

    const renderColumn = (
      head: string,
      figure: number | null,
      unit: string,
      scope: string | null,
      note: string | null,
      amber: boolean,
    ) => {
      const figureColor = amber ? 'var(--nxai-warn-text)' : 'var(--nxai-card-text)';

      return React.createElement('div', {
        style: {
          flex: 1,
          padding: '12px 16px',
        },
      },
        React.createElement('div', {
          style: {
            fontSize: 11,
            fontWeight: 800,
            textTransform: 'uppercase',
            letterSpacing: '0.07em',
            color: '#6b7280',
            marginBottom: 8,
          },
        }, head),
        React.createElement('div', {
          style: {
            fontSize: 24,
            fontWeight: 700,
            color: figureColor,
          },
        }, figure != null ? figure.toLocaleString('en-US') : '—'),
        React.createElement('div', {
          style: {
            fontSize: 13,
            color: 'var(--nxai-card-sub)',
            marginTop: 4,
          },
        }, unit),
        scope ? React.createElement('div', {
          style: {
            fontSize: 12,
            color: 'var(--nxai-card-label)',
            marginTop: 4,
          },
        }, scope) : null,
        note ? React.createElement('div', {
          style: {
            fontSize: 12,
            color: amber ? 'var(--nxai-warn-text)' : 'var(--nxai-card-label)',
            marginTop: 4,
            fontWeight: amber ? 600 : 400,
          },
        }, note) : null,
      );
    };

    const wpe = summary.wpe;
    const ext = summary.ext;
    const time = summary.time;

    const wpeNote = wpe
      ? (wpe.amber ? 'very frequent' : (wpe.jobsTotal > 0 ? `${wpe.jobsOn} of ${wpe.jobsTotal} jobs on` : null))
      : null;

    const extNote = ext
      ? (ext.amber ? 'too frequent for shared hosting' : (ext.jobsTotal > 0 ? `${ext.jobsOn} of ${ext.jobsTotal} jobs on` : null))
      : null;

    const timeMins = time.minsPerDay != null
      ? `${Math.round(time.minsPerDay)} min of work a day`
      : 'nothing scheduled';

    const timeNext = this.props.derived.paused
      ? 'next pass paused'
      : (time.nextInHours != null
        ? `next pass in about ${Math.round(time.nextInHours)}h`
        : null);

    const timeScope = timeNext ? [timeMins, timeNext].join(' · ') : timeMins;

    return React.createElement('div', {
      style: {
        display: 'flex',
        background: 'var(--nxai-card-bg)',
        border: '1px solid var(--nxai-card-border)',
        borderRadius: 6,
        marginBottom: 24,
        overflow: 'hidden',
      },
    },
      wpe ? [
        renderColumn(
          'YOUR WP ENGINE ACCOUNT',
          wpe.figure,
          wpe.unit,
          wpe.scope,
          wpeNote,
          wpe.amber,
        ),
        React.createElement('div', {
          key: 'sep1',
          style: { width: 1, background: '#f3f4f6' },
        }),
      ] : null,
      ext ? [
        renderColumn(
          "OTHER PEOPLE'S SERVERS",
          ext.figure,
          ext.unit,
          ext.scope,
          extNote,
          ext.amber,
        ),
        React.createElement('div', {
          key: 'sep2',
          style: { width: 1, background: '#f3f4f6' },
        }),
      ] : null,
      renderColumn(
        'TIME',
        null,
        timeScope,
        null,
        null,
        false,
      ),
    );
  }

  renderGroup(group: Destination, header: string, hint: string, rows: JobRow[]): React.ReactElement | null {
    if (rows.length === 0) return null;

    return React.createElement('div', {
      key: group,
      style: { marginBottom: 32 },
    },
      React.createElement('div', {
        style: {
          fontSize: 14,
          fontWeight: 700,
          color: 'var(--nxai-card-text)',
          marginBottom: 4,
        },
      }, header),
      React.createElement('div', {
        style: {
          fontSize: 13,
          lineHeight: 1.5,
          color: 'var(--nxai-card-sub)',
          marginBottom: 16,
        },
      }, hint),
      ...rows.map(row => this.renderRow(row)),
    );
  }

  renderRow(row: JobRow): React.ReactElement {
    const keys = JOB_KEYS[row.key];
    const description = JOB_DESCRIPTIONS[row.key];

    const intervalOptions = [1, 2, 4, 8, 12, 24, 48, 168];

    return React.createElement('div', {
      key: row.key,
      style: {
        display: 'flex',
        alignItems: 'center',
        padding: '12px 16px',
        background: 'var(--nxai-card-bg)',
        border: '1px solid var(--nxai-card-border)',
        borderRadius: 6,
        marginBottom: 8,
      },
    },
      // Name & description
      React.createElement('div', { style: { flex: 1 } },
        React.createElement('div', {
          style: {
            fontSize: 14,
            fontWeight: 600,
            color: 'var(--nxai-card-text)',
            marginBottom: 4,
          },
        }, row.name),
        React.createElement('div', {
          style: {
            fontSize: 12,
            color: 'var(--nxai-card-sub)',
          },
        }, description),
      ),
      // Interval stepper
      React.createElement('div', {
        style: {
          display: 'flex',
          alignItems: 'center',
          marginRight: 16,
        },
      },
        React.createElement('span', {
          style: {
            fontSize: 12,
            color: 'var(--nxai-card-label)',
            marginRight: 8,
          },
        }, 'every'),
        React.createElement('select', {
          value: row.hours,
          onChange: (e: any) => this.handleIntervalChange(keys.intervalKey, parseInt(e.target.value, 10)),
          style: {
            padding: '4px 8px',
            fontSize: 13,
            background: 'var(--nxai-input-bg)',
            border: '1px solid var(--nxai-input-border)',
            borderRadius: 4,
            color: 'var(--nxai-card-text)',
          },
        },
          ...intervalOptions.map(h =>
            React.createElement('option', { key: h, value: h },
              h === 1 ? 'hour' : `${h}h`),
          ),
        ),
      ),
      // Cost
      React.createElement('div', {
        style: {
          width: 190,
          textAlign: 'right',
          fontSize: 12,
          color: 'var(--nxai-card-label)',
          marginRight: 16,
        },
      }, row.costLabel),
      // Toggle or ALWAYS ON
      row.alwaysOn
        ? React.createElement('div', {
          style: {
            fontSize: 11,
            fontWeight: 700,
            color: 'var(--nxai-card-label)',
            letterSpacing: '0.05em',
          },
        }, 'ALWAYS ON')
        : React.createElement('input', {
          type: 'checkbox',
          checked: row.userEnabled,
          onChange: (e: any) => this.handleToggle(keys.enableKey!, e.target.checked),
        }),
    );
  }

  render(): React.ReactElement {
    const { derived } = this.props;
    const { rows } = derived;

    const wpeRows = rows.filter(r => r.group === 'wpe');
    const extRows = rows.filter(r => r.group === 'ext');
    const localRows = rows.filter(r => r.group === 'local');

    return React.createElement('div', null,
      // Subtitle
      React.createElement('div', {
        style: {
          fontSize: 13,
          lineHeight: 1.5,
          color: 'var(--nxai-card-sub)',
          marginBottom: 16,
        },
      }, 'Nexus does some work on a schedule so it can answer questions without going out to your sites first. This is what that costs.'),

      this.renderMasterSwitch(),
      this.renderSummary(),

      // Three groups
      this.renderGroup(
        'wpe',
        'ON YOUR WP ENGINE ACCOUNT',
        'These reuse one connection per install where they can, so they can run often.',
        wpeRows,
      ),
      this.renderGroup(
        'ext',
        "ON OTHER PEOPLE'S SERVERS",
        'Each of these opens its own SSH session per host and cannot share one with the other. Shared hosting limits how many you may open at once, so Nexus runs them less often on purpose.',
        extRows,
      ),
      this.renderGroup(
        'local',
        'ON THIS MAC',
        'Nothing here connects anywhere.',
        localRows,
      ),
    );
  }
}
