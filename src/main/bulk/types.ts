/**
 * Bulk Operation Types (Sprint 3)
 */

export type BulkOpType = 'reindex' | 'plugin-update' | 'start' | 'stop' | 'health-refresh' | 'setup-ai' | 'sync-graph';

export interface BulkOperationRequest {
  type: BulkOpType;
  siteIds: string[];
  options?: {
    pluginSlug?: string;
    dryRun?: boolean;
    provider?: string;
    autoStartStop?: boolean; // If true, will start halted sites, run operation, then stop them
  };
}

export interface BulkOperation {
  id: string;
  type: BulkOpType;
  siteIds: string[];
  options: Record<string, any>;
  status: 'running' | 'completed' | 'completed_with_errors' | 'cancelled' | 'failed';
  progress: { completed: number; total: number; errors: string[] };
  results: Map<string, SiteOpResult>;
  createdAt: number;
  completedAt: number | null;
  abortController: AbortController;
}

export interface SiteOpResult {
  status: 'pending' | 'running' | 'completed' | 'failed';
  startedAt: number;
  completedAt?: number;
  error?: string;
}

export interface BulkOperationStatus {
  id: string;
  type: BulkOpType;
  siteIds: string[];
  status: 'running' | 'completed' | 'completed_with_errors' | 'cancelled' | 'failed';
  progress: { completed: number; total: number; errors: string[] };
  siteResults: Record<string, SiteOpResult>;
  createdAt: number;
  completedAt: number | null;
}
