import { registerNexusSettingsTools } from '../../../src/main/mcp/modules/nexus-settings';
import { STORAGE_KEYS } from '../../../src/common/constants';

function makeMemStore() {
  const data: Record<string, any> = {};
  let writes = 0;
  return {
    get: (k: string) => data[k],
    set: (k: string, v: any) => { data[k] = v; writes++; },
    writes: () => writes,
    settings: () => data[STORAGE_KEYS.SETTINGS],
  };
}

function getUpdateTool() {
  const handlers: Record<string, any> = {};
  registerNexusSettingsTools({ register: (h: any) => { handlers[h.definition.name] = h; } } as any);
  return handlers['nexus_update_settings'];
}

describe('nexus_update_settings MCP tool — permission keys are not settable (P0-2)', () => {
  it('refuses to flip remoteOperationPermissions.delete.production and writes nothing', async () => {
    const store = makeMemStore();
    const tool = getUpdateTool();
    const res = await tool.execute(
      { key: 'remoteOperationPermissions.delete.production', value: 'true' },
      { registryStorage: store },
    );
    expect(res.isError).toBe(true);
    expect(store.writes()).toBe(0);
  });

  it('refuses a permission-key patch and writes nothing', async () => {
    const store = makeMemStore();
    const tool = getUpdateTool();
    const res = await tool.execute(
      { patch: JSON.stringify({ wpeOperationPermissions: { delete: { production: true } } }) },
      { registryStorage: store },
    );
    expect(res.isError).toBe(true);
    expect(store.writes()).toBe(0);
  });

  it('refuses an unknown key (schema validation reaches the MCP surface)', async () => {
    const store = makeMemStore();
    const tool = getUpdateTool();
    const res = await tool.execute({ key: 'totallyBogusKey', value: 'x' }, { registryStorage: store });
    expect(res.isError).toBe(true);
    expect(store.writes()).toBe(0);
  });

  it('still applies a benign setting', async () => {
    const store = makeMemStore();
    const tool = getUpdateTool();
    const res = await tool.execute({ key: 'autoIndex', value: 'true' }, { registryStorage: store });
    expect(res.isError).toBeFalsy();
    expect(store.writes()).toBe(1);
    expect(store.settings().autoIndex).toBe(true);
  });
});
