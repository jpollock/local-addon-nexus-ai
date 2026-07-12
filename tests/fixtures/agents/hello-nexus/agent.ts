import { defineAgent, cron, on } from '../../../../src/main/agent-sdk';

export default defineAgent({
  name: 'hello-nexus',
  version: '1.0.0',
  description: 'Fixture agent for unit and integration tests',
  triggers: [cron('* * * * *')],
  tools: ['nexus_list_sites'],
  async run({ tools, state, log }) {
    const result = await tools.invoke('nexus_list_sites', {}) as any[];
    const count = Array.isArray(result) ? result.length : 0;
    log.info(`hello-nexus: found ${count} sites`);
    state.set('lastRunSiteCount', count);
    state.set('lastRunAt', Date.now());
  },
});

// Reactive variant — used in integration tests for event-driven execution
export const helloNexusReactive = defineAgent({
  name: 'hello-nexus-reactive',
  version: '1.0.0',
  triggers: [on('wp:post.published')],
  tools: ['nexus_list_sites'],
  async run({ event, state, log }) {
    log.info(`hello-nexus-reactive: received ${event?.key}`);
    state.set('lastEvent', event?.key);
  },
});
