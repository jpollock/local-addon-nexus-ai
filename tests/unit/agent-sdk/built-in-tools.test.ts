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
    // registerTestTools is E2E-only and deliberately not part of the generator's import set.
    expect(BUILT_IN_TOOL_NAMES).not.toContain('nexus_e2e_probe' as BuiltInTool);
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
});
