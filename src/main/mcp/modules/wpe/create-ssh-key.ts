import { McpToolHandler, McpToolResult } from '../../types';
import { ok, capiError, requireCAPI } from './helpers';

export const createSshKeyHandler: McpToolHandler = {
  definition: {
    name: 'wpe_create_ssh_key',
    description: 'Add an SSH public key to the authenticated WP Engine account for SSH/SFTP access to environments.',
    inputSchema: {
      type: 'object',
      properties: {
        label: { type: 'string', description: 'Descriptive label for this key (e.g. "Laptop", "CI/CD")' },
        public_key: { type: 'string', description: 'SSH public key content (starts with "ssh-rsa", "ssh-ed25519", etc.)' },
      },
      required: ['label', 'public_key'],
    },
    isAvailable: (services) => requireCAPI(services),
  },

  async execute(args, services): Promise<McpToolResult> {
    try {
      const result = await services.localServices!.capiDirect(
        '/ssh_keys',
        'POST',
        { label: args.label, public_key: args.public_key },
      ) as any;

      return ok(
        `## SSH Key Added\n\n` +
        `- **Label:** ${result.label ?? args.label}\n` +
        `- **ID:** ${result.id ?? '-'}\n` +
        `- **Fingerprint:** ${result.fingerprint ?? '-'}`,
      );
    } catch (err: any) {
      return capiError(err);
    }
  },
};
