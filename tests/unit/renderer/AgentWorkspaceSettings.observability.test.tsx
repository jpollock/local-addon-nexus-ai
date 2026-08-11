import { AgentWorkspaceSettings } from '../../../src/renderer/components/agents/AgentWorkspaceSettings';
import { agentStore } from '../../../src/renderer/components/agents/AgentStore';
import type { NexusSettings } from '../../../src/common/types';

function spySetState(instance: any): void {
  jest.spyOn(instance, 'setState').mockImplementation(function (this: any, updater: any) {
    const update = typeof updater === 'function' ? updater(this.state) : updater;
    Object.assign(this.state, update);
  });
}

function flattenText(node: any): string {
  if (node === null || node === undefined || typeof node === 'boolean') return '';
  if (typeof node === 'string' || typeof node === 'number') return String(node);
  if (Array.isArray(node)) return node.map(flattenText).join(' ');
  if (node?.props?.children !== undefined) return flattenText(node.props.children);
  return '';
}

function makeSettings(agentId = 'test-agent', globalSettings: Partial<NexusSettings> | null = null) {
  const instance: any = new AgentWorkspaceSettings({ agentId, electron: undefined });
  spySetState(instance);
  instance.state.scopeSites = [];
  instance.state.globalSettings = globalSettings;
  return instance;
}

describe('AgentWorkspaceSettings — Observability controls', () => {
  beforeEach(() => {
    // Reset agent store before each test
    agentStore.setState({
      agentSettings: {},
      autonomyById: {},
      activityEvents: [],
      expandedEvents: {},
      selectedAgentId: null,
      statuses: [],
    });
  });

  describe('Transcripts toggle', () => {
    it('shows transcripts toggle with descriptive copy', () => {
      const instance = makeSettings();
      const text = flattenText(instance.render());
      expect(text).toContain('Write transcripts');
      expect(text).toContain('full prompt and response');
      expect(text).toContain('redacted with the same masking');
      expect(text).toContain('backstop, not a guarantee');
    });

    it('defaults to off when transcripts is undefined', () => {
      const instance = makeSettings();
      const text = flattenText(instance.render());
      expect(instance.state.settings.transcripts).toBeUndefined();
      // Toggle switch should be off — we can't directly inspect the element state,
      // but we can verify updateSettings is called with true when toggled
    });

    it('calls updateSettings with transcripts: true when toggled on', () => {
      const instance = makeSettings();
      const updateSpy = jest.spyOn(instance, 'updateSettings');
      instance.state.settings.transcripts = false;

      const rendered = instance.render();
      // Find the ToggleSwitch for transcripts (first one in the Observability card)
      const observabilityCard = rendered.props.children.find((child: any) =>
        child && flattenText(child).includes('Observability'),
      );
      const transcriptsRow = observabilityCard.props.children.props.children[1];
      const toggleSwitch = transcriptsRow.props.children[0];

      // Simulate toggle
      toggleSwitch.props.onChange(true);

      expect(updateSpy).toHaveBeenCalledWith({ transcripts: true });
    });

    it('calls updateSettings with transcripts: false when toggled off', () => {
      const instance = makeSettings();
      const updateSpy = jest.spyOn(instance, 'updateSettings');
      instance.state.settings.transcripts = true;

      const rendered = instance.render();
      const observabilityCard = rendered.props.children.find((child: any) =>
        child && flattenText(child).includes('Observability'),
      );
      const transcriptsRow = observabilityCard.props.children.props.children[1];
      const toggleSwitch = transcriptsRow.props.children[0];

      toggleSwitch.props.onChange(false);

      expect(updateSpy).toHaveBeenCalledWith({ transcripts: false });
    });
  });

  describe('Log level override', () => {
    it('shows log level control with descriptive copy', () => {
      const instance = makeSettings();
      const text = flattenText(instance.render());
      expect(text).toContain('Log level');
      expect(text).toContain('Override the global log level');
      expect(text).toContain('raising one agent to DEBUG');
      expect(text).toContain('lowering a noisy agent to ERROR');
    });

    it('cycles from Inherit to ERROR to WARN to INFO to DEBUG and back to Inherit', () => {
      const instance = makeSettings('test', { logLevel: 'INFO' });
      const updateSpy = jest.spyOn(instance, 'updateSettings');

      // Start at Inherit (undefined)
      instance.state.settings.logLevel = undefined;
      instance.cycleLogLevel();
      expect(updateSpy).toHaveBeenCalledWith({ logLevel: 'ERROR' });

      // ERROR -> WARN
      instance.state.settings.logLevel = 'ERROR';
      instance.cycleLogLevel();
      expect(updateSpy).toHaveBeenCalledWith({ logLevel: 'WARN' });

      // WARN -> INFO
      instance.state.settings.logLevel = 'WARN';
      instance.cycleLogLevel();
      expect(updateSpy).toHaveBeenCalledWith({ logLevel: 'INFO' });

      // INFO -> DEBUG
      instance.state.settings.logLevel = 'INFO';
      instance.cycleLogLevel();
      expect(updateSpy).toHaveBeenCalledWith({ logLevel: 'DEBUG' });

      // DEBUG -> Inherit (undefined)
      instance.state.settings.logLevel = 'DEBUG';
      instance.cycleLogLevel();
      expect(updateSpy).toHaveBeenCalledWith({ logLevel: undefined });
    });

    it('renders Inherit with the global level when agent has no override', () => {
      const instance = makeSettings('test', { logLevel: 'WARN' });
      instance.state.settings.logLevel = undefined;
      const label = instance.formatLogLevel();
      expect(label).toBe('Inherit (WARN)');
    });

    it('renders just the level when agent has an override', () => {
      const instance = makeSettings('test', { logLevel: 'INFO' });
      instance.state.settings.logLevel = 'DEBUG';
      const label = instance.formatLogLevel();
      expect(label).toBe('DEBUG');
    });

    it('falls back to INFO when global settings is null', () => {
      const instance = makeSettings('test', null);
      instance.state.settings.logLevel = undefined;
      const label = instance.formatLogLevel();
      expect(label).toBe('Inherit (INFO)');
    });

    it('falls back to INFO when global logLevel is undefined', () => {
      const instance = makeSettings('test', {});
      instance.state.settings.logLevel = undefined;
      const label = instance.formatLogLevel();
      expect(label).toBe('Inherit (INFO)');
    });

    it('renders as an override even when it equals the global level', () => {
      const instance = makeSettings('test', { logLevel: 'INFO' });
      instance.state.settings.logLevel = 'INFO';
      const label = instance.formatLogLevel();
      // Should render as 'INFO', not 'Inherit (INFO)'
      expect(label).toBe('INFO');
      expect(label).not.toContain('Inherit');
    });
  });
});

describe('Substitution check — cycling back to Inherit writes undefined', () => {
  beforeEach(() => {
    agentStore.setState({
      agentSettings: {},
      autonomyById: {},
      activityEvents: [],
      expandedEvents: {},
      selectedAgentId: null,
      statuses: [],
    });
  });

  it('MUST write undefined when cycling to Inherit, not a string', () => {
    const instance = makeSettings('test', { logLevel: 'INFO' });
    const updateSpy = jest.spyOn(instance, 'updateSettings');

    instance.state.settings.logLevel = 'DEBUG';
    instance.cycleLogLevel();

    // This MUST be undefined, not 'INFO'
    expect(updateSpy).toHaveBeenCalledWith({ logLevel: undefined });
    expect(updateSpy).not.toHaveBeenCalledWith({ logLevel: 'INFO' });
  });
});
