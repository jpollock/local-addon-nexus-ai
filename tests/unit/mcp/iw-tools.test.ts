import {
  iwGetConnectionStatusHandler,
  iwConnectSiteHandler,
  iwDisconnectSiteHandler,
} from '../../../src/main/mcp/modules/iw/iw-tools';

describe('IW MCP tool definitions', () => {
  it('iw_get_connection_status — name and required field', () => {
    expect(iwGetConnectionStatusHandler.definition.name).toBe('iw_get_connection_status');
    expect(iwGetConnectionStatusHandler.definition.inputSchema.required).toContain('site');
  });

  it('iw_connect_site — name and required field', () => {
    expect(iwConnectSiteHandler.definition.name).toBe('iw_connect_site');
    expect(iwConnectSiteHandler.definition.inputSchema.required).toContain('site');
  });

  it('iw_disconnect_site — name and required field', () => {
    expect(iwDisconnectSiteHandler.definition.name).toBe('iw_disconnect_site');
    expect(iwDisconnectSiteHandler.definition.inputSchema.required).toContain('site');
  });
});
