import { McpToolHandler, McpToolResult } from '../../types';
import { STORAGE_KEYS } from '../../../../common/constants';
import { KeyVault } from '../../../security/KeyVault';

/**
 * Test-only tool to configure API keys in registry storage.
 * Used by E2E tests to set up API keys before calling wp_setup_ai.
 */
export const configureApiKeysHandler: McpToolHandler = {
  definition: {
    name: 'test_configure_api_keys',
    description:
      'Configure AI provider API keys in Local storage for testing. ' +
      'This is a test-only tool used by E2E tests to simulate API keys being configured in Preferences. ' +
      'Sets the same storage keys that the UI uses when saving API keys.',
    inputSchema: {
      type: 'object',
      properties: {
        anthropic: {
          type: 'string',
          description: 'Anthropic (Claude) API key',
        },
        openai: {
          type: 'string',
          description: 'OpenAI API key',
        },
        google: {
          type: 'string',
          description: 'Google (Gemini) API key',
        },
      },
    },
    isAvailable: (services) => process.env.NEXUS_E2E_MODE === '1' && !!services.registryStorage,
  },

  async execute(args, services): Promise<McpToolResult> {
    const { registryStorage } = services;
    if (!registryStorage) {
      return {
        content: [{ type: 'text', text: 'Error: Registry storage not available' }],
        isError: true,
      };
    }

    // Store keys via KeyVault for encryption at rest
    const keyVault = new KeyVault(registryStorage, STORAGE_KEYS.API_KEYS);
    const updates: Record<string, string> = {};
    let updateCount = 0;

    if (args.anthropic && typeof args.anthropic === 'string') {
      keyVault.setKey('anthropic', args.anthropic);
      updates.anthropic = args.anthropic;
      updateCount++;
    }

    if (args.openai && typeof args.openai === 'string') {
      keyVault.setKey('openai', args.openai);
      updates.openai = args.openai;
      updateCount++;
    }

    if (args.google && typeof args.google === 'string') {
      keyVault.setKey('google', args.google);
      updates.google = args.google;
      updateCount++;
    }

    // Build response
    const lines: string[] = [];
    lines.push(`Configured ${updateCount} API key(s) in Local storage:`);

    if (updates.anthropic) {
      const masked = updates.anthropic.substring(0, 8) + '...' + updates.anthropic.slice(-4);
      lines.push(`  anthropic: ${masked}`);
    }
    if (updates.openai) {
      const masked = updates.openai.substring(0, 8) + '...' + updates.openai.slice(-4);
      lines.push(`  openai: ${masked}`);
    }
    if (updates.google) {
      const masked = updates.google.substring(0, 8) + '...' + updates.google.slice(-4);
      lines.push(`  google: ${masked}`);
    }

    lines.push('');
    lines.push('These keys will be used by wp_setup_ai and wp_sync_ai_credentials.');

    return {
      content: [{ type: 'text', text: lines.join('\n') }],
    };
  },
};
