import { ToolRegistry } from '../../tool-registry';
import { scanSiteFilesHandler } from './scan-files-handler';

export { scanSiteFilesHandler } from './scan-files-handler';

export function registerSentinelScanTools(registry: ToolRegistry): void {
  registry.register(scanSiteFilesHandler);
}
