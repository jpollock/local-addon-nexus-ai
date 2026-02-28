import { ToolRegistry } from '../../tool-registry';
import { askOllamaHandler, refreshOllamaStatus } from './ask-ollama';
import { listOllamaModelsHandler } from './list-models';

/**
 * Ollama module — local LLM detect-and-integrate.
 * Tools are gated by isAvailable — they only appear when Ollama is running.
 */
export function registerOllamaTools(registry: ToolRegistry): void {
  registry.register(askOllamaHandler);
  registry.register(listOllamaModelsHandler);
}

export { refreshOllamaStatus };
