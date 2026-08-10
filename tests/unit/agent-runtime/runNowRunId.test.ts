import { collectRunIds } from '../../../src/main/agent-runtime/runNowIds';
import * as path from 'path';

describe('collectRunIds', () => {
  it('returns the runner ids, in site order', () => {
    expect(collectRunIds([
      { site: 'a', result: { runId: 'r_1' } },
      { site: 'b', result: { runId: 'r_2' } },
    ] as any)).toEqual(['r_1', 'r_2']);
  });

  it('skips a run that produced no id rather than inserting a hole', () => {
    expect(collectRunIds([
      { site: 'a', result: { runId: 'r_1' } },
      { site: 'b', result: {} },
    ] as any)).toEqual(['r_1']);
  });

  it('is empty, not undefined, when nothing ran', () => {
    expect(collectRunIds([])).toEqual([]);
  });

  it('is resolvable from ipc-handlers.ts with the specifier that file actually uses', () => {
    // Read the actual require() call from the source
    const fs = require('fs');
    const ipcHandlersPath = path.resolve(__dirname, '../../../src/main/ipc-handlers.ts');
    const source = fs.readFileSync(ipcHandlersPath, 'utf-8');

    // Extract the specifier from: require('X') as typeof import('./agent-runtime/runNowIds')
    // The bug is in the require string, not the type assertion, so match the first group
    const match = source.match(/require\(['"]([^'"]+runNowIds)['"]\)/);

    // Fail if the pattern isn't found — a vanishing guard is a broken guard
    if (!match) {
      throw new Error('Could not find runNowIds require() in ipc-handlers.ts — test needs updating');
    }

    const specifier = match[1];
    const ipcHandlersDir = path.dirname(ipcHandlersPath);

    // Resolve the extracted specifier from ipc-handlers' directory
    // This will throw if the path is wrong (e.g., '../agent-runtime/runNowIds')
    expect(() => {
      require.resolve(path.join(ipcHandlersDir, specifier));
    }).not.toThrow();
  });
});
