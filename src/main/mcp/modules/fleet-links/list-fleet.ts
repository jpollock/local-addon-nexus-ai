import type { McpToolHandler } from '../../types';

export const listFleetHandler: McpToolHandler = {
  definition: {
    name: 'nexus_fleet_list',
    description:
      'List the whole fleet — WP Engine installs grouped by site, each with its environment, ' +
      'any attached local sandbox, and the provenance (level and age) of the data behind it. ' +
      'Use this before acting on a site so you know how current the information is.',
    inputSchema: { type: 'object', properties: {} },
    annotations: { readOnlyHint: true },
  },
  async execute(_args, services) {
    const assembler = (services as any).fleetAssembler;
    if (!assembler) {
      return {
        content: [{ type: 'text', text: 'Fleet assembler is not available — the graph database may still be initializing.' }],
        isError: true,
      };
    }
    const groups = await assembler.listFleet();
    return { content: [{ type: 'text', text: JSON.stringify(groups, null, 2) }] };
  },
};
