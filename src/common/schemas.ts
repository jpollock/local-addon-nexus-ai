/**
 * Validation Schemas
 *
 * Zod schemas for validating IPC handler inputs and preventing injection attacks.
 */
import { z } from 'zod';

// ============================================================================
// Basic Types
// ============================================================================

export const SiteIdSchema = z.string().uuid('Invalid site ID format');

export const PluginSlugSchema = z
  .string()
  .regex(/^[a-z0-9-]+$/, 'Plugin slug must contain only lowercase letters, numbers, and hyphens')
  .min(1)
  .max(100);

export const ThemeSlugSchema = z
  .string()
  .regex(/^[a-z0-9-]+$/, 'Theme slug must contain only lowercase letters, numbers, and hyphens')
  .min(1)
  .max(100);

export const InstallNameSchema = z
  .string()
  .regex(
    /^[a-z0-9-]+$/,
    'Install name must contain only lowercase letters, numbers, and hyphens',
  )
  .min(1)
  .max(100);

export const ModelNameSchema = z
  .string()
  .regex(/^claude-[a-z0-9-]+$/, 'Invalid model name format')
  .min(1)
  .max(100);

export const AccountIdSchema = z.string().uuid('Invalid account ID format');

export const DomainSchema = z
  .string()
  .regex(
    /^[a-z0-9][a-z0-9-]*(\.[a-z0-9][a-z0-9-]*)*\.[a-z]{2,}$/i,
    'Invalid domain format',
  )
  .max(253);

// ============================================================================
// WordPress Management
// ============================================================================

export const WpPluginInstallSchema = z.object({
  site_id: SiteIdSchema.optional(),
  install_name: InstallNameSchema.optional(),
  slug: PluginSlugSchema,
}).refine(
  (data) => data.site_id || data.install_name,
  'Either site_id or install_name must be provided',
);

export const WpPluginActivateSchema = z.object({
  site_id: SiteIdSchema.optional(),
  install_name: InstallNameSchema.optional(),
  slug: PluginSlugSchema,
}).refine(
  (data) => data.site_id || data.install_name,
  'Either site_id or install_name must be provided',
);

export const WpPluginDeactivateSchema = z.object({
  site_id: SiteIdSchema.optional(),
  install_name: InstallNameSchema.optional(),
  slug: PluginSlugSchema,
}).refine(
  (data) => data.site_id || data.install_name,
  'Either site_id or install_name must be provided',
);

export const WpPluginListSchema = z.object({
  site_id: SiteIdSchema.optional(),
  install_name: InstallNameSchema.optional(),
}).refine(
  (data) => data.site_id || data.install_name,
  'Either site_id or install_name must be provided',
);

export const WpCoreVersionSchema = z.object({
  site_id: SiteIdSchema.optional(),
  install_name: InstallNameSchema.optional(),
}).refine(
  (data) => data.site_id || data.install_name,
  'Either site_id or install_name must be provided',
);

// ============================================================================
// Bulk Operations
// ============================================================================

export const BulkOperationSchema = z.object({
  siteIds: z.array(SiteIdSchema).min(1, 'At least one site ID required'),
  confirmProduction: z.boolean().optional(),
});

export const BulkSetupAISchema = BulkOperationSchema.extend({
  options: z
    .object({
      enableOllama: z.boolean().optional(),
      enableAcf: z.boolean().optional(),
      enableGateway: z.boolean().optional(),
    })
    .optional(),
});

// ============================================================================
// WPE CAPI Operations
// ============================================================================

export const WpeCreateInstallSchema = z.object({
  account_id: AccountIdSchema,
  site_id: z.string().uuid().optional(),
  name: z.string().min(1).max(100),
  environment: z.enum(['production', 'staging', 'development']),
});

export const WpeDeleteInstallSchema = z.object({
  install_id: z.string().uuid(),
  confirm_token: z.string().min(10),
});

export const WpeCopyInstallSchema = z.object({
  source_install_id: z.string().uuid(),
  dest_install_id: z.string().uuid(),
  confirm_token: z.string().min(10),
});

// ============================================================================
// AI Gateway
// ============================================================================

export const AIGatewayConfigSchema = z.object({
  enabled: z.boolean(),
  rateLimits: z
    .object({
      requestsPerHour: z.number().int().positive().optional(),
      requestsPerDay: z.number().int().positive().optional(),
      costPerDayUsd: z.number().positive().optional(),
    })
    .optional(),
});

// ============================================================================
// Content Indexing
// ============================================================================

export const IndexSiteSchema = z.object({
  siteId: SiteIdSchema,
  force: z.boolean().optional(),
});

export const SearchContentSchema = z.object({
  query: z.string().min(1),
  siteIds: z.array(SiteIdSchema).optional(),
  limit: z.number().int().positive().max(100).optional(),
});

// ============================================================================
// Site Groups
// ============================================================================

export const CreateSiteGroupSchema = z.object({
  name: z.string().min(1).max(100),
  description: z.string().max(500).optional(),
  filters: z.record(z.unknown()).optional(),
});

export const UpdateSiteGroupSchema = z.object({
  id: z.string().uuid(),
  name: z.string().min(1).max(100).optional(),
  description: z.string().max(500).optional(),
  filters: z.record(z.unknown()).optional(),
});

// ============================================================================
// Helper: Validate Input
// ============================================================================

/**
 * Validate input against a Zod schema.
 * Throws descriptive error if validation fails.
 */
export function validateInput<T>(schema: z.ZodSchema<T>, data: unknown): T {
  const result = schema.safeParse(data);

  if (!result.success) {
    const errors = result.error.errors.map((e) => `${e.path.join('.')}: ${e.message}`).join(', ');
    throw new Error(`Validation failed: ${errors}`);
  }

  return result.data;
}
