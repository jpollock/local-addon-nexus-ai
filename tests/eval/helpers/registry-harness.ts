import { InstructionRegistry, registerAllInstructions } from '../../../src/main/mcp/instructions';

/**
 * Boot an InstructionRegistry with all instructions, prompts, and resources.
 * No MCP server, no HTTP, no auth — pure unit-level access to content.
 */
export function createTestRegistry(): InstructionRegistry {
  const registry = new InstructionRegistry();
  registerAllInstructions(registry);
  return registry;
}
