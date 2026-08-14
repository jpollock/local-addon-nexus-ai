import * as path from 'path';
import * as os from 'os';

/**
 * BackupGate — precondition for destructive operations.
 *
 * `requireBackup(target)` creates a fresh backup before allowing an overwrite
 * to proceed. The backup is created NOW, so "backup is newer than last mutation"
 * holds by construction — no timestamp comparison needed.
 *
 * Cost: Adds 1–5 minutes to every destructive operation, unconditionally.
 * This is deliberate — wrong-but-safe beats fast-but-lossy. The optimization
 * (export only on divergence) needs a manifest that does not exist yet (Track 3 Stage 2).
 */

// Generous timeout: large sites can take several minutes to back up.
// If a backup doesn't complete within this window, refuse rather than hang.
const BACKUP_TIMEOUT_MS = 10 * 60 * 1000; // 10 minutes
const POLL_INTERVAL_MS = 2000; // 2 seconds

export interface LocalBackupReference {
  type: 'local';
  path: string;
  createdAt: number; // epoch milliseconds
}

export interface RemoteBackupReference {
  type: 'remote';
  backupId: string;
  installId: string;
  createdAt: number; // epoch milliseconds
}

export type BackupReference = LocalBackupReference | RemoteBackupReference;

export interface BackupGateSuccess {
  success: true;
  backup: BackupReference;
}

export interface BackupGateError {
  success: false;
  error: string;
}

export type BackupGateResult = BackupGateSuccess | BackupGateError;

export interface LocalBackupTarget {
  type: 'local';
  siteId: string;
  siteName: string;
  outputPath?: string;
}

export interface RemoteBackupTarget {
  type: 'remote';
  installId: string;
  description?: string;
}

export type BackupTarget = LocalBackupTarget | RemoteBackupTarget;

interface BackupGateServices {
  logger: {
    info(...args: unknown[]): void;
    warn?(...args: unknown[]): void;
    error(...args: unknown[]): void;
  };
  localServices?: {
    exportSite(siteId: string, outputPath: string): Promise<void>;
    capiCreateBackup(installId: string, description: string): Promise<any>;
    capiDirect(path: string): Promise<any>;
  };
  operationTracker?: {
    register(siteId: string, siteName: string, type: 'pull' | 'push' | 'export'): string;
    getOperation(siteId: string): any;
    complete(siteId: string, message?: string): void;
    fail(siteId: string, message?: string): void;
  };
}

export class BackupGate {
  constructor(
    private services: BackupGateServices,
    private timeoutMs: number = BACKUP_TIMEOUT_MS,
    private pollIntervalMs: number = POLL_INTERVAL_MS
  ) {}

  async requireBackup(target: BackupTarget): Promise<BackupGateResult> {
    if (target.type === 'local') {
      return this.requireLocalBackup(target);
    } else {
      return this.requireRemoteBackup(target);
    }
  }

  private async requireLocalBackup(target: LocalBackupTarget): Promise<BackupGateResult> {
    const { siteId, siteName, outputPath } = target;

    if (!this.services.localServices) {
      return { success: false, error: 'Local services not available.' };
    }

    if (!this.services.operationTracker) {
      return { success: false, error: 'Operation tracker not available.' };
    }

    // Determine output path
    const outputDir = outputPath || path.join(os.homedir(), 'Downloads');
    const outputFile = path.join(outputDir, `${siteName}.zip`);

    this.services.logger.info(`[BackupGate] Creating local backup for site ${siteId} at ${outputFile}`);

    // Trigger export
    try {
      await this.services.localServices.exportSite(siteId, outputFile);
    } catch (err: any) {
      const message = `Local backup failed to start: ${err.message}. The backup did not complete.`;
      this.services.logger.error(`[BackupGate] ${message}`);
      return { success: false, error: message };
    }

    // Poll for completion
    const startedAt = Date.now();
    while (Date.now() - startedAt < this.timeoutMs) {
      await this.sleep(this.pollIntervalMs);

      const op = this.services.operationTracker.getOperation(siteId);

      if (!op) {
        // No operation record yet — keep polling
        continue;
      }

      if (op.status === 'completed') {
        // Extract export path from lastMessage if available
        const exportPath = this.extractExportPath(op.lastMessage) || outputFile;
        const createdAt = op.completedAt || Date.now();

        this.services.logger.info(`[BackupGate] Local backup completed: ${exportPath}`);
        return {
          success: true,
          backup: {
            type: 'local',
            path: exportPath,
            createdAt,
          },
        };
      }

      if (op.status === 'error') {
        const message = `Local backup failed: ${op.lastMessage || 'unknown error'}. The backup did not complete.`;
        this.services.logger.error(`[BackupGate] ${message}`);
        return { success: false, error: message };
      }

      // Still running — continue polling
    }

    // Timed out
    const message = `Local backup timed out after 10 minutes. The backup did not complete.`;
    this.services.logger.error(`[BackupGate] ${message}`);
    return { success: false, error: message };
  }

  private async requireRemoteBackup(target: RemoteBackupTarget): Promise<BackupGateResult> {
    const { installId, description } = target;

    if (!this.services.localServices) {
      return { success: false, error: 'Local services not available.' };
    }

    const backupDescription = description || 'Backup via Nexus AI (BackupGate)';

    this.services.logger.info(`[BackupGate] Creating remote backup for install ${installId}`);

    // Create backup
    let createResponse: any;
    try {
      createResponse = await this.services.localServices.capiCreateBackup(installId, backupDescription);
    } catch (err: any) {
      const message = `Remote backup failed to start: ${err.message}. The backup did not complete.`;
      this.services.logger.error(`[BackupGate] ${message}`);
      return { success: false, error: message };
    }

    const backupId = createResponse?.id ?? createResponse?.backup_id ?? null;
    if (!backupId) {
      const message = 'Remote backup creation did not return a backup ID. The backup did not complete.';
      this.services.logger.error(`[BackupGate] ${message}`);
      return { success: false, error: message };
    }

    // Poll for completion (up to 10 minutes)
    const startedAt = Date.now();
    const maxAttempts = Math.floor(this.timeoutMs / this.pollIntervalMs);

    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
      await this.sleep(this.pollIntervalMs);

      let backupData: any;
      try {
        backupData = await this.services.localServices.capiDirect(`/installs/${installId}/backups/${backupId}`);
      } catch {
        // Polling error — continue
        continue;
      }

      const status: string = (backupData?.status ?? '').toLowerCase();

      if (status === 'complete' || status === 'completed' || status === 'success') {
        const createdAtStr = backupData?.created_at ?? backupData?.date ?? null;
        const createdAt = createdAtStr ? new Date(createdAtStr).getTime() : Date.now();

        this.services.logger.info(`[BackupGate] Remote backup completed: ${backupId}`);
        return {
          success: true,
          backup: {
            type: 'remote',
            backupId,
            installId,
            createdAt,
          },
        };
      }

      if (status === 'failed' || status === 'error') {
        const message = `Remote backup failed: ${backupData?.message || 'unknown error'}. The backup did not complete.`;
        this.services.logger.error(`[BackupGate] ${message}`);
        return { success: false, error: message };
      }

      // Still running — continue polling
    }

    // Timed out
    const message = `Remote backup timed out after 10 minutes. The backup did not complete.`;
    this.services.logger.error(`[BackupGate] ${message}`);
    return { success: false, error: message };
  }

  private extractExportPath(message: string | null): string | null {
    if (!message) return null;
    const match = message.match(/Exported to (.+)/);
    return match ? match[1] : null;
  }

  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
}
