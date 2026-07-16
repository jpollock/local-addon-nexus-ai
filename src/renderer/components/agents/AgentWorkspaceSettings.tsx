import * as React from 'react';
import { agentStore, AgentSettings } from './AgentStore';

interface SettingsProps {
  agentId: string;
}

interface SettingsState {
  settings: AgentSettings;
}

const CADENCE_OPTIONS = [
  { label: 'Every 15 minutes', value: '*/15 * * * *' },
  { label: 'Hourly',           value: '0 * * * *' },
  { label: 'Every 6 hours',    value: '0 */6 * * *' },
  { label: 'Daily',            value: '0 0 * * *' },
  { label: 'Weekly',           value: '0 0 * * 0' },
];

// Event catalog per agent — in production, fetched from agent definition
const EVENT_CATALOG: Record<string, Array<{ id: string; label: string; description: string }>> = {
  'security-sentinel': [
    { id: 'wpe:sync.completed',   label: 'WPE sync completed',    description: 'Triggers after the 4-hour metadata sync refreshes plugin/user data for an install' },
    { id: 'wp:plugin.activated',  label: 'Plugin activated',      description: 'Triggers when a plugin is activated on any local site' },
    { id: 'wp:user.created',      label: 'User account created',  description: 'Triggers when a new user account is created on any local site' },
  ],
};

const AUTONOMY_OPTIONS = [
  { value: 'suggest', label: 'Suggest only',     desc: 'The agent surfaces findings but takes no action — you do everything.' },
  { value: 'ask',     label: 'Act, but ask first', desc: 'The agent investigates autonomously and prepares a plan, but waits for your approval before touching production.' },
  { value: 'auto',    label: 'Fully autonomous',  desc: 'The agent detects, investigates, remediates, and verifies without asking. Use with caution.' },
];

class ToggleSwitch extends React.Component<{ checked: boolean; onChange: (v: boolean) => void }> {
  render() {
    const { checked, onChange } = this.props;
    return React.createElement('div', {
      className: `ag-toggle ag-toggle--${checked ? 'on' : 'off'}`,
      onClick: () => onChange(!checked),
      role: 'switch',
      'aria-checked': checked,
    },
      React.createElement('div', { className: 'ag-toggle__knob' }),
    );
  }
}

export class AgentWorkspaceSettings extends React.Component<SettingsProps, SettingsState> {
  state: SettingsState = { settings: agentStore.getOrInitSettings(this.props.agentId) };
  private unsubscribe!: () => void;

  componentDidMount() {
    const update = () => this.setState({ settings: agentStore.getOrInitSettings(this.props.agentId) });
    agentStore.subscribe(update);
    this.unsubscribe = () => agentStore.unsubscribe(update);
  }

  componentWillUnmount() {
    this.unsubscribe();
  }

  private updateSettings(patch: Partial<AgentSettings>) {
    const next = { ...this.state.settings, ...patch };
    agentStore.setState({
      agentSettings: { ...agentStore.getState().agentSettings, [this.props.agentId]: next },
    });
  }

  private cycleCadence() {
    const { cadence } = this.state.settings;
    const idx = CADENCE_OPTIONS.findIndex(o => o.value === cadence);
    const next = CADENCE_OPTIONS[(idx + 1) % CADENCE_OPTIONS.length];
    this.updateSettings({ cadence: next.value });
  }

  private getRunSummary(): string {
    const { settings } = this.state;
    if (!settings.enabled) return 'Disabled — not running';
    const parts: string[] = [];
    const cadence = CADENCE_OPTIONS.find(o => o.value === settings.cadence);
    if (settings.scheduleEnabled && cadence) parts.push(`Runs ${cadence.label.toLowerCase()}`);
    const catalog = EVENT_CATALOG[this.props.agentId] || [];
    const subCount = catalog.filter(e => settings.subscribedEvents[e.id] !== false).length;
    if (settings.eventsEnabled && subCount > 0) parts.push(`responds to ${subCount} event${subCount !== 1 ? 's' : ''}`);
    parts.push('ad-hoc');
    return parts.join(' · ');
  }

  private renderCard(children: React.ReactNode, dimmed = false) {
    return React.createElement('div', {
      style: {
        background: 'var(--ag-bg-card)', border: '1px solid var(--ag-border)', borderRadius: 12,
        padding: '20px 22px', marginBottom: 12, opacity: dimmed ? 0.45 : 1,
        pointerEvents: dimmed ? 'none' : 'auto',
        transition: 'opacity 0.15s',
      },
    }, children);
  }

  render() {
    const { settings } = this.state;
    const { agentId } = this.props;
    const catalog = EVENT_CATALOG[agentId] || [];
    const currentAutonomy = agentStore.getState().autonomyById[agentId] || 'ask';

    return React.createElement('div', { style: { maxWidth: 680 } },

      // Card 1: Enable + Run now
      this.renderCard(
        React.createElement('div', { style: { display: 'flex', alignItems: 'center', gap: 16 } },
          React.createElement(ToggleSwitch, {
            checked: settings.enabled,
            onChange: (v) => this.updateSettings({ enabled: v }),
          }),
          React.createElement('div', { style: { flex: 1 } },
            React.createElement('div', { style: { fontSize: 15, fontWeight: 600, color: 'var(--ag-text-primary)', marginBottom: 2 } },
              settings.enabled ? 'Agent enabled' : 'Agent disabled',
            ),
            React.createElement('div', { style: { fontSize: 12.5, color: 'var(--ag-text-secondary)' } },
              settings.enabled
                ? 'Running via its configured triggers below. Toggle off to stop all scheduled, event, and ad-hoc runs.'
                : 'Agent will not run on any trigger until re-enabled.',
            ),
          ),
          React.createElement('button', {
            disabled: !settings.enabled,
            style: {
              background: settings.enabled ? 'var(--ag-teal)' : 'var(--ag-bg-elevated)',
              color: settings.enabled ? 'var(--ag-on-teal)' : 'var(--ag-text-faint)',
              border: 'none', borderRadius: 8, padding: '8px 18px',
              fontSize: 13, fontWeight: 600, cursor: settings.enabled ? 'pointer' : 'not-allowed',
              display: 'flex', alignItems: 'center', gap: 6, flexShrink: 0,
            },
          }, '▶ Run now'),
        ),
      ),

      // Card 2: How this agent runs
      this.renderCard(
        React.createElement('div', null,
          React.createElement('div', { style: { fontSize: 14.5, fontWeight: 600, color: 'var(--ag-text-primary)', marginBottom: 16 } }, 'How this agent runs'),

          // On a schedule
          React.createElement('div', { style: { display: 'flex', alignItems: 'center', gap: 12, marginBottom: 14 } },
            React.createElement(ToggleSwitch, { checked: settings.scheduleEnabled, onChange: (v) => this.updateSettings({ scheduleEnabled: v }) }),
            React.createElement('div', { style: { flex: 1 } },
              React.createElement('div', { style: { fontSize: 13.5, color: 'var(--ag-text-primary)' } }, 'On a schedule'),
            ),
            React.createElement('button', {
              onClick: () => this.cycleCadence(),
              style: {
                background: 'var(--ag-bg-elevated)', border: '1px solid var(--ag-border-control)',
                borderRadius: 7, padding: '5px 12px', fontSize: 12.5, color: 'var(--ag-text-primary)',
                cursor: 'pointer', fontWeight: 500,
              },
            }, CADENCE_OPTIONS.find(o => o.value === settings.cadence)?.label || 'Every 15 minutes'),
          ),

          // Respond to events
          React.createElement('div', { style: { marginBottom: 14 } },
            React.createElement('div', { style: { display: 'flex', alignItems: 'center', gap: 12, marginBottom: settings.eventsEnabled ? 12 : 0 } },
              React.createElement(ToggleSwitch, {
                checked: settings.eventsEnabled,
                onChange: (v) => this.updateSettings({ eventsEnabled: v }),
              }),
              React.createElement('div', { style: { fontSize: 13.5, color: 'var(--ag-text-primary)' } }, 'Respond to events'),
            ),
            settings.eventsEnabled && React.createElement('div', { style: { paddingLeft: 52 } },
              ...catalog.map(evt => {
                const isSubscribed = settings.subscribedEvents[evt.id] !== false;
                return React.createElement('div', {
                  key: evt.id,
                  onClick: () => this.updateSettings({
                    subscribedEvents: { ...settings.subscribedEvents, [evt.id]: !isSubscribed },
                  }),
                  style: {
                    display: 'flex', alignItems: 'flex-start', gap: 10, marginBottom: 10, cursor: 'pointer',
                  },
                },
                  React.createElement('div', {
                    className: `ag-checkbox ${isSubscribed ? 'ag-checkbox--checked' : ''}`,
                    style: { marginTop: 2 },
                  }, isSubscribed ? '✓' : ''),
                  React.createElement('div', null,
                    React.createElement('div', { style: { fontSize: 13, color: 'var(--ag-text-primary)', marginBottom: 2 } }, evt.label),
                    React.createElement('div', { style: { fontSize: 12, color: 'var(--ag-text-secondary)' } }, evt.description),
                  ),
                );
              }),
            ),
          ),

          // Ad-hoc (always on)
          React.createElement('div', { style: { display: 'flex', alignItems: 'center', gap: 12 } },
            React.createElement('div', {
              style: { width: 40, height: 23, display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--ag-text-muted)', fontSize: 11 },
            }, '—'),
            React.createElement('div', { style: { flex: 1, fontSize: 13.5, color: 'var(--ag-text-primary)' } }, 'Ad-hoc'),
            React.createElement('div', { style: { fontSize: 12, color: 'var(--ag-text-muted)' } }, 'Via Run now button'),
          ),

        ),
        !settings.enabled,
      ),

      // Card 3: Autonomy
      this.renderCard(
        React.createElement('div', null,
          React.createElement('div', { style: { fontSize: 14.5, fontWeight: 600, color: 'var(--ag-text-primary)', marginBottom: 12 } }, 'Autonomy level'),
          ...AUTONOMY_OPTIONS.map(opt => {
            const selected = currentAutonomy === opt.value;
            return React.createElement('div', {
              key: opt.value,
              onClick: () => agentStore.setState({
                autonomyById: { ...agentStore.getState().autonomyById, [agentId]: opt.value as any },
              }),
              style: {
                display: 'flex', alignItems: 'flex-start', gap: 12, padding: '12px 14px', borderRadius: 10,
                cursor: 'pointer', marginBottom: 8,
                background: selected ? 'rgba(53,208,197,0.08)' : 'transparent',
                border: `1px solid ${selected ? 'rgba(53,208,197,0.4)' : 'transparent'}`,
                transition: 'background 0.12s, border-color 0.12s',
              },
            },
              // Radio dot
              React.createElement('div', {
                style: {
                  width: 16, height: 16, borderRadius: '50%', flexShrink: 0, marginTop: 2,
                  border: `2px solid ${selected ? 'var(--ag-teal)' : 'var(--ag-border)'}`,
                  background: selected ? 'var(--ag-teal)' : 'transparent',
                  transition: 'background 0.12s, border-color 0.12s',
                },
              }),
              React.createElement('div', null,
                React.createElement('div', { style: { fontSize: 13.5, fontWeight: 500, color: 'var(--ag-text-primary)', marginBottom: 3 } }, opt.label),
                React.createElement('div', { style: { fontSize: 12.5, color: 'var(--ag-text-secondary)' } }, opt.desc),
              ),
            );
          }),
        ),
        !settings.enabled,
      ),
    );
  }
}
