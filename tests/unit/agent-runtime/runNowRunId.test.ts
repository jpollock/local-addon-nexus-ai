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

  it('is resolvable from ipc-handlers.ts via ./agent-runtime/runNowIds', () => {
    // ipc-handlers.ts lives at src/main/ipc-handlers.ts
    const ipcHandlersDir = path.resolve(__dirname, '../../../src/main');
    const specifier = './agent-runtime/runNowIds';

    // Verify the path resolves correctly from ipc-handlers' directory
    expect(() => {
      require.resolve(path.join(ipcHandlersDir, specifier));
    }).not.toThrow();
  });
});
