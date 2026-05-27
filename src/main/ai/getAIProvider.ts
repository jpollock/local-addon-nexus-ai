/**
 * getAIProvider — centralized AI provider resolution.
 *
 * Single source of truth for reading provider, model, and API key from
 * settings + KeyVault. Every AI call site that previously did this inline
 * was susceptible to the "encrypted key in raw blob" bug — this fixes it
 * for all callers at once.
 */
import type { NexusSettings } from '../../common/types';
import type { RegistryStorage } from '../content/IndexRegistry';
import { getApiKey } from '../security/KeyVault';

const DEFAULT_MODELS: Record<string, string> = {
  anthropic: 'claude-haiku-4-5-20251001',
  openai:    'gpt-4o-mini',
  google:    'gemini-1.5-flash',
  ollama:    'llama3.2',
};

export interface ResolvedAIProvider {
  /** Provider ID, e.g. 'anthropic' | 'openai' | 'google' | 'ollama' */
  provider: string;
  /** Model ID to use */
  model: string;
  /** Decrypted API key — empty string for Ollama or gateway */
  apiKey: string;
  /** True when the Local AI Gateway is active (no WP-DB key sync needed) */
  useLocalGateway: boolean;
  /**
   * True when the provider can actually make calls:
   *   - Ollama: always true (no key needed)
   *   - local-gateway: always true (gateway handles auth)
   *   - everything else: true only when apiKey is non-empty
   */
  isAvailable: boolean;
}

/**
 * Resolve the active AI provider from settings + KeyVault.
 *
 * @param storage   RegistryStorage instance (Local's userData wrapper).
 * @param settings  NexusSettings object — pass null if not yet loaded.
 */
export function getAIProvider(
  storage: RegistryStorage,
  settings: NexusSettings | null | undefined,
): ResolvedAIProvider {
  const provider      = settings?.aiProvider || 'anthropic';
  const model         = settings?.aiModel    || DEFAULT_MODELS[provider] || 'llama3.2';
  const useLocalGateway = settings?.useLocalGateway ?? false;
  const apiKey        = getApiKey(storage, provider) ?? '';

  const noKeyNeeded   = provider === 'ollama' || useLocalGateway;
  const isAvailable   = noKeyNeeded || apiKey.length > 0;

  return { provider, model, apiKey, useLocalGateway, isAvailable };
}
