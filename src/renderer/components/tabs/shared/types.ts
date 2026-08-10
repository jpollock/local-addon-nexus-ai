/**
 * Shared types for Overview and future tabs.
 * Extracted to prevent duplication across tab components.
 */

export interface DashboardStats {
  localSites: { total: number; running: number; halted: number };
  wpeConnected: { count: number };
  remoteSites: { total: number; unlinked: number; capiAvailable: boolean; wpeAuthenticated: boolean };
  mcpServer: { running: boolean; toolCount: number; port: number | null; version: string | null };
  embedding: { ready: boolean; model: string; quantized: boolean; dimensions: number; maxSequenceLength: number };
  index: { localIndexed: number; localTotal: number; wpeIndexed: number; wpeTotal: number; totalDocuments: number; totalChunks: number; lastIndexed: number | null };
}

export interface McpInfo {
  url: string;
  authToken: string;
  port: number;
  version: string;
  tools: string[];
  stdioPath: string;
}

export interface StartupStatus {
  ready: boolean;
  phase: string | null;
  error: {
    message: string;
    name: string;
    code: string | null;
    phase: string;
    hint: string | null;
  } | null;
}

export interface AiProxyInfo {
  url: string;
  port: number;
  running: boolean;
  models: string[];
  toolCapableModels: string[];
}

export interface FleetVersionEntry {
  version: string;
  count: number;
}

export interface FleetSummaryData {
  total: number;
  totalLocal: number;
  totalWpe: number;
  wpVersions: FleetVersionEntry[];
  phpVersions: FleetVersionEntry[];
  completeness: { none: number; filesystem: number; metadata: number; indexed: number };
  wpeSync?: { synced: number; neverSynced: number };
  staleCount: number;
  neverScannedCount: number;
}
