import { AgentRunModal } from '../../../src/renderer/components/agents/AgentRunModal';
import { AgentWorkspaceSettings } from '../../../src/renderer/components/agents/AgentWorkspaceSettings';

const findByType = (node: any, name: string): any[] => {
  if (!node || typeof node !== 'object') return [];
  const hits = node.type && (node.type.name === name || node.type === name) ? [node] : [];
  const kids = node.props?.children;
  const arr = Array.isArray(kids) ? kids : kids ? [kids] : [];
  return arr.reduce((acc: any[], k: any) => acc.concat(findByType(k, name)), hits);
};

describe('siteScoped hides the picker', () => {
  describe('AgentRunModal', () => {
    it('renders no SitePicker for a non-scoped agent', () => {
      const el = new (AgentRunModal as any)({
        agentName: 'auth-probe', agentId: 'auth-probe', electron: {},
        supportsFullRun: false, allowsProduction: true, effect: 'readonly',
        siteScoped: false, onCancel: () => {}, onRun: () => {},
      });
      el.state = { ...el.state, loading: false, sites: [], selection: new Set() };
      expect(findByType(el.render(), 'SitePicker')).toHaveLength(0);
    });

    it('still renders a SitePicker for a scoped agent', () => {
      const el = new (AgentRunModal as any)({
        agentName: 'security-sentinel', agentId: 'security-sentinel', electron: {},
        supportsFullRun: false, allowsProduction: true, effect: 'writes',
        siteScoped: true, onCancel: () => {}, onRun: () => {},
      });
      el.state = { ...el.state, loading: false, sites: [], selection: new Set() };
      expect(findByType(el.render(), 'SitePicker').length).toBeGreaterThan(0);
    });
  });

  describe('AgentWorkspaceSettings', () => {
    it('renders neither eyebrow nor SitePicker for a non-scoped agent', () => {
      const el = new (AgentWorkspaceSettings as any)({
        agentId: 'auth-probe',
        siteScoped: false,
      });
      el.state = {
        ...el.state,
        settings: { scheduleEnabled: true, eventsEnabled: false, subscribedEvents: {} },
        scopeLoading: false,
        scopeSites: [],
      };
      const rendered = el.render();
      const text = JSON.stringify(rendered);
      expect(text).not.toContain('SITES IN SCOPE');
      expect(findByType(rendered, 'SitePicker')).toHaveLength(0);
    });

    it('renders both eyebrow and SitePicker for a scoped agent', () => {
      const el = new (AgentWorkspaceSettings as any)({
        agentId: 'security-sentinel',
        siteScoped: true,
        scopeLivesInSitesTab: false,
      });
      el.state = {
        ...el.state,
        settings: { scheduleEnabled: true, eventsEnabled: false, subscribedEvents: {} },
        scopeLoading: false,
        scopeSites: [],
        scopeExpanded: true,
        scopeDraftSelection: new Set(),
      };
      const rendered = el.render();
      const text = JSON.stringify(rendered);
      expect(text).toContain('SITES IN SCOPE');
      expect(findByType(rendered, 'SitePicker').length).toBeGreaterThan(0);
    });
  });
});
