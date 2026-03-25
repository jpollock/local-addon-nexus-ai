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
// Health & Monitoring
// ============================================================================

export const HealthGetScoreSchema = z.object({
  siteId: SiteIdSchema,
});

export const HealthGetTrendSchema = z.object({
  siteId: SiteIdSchema,
  days: z.number().int().positive().max(365).optional(),
});

export const HealthGetFleetTrendSchema = z.object({
  days: z.number().int().positive().max(365).optional(),
}).optional();

// ============================================================================
// Query Management
// ============================================================================

export const QueryFiltersSchema = z.object({
  contentTypes: z.array(z.string()).optional(),
  siteIds: z.array(SiteIdSchema).optional(),
  searchText: z.string().optional(),
});

export const QuerySchema = z.object({
  name: z.string().min(1).max(100),
  description: z.string().max(500).optional(),
  filters: QueryFiltersSchema,
  pinned: z.boolean().default(false),
});

export const QueryUpdateSchema = z.object({
  id: z.string().min(1),
  changes: z.object({
    name: z.string().min(1).max(100).optional(),
    description: z.string().max(500).optional(),
    filters: QueryFiltersSchema.optional(),
    pinned: z.boolean().optional(),
  }),
});

export const QueryIdSchema = z.string().min(1, 'Query ID required');

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

export const AIGatewayUsageOptionsSchema = z.object({
  siteId: SiteIdSchema.optional(),
  since: z.number().int().positive().optional(),
  until: z.number().int().positive().optional(),
  limit: z.number().int().positive().max(1000).optional(),
}).optional();

export const AIGatewayRateLimitSchema = z.object({
  siteId: SiteIdSchema,
  config: z.record(z.unknown()).optional(),
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

export const SearchUnifiedSchema = z.object({
  query: z.string().min(1).max(500),
  filters: z.record(z.unknown()).optional(),
  options: z.record(z.unknown()).optional(),
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
// WPE Operations (Remote)
// ============================================================================

export const WpeRemoveSiteSchema = z.object({
  installId: z.string().min(1, 'Install ID required'),
});

export const WpePullToLocalSchema = z.object({
  wpeSiteId: z.string().min(1),
  installName: z.string().min(1),
  installId: z.string().min(1),
});

export const WpeSyncSingleSchema = z.object({
  installId: z.string().min(1, 'Install ID required'),
});

export const WpeSyncAllSchema = z.object({
  limit: z.number().int().positive().max(500).optional(),
}).optional();

export const WpeInstallIdSchema = z.string().min(1, 'Install ID required');

// ============================================================================
// Bulk Operations (Extended)
// ============================================================================

export const BulkOperationRequestSchema = z.object({
  type: z.enum(['reindex', 'plugin-update', 'start', 'stop', 'health-refresh', 'setup-ai', 'sync-graph']),
  siteIds: z.array(SiteIdSchema).min(1, 'At least one site ID required'),
  options: z.record(z.unknown()).optional(),
});

export const FleetOperationOptionsSchema = z.object({
  siteIds: z.array(SiteIdSchema).optional(),
}).optional();

// ============================================================================
// Events & Storage
// ============================================================================

export const EventTimelineOptionsSchema = z.object({
  limit: z.number().int().positive().max(1000).optional(),
  filter: z.string().optional(),
  status: z.enum(['pending', 'processed', 'failed']).optional(),
  siteId: SiteIdSchema.optional(),
}).optional();

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
