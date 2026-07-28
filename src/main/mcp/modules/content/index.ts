import { ToolRegistry } from '../../tool-registry';
import { searchContentHandler } from './search-content';
import { searchAcrossSitesHandler } from './search-across-sites';
import { getAllDocumentsHandler } from './get-all-documents';
import { describeSiteFieldsHandler } from './describe-site-fields';

/**
 * Content module — vector-based semantic search tools.
 * Always available (no prerequisites beyond the embedding model being loaded).
 */
export function registerContentTools(registry: ToolRegistry): void {
  registry.register(searchContentHandler);
  registry.register(searchAcrossSitesHandler);
  registry.register(getAllDocumentsHandler);
  registry.register(describeSiteFieldsHandler);
}
