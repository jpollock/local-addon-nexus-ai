import {
  McpResource,
  McpResourceDefinition,
  McpResourceTemplate,
} from '../types';
import { INSTRUCTIONS } from './server-instructions';
import { registerResources } from './resources';

/**
 * Central registry for MCP instructions and resources.
 *
 * Instantiable without an MCP server — enables fast eval testing
 * of instruction content in isolation.
 */
export class InstructionRegistry {
  private instructions = '';
  private resources = new Map<string, McpResource>();
  private resourceTemplates = new Map<string, McpResourceTemplate>();

  // --- Instructions ---

  setInstructions(text: string): void {
    this.instructions = text;
  }

  getInstructions(): string {
    return this.instructions;
  }

  // --- Resources ---

  registerResource(resource: McpResource): void {
    this.resources.set(resource.uri, resource);
  }

  registerResourceTemplate(template: McpResourceTemplate): void {
    this.resourceTemplates.set(template.uriTemplate, template);
  }

  listResources(): McpResourceDefinition[] {
    return Array.from(this.resources.values()).map((r) => ({
      uri: r.uri,
      name: r.name,
      description: r.description,
      mimeType: r.mimeType,
    }));
  }

  listResourceTemplates(): Array<{ uriTemplate: string; name: string; description: string }> {
    return Array.from(this.resourceTemplates.values()).map((t) => ({
      uriTemplate: t.uriTemplate,
      name: t.name,
      description: t.description,
    }));
  }

  async readResource(uri: string): Promise<{ text: string; mimeType: string } | null> {
    // Try exact match first
    const resource = this.resources.get(uri);
    if (resource) return resource.read();

    // Try templates
    for (const template of this.resourceTemplates.values()) {
      if (this.matchesTemplate(uri, template.uriTemplate)) {
        return template.read(uri);
      }
    }

    return null;
  }

  private matchesTemplate(uri: string, uriTemplate: string): boolean {
    const regex = new RegExp(
      '^' + uriTemplate.replace(/\{[^}]+\}/g, '([^/]+)') + '$',
    );
    return regex.test(uri);
  }
}

/**
 * Register all instructions and resources.
 * Called once at startup from main/index.ts.
 * Pass registryStorage so dynamic resources (e.g. fleet state) can read live data.
 */
export function registerAllInstructions(
  registry: InstructionRegistry,
  registryStorage?: import('../../content/IndexRegistry').RegistryStorage,
): void {
  registry.setInstructions(INSTRUCTIONS);
  registerResources(registry, registryStorage);
}
