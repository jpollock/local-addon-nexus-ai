import { STORAGE_KEYS } from '../../common/constants';
import type { NexusSettings } from '../../common/types';
import { getAIProvider, type ResolvedAIProvider } from '../ai/getAIProvider';
import type { RegistryStorage } from '../content/IndexRegistry';

interface AgentProviderConsumer {
  setProvider(provider: ResolvedAIProvider): void;
}

interface AgentProviderConsumers {
  agentRunner?: AgentProviderConsumer;
  dispatcher?: AgentProviderConsumer;
}

/** Re-resolve the configured provider and update both agent execution paths. */
export function refreshAgentProvider(
  storage: RegistryStorage,
  consumers: AgentProviderConsumers,
): void {
  if (!consumers.agentRunner && !consumers.dispatcher) return;

  const settings = storage.get(STORAGE_KEYS.SETTINGS) as NexusSettings | null;
  const provider = getAIProvider(storage, settings);
  consumers.agentRunner?.setProvider(provider);
  consumers.dispatcher?.setProvider(provider);
}
