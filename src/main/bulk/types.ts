/**
 * Bulk Operation Types (Sprint 3)
 */

export type BulkOpType = 'reindex' | 'plugin-update' | 'start' | 'stop' | 'health-refresh' | 'setup-ai' | 'sync-graph' | 'index';

export interface BulkOperationRequest {
  type: BulkOpType;
  siteIds: string[];
  siteNames?: Record<string, string>; // id → display name, resolved at creation time
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
  siteNames?: Record<string, string>;
  options: Record<string, any>;
  status: 'running' | 'completed' | 'completed_with_errors' | 'cancelled' | 'failed';
  progress: { completed: number; total: number; errors: string[]; skipped: string[] };
  results: Map<string, SiteOpResult>;
  createdAt: number;
  completedAt: number | null;
  abortController: AbortController;
}

/**
 * What `executeByType` observed. Throwing is the failure channel; returning
 * says whether the work actually ran.
 *
 * WP-67: `executeSingle` used to decide success by whether `executeByType`
 * threw, and every implementation beneath it returned normally when it had
 * done nothing — so 365 WP Engine installs that extracted zero posts were
 * reported as "succeeded". "Did not run" is a first-class outcome and must
 * carry the reason that makes it a shippable sentence.
 */
export type SiteOpOutcome =
  | { ran: true }
  | { ran: false; reason: string };

export interface SiteOpResult {
  status: 'pending' | 'running' | 'completed' | 'failed' | 'skipped';
  startedAt: number;
  completedAt?: number;
  error?: string;
  /** Present only on `skipped` — why the work did not run. */
  skipReason?: string;
}

export interface BulkOperationStatus {
  id: string;
  type: BulkOpType;
  siteIds: string[];
  siteNames?: Record<string, string>;
  status: 'running' | 'completed' | 'completed_with_errors' | 'cancelled' | 'failed';
  progress: { completed: number; total: number; errors: string[]; skipped: string[] };
  siteResults: Record<string, SiteOpResult>;
  createdAt: number;
  completedAt: number | null;
}
