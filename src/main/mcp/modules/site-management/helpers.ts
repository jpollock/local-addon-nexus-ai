import { McpToolResult, NexusServices } from '../../types';

export function ok(text: string): McpToolResult {
  return { content: [{ type: 'text', text }] };
}

export function error(text: string): McpToolResult {
  return { content: [{ type: 'text', text }], isError: true };
}

export function requireLocalServices(services: NexusServices): boolean {
  return !!services.localServices;
}
