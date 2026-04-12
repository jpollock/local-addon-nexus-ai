import { McpToolHandler, McpToolResult } from '../../types';
import { ok, capiError, requireCAPI } from './helpers';

export const getLargeFsValidationHandler: McpToolHandler = {
  definition: {
    name: 'wpe_get_largefs_validation',
    description: 'Validate LargeFS (WPE offload storage) configuration for a WP Engine install. Returns any misconfigurations, missing permissions, or connection errors. Run after wpe_update_offload_settings to confirm the new settings work correctly. Resolve issues before enabling offload in production.',
    inputSchema: {
      type: 'object',
      properties: {
        install_id: { type: 'string', description: 'WP Engine install ID' },
      },
      required: ['install_id'],
    },
    isAvailable: (services) => requireCAPI(services),
  },

  async execute(args, services): Promise<McpToolResult> {
    try {
      const result = await services.localServices!.capiDirect(
        `/installs/${args.install_id}/offload/largefs/validate`,
      ) as any;

      const lines = [
        `## LargeFS Validation for Install \`${args.install_id}\``,
        '',
      ];

      const isValid = result.valid ?? result.is_valid;
      if (isValid !== undefined) {
        lines.push(`- **Valid:** ${isValid ? '✓ Yes' : '✗ No'}`);
        lines.push('');
      }

      const errors: any[] = result.errors ?? [];
      const warnings: any[] = result.warnings ?? [];

      if (errors.length > 0) {
        lines.push('### Errors');
        for (const e of errors) {
          lines.push(`- ❌ ${typeof e === 'string' ? e : e.message ?? JSON.stringify(e)}`);
        }
        lines.push('');
      }

      if (warnings.length > 0) {
        lines.push('### Warnings');
        for (const w of warnings) {
          lines.push(`- ⚠️ ${typeof w === 'string' ? w : w.message ?? JSON.stringify(w)}`);
        }
        lines.push('');
      }

      if (errors.length === 0 && warnings.length === 0 && isValid) {
        lines.push('LargeFS configuration is valid. No issues found.');
      }

      // Include any other top-level fields
      const skip = new Set(['valid', 'is_valid', 'errors', 'warnings']);
      for (const [key, value] of Object.entries(result)) {
        if (skip.has(key) || value === null || value === undefined) continue;
        const label = key.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
        lines.push(`- **${label}:** ${typeof value === 'object' ? JSON.stringify(value) : value}`);
      }

      return ok(lines.join('\n'));
    } catch (err: any) {
      return capiError(err);
    }
  },
};
