import { McpToolHandler } from '../../types';
import { ok, error, capiError, requireCAPI } from './helpers';

export const promoteEnvironmentHandler: McpToolHandler = {
  definition: {
    name: 'wpe_promote_environment',
    description:
      'Tier 3 (destructive) — copy one WP Engine install to another (typically staging → production). Overwrites the destination install completely — ensure a recent backup exists via wpe_backup_and_verify. Run wpe_environment_diff beforehand to confirm staging is ready. Requires confirmation token. After promoting, purge the cache on the destination with wpe_purge_cache and verify with wpe_diagnose_site.' +
      'Tier 3 — requires confirmation. ' +
      'Always verify the destination has a recent backup before promoting.',
    inputSchema: {
      type: 'object',
      properties: {
        source_install_id: {
          type: 'string',
          description: 'ID of the install to copy from (source). Maps to source_environment_id in CAPI.',
        },
        destination_install_id: {
          type: 'string',
          description: 'ID of the install to copy to (destination). Maps to destination_environment_id in CAPI.',
        },
        include_database: {
          type: 'boolean',
          description: 'Whether to copy the database. Default: true',
        },
        _confirmationToken: {
          type: 'string',
          description: 'Confirmation token returned by the first call (Tier 3 safety flow). Pass the token exactly as returned.',
        },
      },
      required: ['source_install_id', 'destination_install_id'],
    },
    isAvailable: (services) => requireCAPI(services),
  },

  async execute(args, services) {
    const sourceId = args.source_install_id as string;
    const destId = args.destination_install_id as string;
    const includeDatabase = args.include_database !== false;

    // Proceed with the copy (confirmation handled by McpSafetyWrapper Tier 3 flow)
    try {
      // Swagger: source_environment_id / destination_environment_id (not install_id)
      // include_db goes inside custom_options, not at top level
      const result = await services.localServices!.capiDirect('/install_copy', 'POST', {
        source_environment_id: sourceId,
        destination_environment_id: destId,
        custom_options: { include_files: true, include_db: includeDatabase },
      }) as any;

      const lines = [
        '## Environment Copy Started',
        '',
        `Copy from \`${sourceId}\` → \`${destId}\` has been initiated.`,
        '',
        `- **Include database:** ${includeDatabase ? 'yes' : 'no'}`,
        result?.id ? `- **Operation ID:** ${result.id}` : '',
        result?.status ? `- **Status:** ${result.status}` : '',
        '',
        'The copy typically takes several minutes. Check the WP Engine portal for progress.',
      ].filter((l) => l !== '');

      return ok(lines.join('\n'));
    } catch (err: any) {
      return capiError(err);
    }
  },
};
