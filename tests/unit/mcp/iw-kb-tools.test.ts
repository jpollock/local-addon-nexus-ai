import {
  iwListKbCollectionsHandler,
  iwGetKbCollectionHandler,
  iwSearchKbHandler,
} from '../../../src/main/mcp/modules/iw/kb-tools';

describe('IW KB MCP tool definitions', () => {
  it('iw_list_kb_collections — name and required fields', () => {
    expect(iwListKbCollectionsHandler.definition.name).toBe('iw_list_kb_collections');
    expect(iwListKbCollectionsHandler.definition.inputSchema.required).toContain('site');
  });

  it('iw_get_kb_collection — name and required fields', () => {
    expect(iwGetKbCollectionHandler.definition.name).toBe('iw_get_kb_collection');
    expect(iwGetKbCollectionHandler.definition.inputSchema.required).toContain('site');
    expect(iwGetKbCollectionHandler.definition.inputSchema.required).toContain('collection_id');
  });

  it('iw_search_kb — name and required fields', () => {
    expect(iwSearchKbHandler.definition.name).toBe('iw_search_kb');
    expect(iwSearchKbHandler.definition.inputSchema.required).toContain('site');
    expect(iwSearchKbHandler.definition.inputSchema.required).toContain('collection_id');
    expect(iwSearchKbHandler.definition.inputSchema.required).toContain('query');
  });
});
