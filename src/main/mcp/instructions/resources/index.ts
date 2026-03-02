import * as fs from 'fs';
import * as path from 'path';
import { InstructionRegistry } from '../index';

interface ResourceDef {
  uri: string;
  name: string;
  description: string;
  file: string;
}

const RESOURCES: ResourceDef[] = [
  {
    uri: 'nexus://guide/getting-started',
    name: 'Getting Started',
    description: 'Tool overview, discovery-first principle, and module guide',
    file: 'getting-started.md',
  },
  {
    uri: 'nexus://guide/safety',
    name: 'Safety System',
    description: '3-tier safety system, confirmation tokens, and audit logging',
    file: 'safety-guide.md',
  },
  {
    uri: 'nexus://guide/remote-wp-cli',
    name: 'Remote WP-CLI',
    description: 'Local vs remote execution, SSH setup, and blocked commands',
    file: 'remote-wp-cli.md',
  },
  {
    uri: 'nexus://guide/workflows/site-setup',
    name: 'Workflow: Site Setup',
    description: 'Step-by-step guide for creating a new local WordPress site',
    file: 'workflows/site-setup.md',
  },
  {
    uri: 'nexus://guide/workflows/wpe-sync',
    name: 'Workflow: WPE Sync',
    description: 'Push and pull between local sites and WP Engine environments',
    file: 'workflows/wpe-sync.md',
  },
  {
    uri: 'nexus://guide/workflows/content-search',
    name: 'Workflow: Content Search',
    description: 'Index WordPress content and search with natural language queries',
    file: 'workflows/content-search.md',
  },
];

export function registerResources(registry: InstructionRegistry): void {
  const resourceDir = __dirname;

  for (const def of RESOURCES) {
    const filePath = path.join(resourceDir, def.file);

    registry.registerResource({
      uri: def.uri,
      name: def.name,
      description: def.description,
      mimeType: 'text/markdown',
      read: async () => {
        const text = fs.readFileSync(filePath, 'utf-8');
        return { text, mimeType: 'text/markdown' };
      },
    });
  }
}
