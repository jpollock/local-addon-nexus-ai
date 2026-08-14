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
    exportSite(siteId: string, outputPath: string): Promise<string>;
    capiCreateBackup(installId: string, description: string): Promise<any>;
    capiDirect(path: string): Promise<any>;
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

    // C1: Generate unique filename with timestamp to prevent overwriting previous backups
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    const outputDir = outputPath || path.join(os.homedir(), 'Downloads');
    const outputFile = path.join(outputDir, `${siteName}-${timestamp}.zip`);

    this.services.logger.info(`[BackupGate] Creating local backup for site ${siteId} at ${outputFile}`);

    // I2: exportSite() is synchronous — it awaits the worker and returns the verified path.
    // No poll loop needed. The bridge method verifies the zip exists before returning.
    let zipPath: string;
    try {
      zipPath = await this.services.localServices.exportSite(siteId, outputFile);
    } catch (err: unknown) {
      const errMsg = err instanceof Error ? err.message : String(err);
      const timeoutMinutes = Math.round(this.timeoutMs / 60000);
      const message = `Local backup failed: ${errMsg}. The backup did not complete.`;
      this.services.logger.error(`[BackupGate] ${message}`);
      return { success: false, error: message };
    }

    const createdAt = Date.now();
    this.services.logger.info(`[BackupGate] Local backup completed: ${zipPath}`);
    return {
      success: true,
      backup: {
        type: 'local',
        path: zipPath,
        createdAt,
      },
    };
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
    } catch (err: unknown) {
      const errMsg = err instanceof Error ? err.message : String(err);
      const message = `Remote backup failed to start: ${errMsg}. The backup did not complete.`;
      this.services.logger.error(`[BackupGate] ${message}`);
      return { success: false, error: message };
    }

    const backupId = createResponse?.id ?? createResponse?.backup_id ?? null;
    if (!backupId) {
      const message = 'Remote backup creation did not return a backup ID. The backup did not complete.';
      this.services.logger.error(`[BackupGate] ${message}`);
      return { success: false, error: message };
    }

    // I3: Poll for completion using wall-clock time, not iteration count
    const startedAt = Date.now();

    while (Date.now() - startedAt < this.timeoutMs) {
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
    const timeoutMinutes = Math.round(this.timeoutMs / 60000);
    const message = `Remote backup timed out after ${timeoutMinutes} minutes. The backup did not complete.`;
    this.services.logger.error(`[BackupGate] ${message}`);
    return { success: false, error: message };
  }

  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
}
