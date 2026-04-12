import { McpToolHandler, McpToolResult } from '../../types';
import { ok, capiError, requireCAPI } from './helpers';

export const importSslCertificateHandler: McpToolHandler = {
  definition: {
    name: 'wpe_import_ssl_certificate',
    description: 'Import a custom SSL certificate (e.g. extended validation or wildcard cert) for a WP Engine install. Accepts PEM-encoded certificate chain and private key. Use when you need a specific CA or certificate type that Lets Encrypt cannot provide. For standard HTTPS, use wpe_request_ssl_certificate (free, automatic) instead.',
    inputSchema: {
      type: 'object',
      properties: {
        install_id: { type: 'string', description: 'WP Engine install ID' },
        certificate: { type: 'string', description: 'PEM-encoded certificate' },
        private_key: { type: 'string', description: 'PEM-encoded private key' },
        ca_bundle: { type: 'string', description: 'PEM-encoded CA bundle (intermediate certificates)' },
      },
      required: ['install_id', 'certificate', 'private_key'],
    },
    isAvailable: (services) => requireCAPI(services),
  },

  async execute(args, services): Promise<McpToolResult> {
    try {
      const body: Record<string, unknown> = {
        certificate: args.certificate,
        private_key: args.private_key,
      };
      if (args.ca_bundle) {
        body.ca_bundle = args.ca_bundle;
      }

      await services.localServices!.capiDirect(
        `/installs/${args.install_id}/ssl_certificates/import`,
        'POST',
        body,
      ) as any;

      return ok(
        `## SSL Certificate Imported\n\n` +
        `Custom SSL certificate has been successfully imported for install \`${args.install_id}\`. ` +
        `Use \`wpe_get_ssl_certificates\` to confirm the certificate is active.`,
      );
    } catch (err: any) {
      return capiError(err);
    }
  },
};
