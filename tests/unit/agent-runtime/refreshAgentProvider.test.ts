import * as fs from 'fs';
import * as path from 'path';
import { STORAGE_KEYS } from '../../../src/common/constants';
import { refreshAgentProvider } from '../../../src/main/agent-runtime/refreshAgentProvider';

const INDEX_PATH = path.resolve(__dirname, '../../../src/main/index.ts');

describe('refreshAgentProvider', () => {
  it.each([true, false])(
    're-resolves current settings and updates both agent consumers when paused is %s',
    (backgroundWorkPaused) => {
      const settings = { aiProvider: 'ollama', aiModel: 'qwen3', backgroundWorkPaused };
      const storage = {
        get: jest.fn((key: string) => key === STORAGE_KEYS.SETTINGS ? settings : undefined),
        set: jest.fn(),
      };
      const agentRunner = { setProvider: jest.fn() };
      const dispatcher = { setProvider: jest.fn() };

      refreshAgentProvider(storage, { agentRunner, dispatcher });

      expect(agentRunner.setProvider).toHaveBeenCalledTimes(1);
      expect(dispatcher.setProvider).toHaveBeenCalledTimes(1);
      const provider = agentRunner.setProvider.mock.calls[0][0];
      expect(provider).toMatchObject({ provider: 'ollama', model: 'qwen3' });
      expect(dispatcher.setProvider).toHaveBeenCalledWith(provider);
    },
  );

  it('runs before the pause return and exactly once per settings update', () => {
    const indexSource = fs.readFileSync(INDEX_PATH, 'utf8');
    const start = indexSource.indexOf('const onSettingsUpdated = () => {');
    const end = indexSource.indexOf('nexusServices.onSettingsUpdated = onSettingsUpdated', start);
    const body = indexSource.substring(start, end);

    const refreshCall = 'refreshAgentProvider(registryStorage, nexusServices)';
    const refreshCalls = body.match(/refreshAgentProvider\(registryStorage, nexusServices\)/g) ?? [];
    expect(refreshCalls).toHaveLength(1);
    expect(body.indexOf(refreshCall)).toBeLessThan(body.indexOf('if (paused)'));
  });
});
