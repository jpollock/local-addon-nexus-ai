import type { AgentEventBus } from '../AgentEventBus';

interface Hooks {
  addAction(hook: string, callback: (...args: any[]) => void | Promise<void>): void;
}

interface LocalSiteRef {
  id: string;
  name: string;
}

export function registerLocalLifecycleBridge(bus: AgentEventBus, hooks: Hooks): void {
  hooks.addAction('siteStarted', (site: LocalSiteRef) => {
    bus.publish({
      namespace: 'local',
      type: 'site.started',
      key: 'local:site.started',
      siteId: site.id,
      payload: { siteName: site.name },
      createdAt: Date.now(),
    });
  });

  hooks.addAction('siteStopped', (site: LocalSiteRef) => {
    bus.publish({
      namespace: 'local',
      type: 'site.stopped',
      key: 'local:site.stopped',
      siteId: site.id,
      payload: { siteName: site.name },
      createdAt: Date.now(),
    });
  });

  hooks.addAction('siteRemoved', (site: LocalSiteRef) => {
    bus.publish({
      namespace: 'local',
      type: 'site.removed',
      key: 'local:site.removed',
      siteId: site.id,
      payload: { siteName: site.name },
      createdAt: Date.now(),
    });
  });
}
