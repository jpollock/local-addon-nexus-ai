/**
 * P2 · the discovery invariant (docs/planning/2026-08-26-chat-harness-plan.md).
 *
 * The 2026-08-25 incident: the chat model denied capabilities it had, because
 * tools were withheld SILENTLY — the prompt named tools not in the payload,
 * and the discovery tool itself was droppable. Three rules close it, each
 * pinned here:
 *   (a) search_tools survives any toolset assembly and rides at the front —
 *       matching Anthropic's own API rule (a request with every tool deferred
 *       is a 400) and Walt's shipped "never invent names, go look" doctrine.
 *   (b) the prompt's fleet-tools list is GENERATED from the payload — a tool
 *       named in the prompt but absent from the array is the confabulation
 *       mechanism, and it cannot be hand-maintained honestly.
 *   (c) when tools are withheld, the model is told, with a count and the
 *       search_tools escape hatch.
 */
import { adaptToolsForChat } from '../../../src/main/chat/tool-adapter';
import { ChatService } from '../../../src/main/chat/ChatService';

function makeRegistry(names: string[]) {
  return {
    list: () => names.map((name) => ({
      name,
      description: 'd',
      inputSchema: { type: 'object', properties: {} },
      isAvailable: () => true,
    })),
  } as any;
}

// ── (a) search_tools is un-droppable ────────────────────────────────────────

describe('adaptToolsForChat · search_tools invariant', () => {
  it('hoists search_tools to the front of the toolset', () => {
    const tools = adaptToolsForChat(makeRegistry(['alpha', 'beta', 'search_tools', 'gamma']), {} as any);
    expect(tools[0].name).toBe('search_tools');
    expect(tools.map((t) => t.name).sort()).toEqual(['alpha', 'beta', 'gamma', 'search_tools']);
  });

  it('re-includes search_tools when a grants list would drop it', () => {
    const tools = adaptToolsForChat(
      makeRegistry(['alpha', 'beta', 'search_tools']),
      {} as any,
      ['alpha'], // grants that forgot the discovery tool
    );
    expect(tools.map((t) => t.name)).toEqual(['search_tools', 'alpha']);
  });

  it('does not invent search_tools when the registry has none', () => {
    const tools = adaptToolsForChat(makeRegistry(['alpha']), {} as any);
    expect(tools.map((t) => t.name)).toEqual(['alpha']);
  });
});

// ── (b) + (c) — the prompt is honest about the payload ──────────────────────

function makeService(registryNames: string[]) {
  return new (ChatService as any)({
    registry: makeRegistry(registryNames),
    services: {},
    sendToRenderer: jest.fn(),
  });
}

const ALL_FLEET = [
  'fleet_health_summary', 'get_site_health', 'fleet_search', 'fleet_filter',
  'bulk_reindex', 'bulk_plugin_update', 'list_site_groups', 'manage_site_group',
];

describe('buildSystemPrompt · generated from the payload', () => {
  // RESIDUAL, recorded not hidden: prose sections (content-search guidance)
  // still reference fleet_search / search_across_sites / describe_site_fields
  // unconditionally — the fleet BLOCK is generated, the prose is not yet.
  // Full prompt generation from the payload is the complete fix (charter P2b);
  // this test therefore targets a tool only the generated block names.
  it('lists a fleet tool only when the payload carries it', async () => {
    const svc = makeService(ALL_FLEET);
    const present = new Set(ALL_FLEET.filter((n) => n !== 'manage_site_group'));
    const prompt = await (svc as any).buildSystemPrompt(undefined, null, { toolNames: present });
    expect(prompt).toContain('fleet_health_summary');
    expect(prompt).not.toContain('manage_site_group');
  });

  it('gates the bulk_reindex prose line on its presence', async () => {
    const svc = makeService(ALL_FLEET);
    const without = await (svc as any).buildSystemPrompt(undefined, null, {
      toolNames: new Set(ALL_FLEET.filter((n) => n !== 'bulk_reindex')),
    });
    expect(without).not.toContain('When asked to reindex sites');
    const withIt = await (svc as any).buildSystemPrompt(undefined, null, {
      toolNames: new Set(ALL_FLEET),
    });
    expect(withIt).toContain('When asked to reindex sites');
  });

  it('omits the fleet section entirely when none of its tools are present', async () => {
    const svc = makeService(['alpha']);
    const prompt = await (svc as any).buildSystemPrompt(undefined, null, { toolNames: new Set(['alpha']) });
    expect(prompt).not.toContain('Fleet management tools');
  });

  it('every fleet tool the prompt names exists in the payload — the generative pin', async () => {
    const svc = makeService(ALL_FLEET);
    const present = new Set(['fleet_health_summary', 'bulk_reindex']);
    const prompt = await (svc as any).buildSystemPrompt(undefined, null, { toolNames: present });
    const listed = [...prompt.matchAll(/^- ([a-z_0-9]+):/gm)].map((m) => m[1]);
    for (const name of listed) expect(present.has(name)).toBe(true);
  });

  it('keeps the full fleet list when no toolNames are supplied — pre-P2 behaviour', async () => {
    const svc = makeService(ALL_FLEET);
    const prompt = await (svc as any).buildSystemPrompt(undefined, null);
    for (const n of ALL_FLEET) expect(prompt).toContain(n);
  });
});

describe('buildSystemPrompt · withheld-tools disclosure', () => {
  it('names the count and the escape hatch when tools were withheld', async () => {
    const svc = makeService(['alpha']);
    const prompt = await (svc as any).buildSystemPrompt(undefined, null, {
      toolNames: new Set(['alpha']), withheldCount: 79,
    });
    expect(prompt).toMatch(/79 tools were not included/);
    expect(prompt).toMatch(/call search_tools before concluding a capability is unavailable/i);
  });

  it('says nothing when nothing was withheld', async () => {
    const svc = makeService(['alpha']);
    const prompt = await (svc as any).buildSystemPrompt(undefined, null, {
      toolNames: new Set(['alpha']), withheldCount: 0,
    });
    expect(prompt).not.toMatch(/not included this turn/);
  });
});
