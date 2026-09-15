import * as fs from 'fs';
import * as path from 'path';

import { BUILT_IN_TOOL_NAMES, BuiltInTool } from '../../../src/main/agent-sdk/built-in-tools';
import {
  collectBuiltInToolNames,
  renderBuiltInToolsModule,
} from '../../../scripts/generate-built-in-tools';

const GENERATED_FILE = path.resolve(
  __dirname, '..', '..', '..', 'src', 'main', 'agent-sdk', 'built-in-tools.ts',
);

describe('built-in-tools (GH-50)', () => {
  it('union is non-empty and every name is a lowercase snake_case identifier', () => {
    expect(BUILT_IN_TOOL_NAMES.length).toBeGreaterThan(0);
    for (const name of BUILT_IN_TOOL_NAMES) {
      expect(name).toMatch(/^[a-z0-9_]+$/);
    }
  });

  it('contains the canonical tools agents declare', () => {
    for (const expected of ['local_list_sites', 'fleet_sql', 'wp_eval', 'search_tools']) {
      expect(BUILT_IN_TOOL_NAMES).toContain(expected as BuiltInTool);
    }
  });

  it('does not contain E2E test tools', () => {
    // registerTestTools is E2E-only (NEXUS_E2E_MODE=1) and deliberately not part of the
    // generator's import set. These are REAL names registered by src/main/mcp/modules/test-tools/.
    expect(BUILT_IN_TOOL_NAMES).not.toContain('test_configure_api_keys' as BuiltInTool);
    expect(BUILT_IN_TOOL_NAMES.some((n) => n.startsWith('test_'))).toBe(false);
  });

  it('generator output is deterministic and matches the committed file', () => {
    const names = collectBuiltInToolNames();
    expect(names).toHaveLength(BUILT_IN_TOOL_NAMES.length);
    expect(renderBuiltInToolsModule(names)).toBe(fs.readFileSync(GENERATED_FILE, 'utf8'));
  });

  it('BuiltInTool accepts built-in names at the type level (compile-time contract)', () => {
    // This is a type assertion: if BuiltInTool stopped covering these literals, tsc fails.
    const sample: BuiltInTool = 'local_list_sites';
    expect(sample).toBe('local_list_sites');
  });

  it('AgentDefinition.tools accepts arbitrary contributed-tool strings (compile-time contract)', () => {
    // (string & {}) arm: an agent calling a contributed tool from another agent must compile
    // even though no BuiltInTool literal names it. Verified via AgentRunner's own interface.
    const def: import('../../../src/main/agent-sdk/types').AgentDefinition = {
      name: 'type-probe', version: '0.0.0', triggers: [],
      tools: ['get_log_aggregates', 'local_list_sites'],
      run: async () => {},
    };
    expect(def.tools).toContain('get_log_aggregates');
  });

  it('generator covers EVERY registration call in src/main/index.ts (startup parity)', () => {
    // F1 guard: index.ts is the startup truth; the generator mirrors it manually. If someone
    // adds a registerXTools(registry) call or a direct registry.register(...) to index.ts
    // without teaching the generator, THIS fails — the drift becomes a red test, not an
    // invisible stale union.
    const fsMod = require('fs') as typeof import('fs');
    const repoRoot = path.resolve(__dirname, '..', '..', '..');
    const indexSrc = fsMod.readFileSync(path.join(repoRoot, 'src', 'main', 'index.ts'), 'utf8');
    const genSrc = fsMod.readFileSync(path.join(repoRoot, 'scripts', 'generate-built-in-tools.ts'), 'utf8');

    const moduleCalls = [...indexSrc.matchAll(/register(\w+)Tools\(registry\)/g)].map((m) => `register${m[1]}Tools`);
    const directCalls = [...indexSrc.matchAll(/registry\.register\((\w+)/g)].map((m) => m[1]);
    expect(moduleCalls.length).toBeGreaterThan(0);

    for (const fn of [...moduleCalls, ...directCalls]) {
      expect(genSrc).toContain(fn);
    }
  });
});
