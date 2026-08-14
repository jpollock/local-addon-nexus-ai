import { BackupGate, BackupReference, BackupGateError } from '../../../src/main/safety/BackupGate';

describe('BackupGate', () => {
  let gate: BackupGate;
  let mockServices: any;
  let mockLogger: any;

  beforeEach(() => {
    mockLogger = {
      info: jest.fn(),
      warn: jest.fn(),
      error: jest.fn(),
    };

    mockServices = {
      logger: mockLogger,
      localServices: {
        exportSite: jest.fn(),
        capiCreateBackup: jest.fn(),
        capiDirect: jest.fn(),
      },
      operationTracker: {
        register: jest.fn(),
        getOperation: jest.fn(),
        complete: jest.fn(),
        fail: jest.fn(),
      },
    };

    // Use short timeouts for testing (1 second timeout, 100ms poll interval)
    gate = new BackupGate(mockServices, 1000, 100);
  });

  describe('requireBackup - refusal paths (TDD: RED first)', () => {
    it('refuses when local export fails to start', async () => {
      const target = { type: 'local' as const, siteId: 'test-site', siteName: 'Test Site' };
      mockServices.localServices.exportSite.mockRejectedValue(new Error('Export failed to start'));

      const result = await gate.requireBackup(target);

      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error).toContain('Export failed to start');
        expect(result.error).toContain('backup did not complete');
      }
    });

    it('refuses when local export times out', async () => {
      const target = { type: 'local' as const, siteId: 'test-site', siteName: 'Test Site' };
      mockServices.localServices.exportSite.mockResolvedValue(undefined);

      // Mock operation tracker to report "active" status indefinitely (timeout scenario)
      mockServices.operationTracker.getOperation.mockReturnValue({
        status: 'active',
        startedAt: Date.now() - 11 * 60 * 1000, // Started 11 minutes ago
      });

      const result = await gate.requireBackup(target);

      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error).toContain('timed out');
      }
    });

    it('refuses when local export fails during operation', async () => {
      const target = { type: 'local' as const, siteId: 'test-site', siteName: 'Test Site' };
      mockServices.localServices.exportSite.mockResolvedValue(undefined);

      // Mock operation tracker to report "error" status
      mockServices.operationTracker.getOperation.mockReturnValue({
        status: 'error',
        lastMessage: 'Disk full',
      });

      const result = await gate.requireBackup(target);

      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error).toContain('Disk full');
      }
    });

    it('refuses when remote backup fails to start', async () => {
      const target = { type: 'remote' as const, installId: 'test-install' };
      mockServices.localServices.capiCreateBackup.mockRejectedValue(new Error('CAPI error'));

      const result = await gate.requireBackup(target);

      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error).toContain('CAPI error');
      }
    });

    it('refuses when remote backup completes with failed status', async () => {
      const target = { type: 'remote' as const, installId: 'test-install' };
      mockServices.localServices.capiCreateBackup.mockResolvedValue({ id: 'backup-123' });

      // Mock CAPI to return failed backup status
      mockServices.localServices.capiDirect.mockResolvedValue({
        status: 'failed',
        message: 'Backup process crashed',
      });

      const result = await gate.requireBackup(target);

      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error).toContain('failed');
        expect(result.error).toContain('Backup process crashed');
      }
    });

    it('refuses when remote backup times out', async () => {
      const target = { type: 'remote' as const, installId: 'test-install' };
      mockServices.localServices.capiCreateBackup.mockResolvedValue({ id: 'backup-123' });

      // Mock CAPI to always return "running" status (timeout scenario)
      mockServices.localServices.capiDirect.mockResolvedValue({
        status: 'running',
      });

      const result = await gate.requireBackup(target);

      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error).toContain('timed out');
      }
    });
  });

  describe('requireBackup - success paths', () => {
    it('returns backup reference when local export completes successfully', async () => {
      const target = { type: 'local' as const, siteId: 'test-site', siteName: 'Test Site' };
      const exportPath = '/Users/test/Downloads/Test Site.zip';

      mockServices.localServices.exportSite.mockResolvedValue(undefined);

      // Mock operation tracker to report completion on first check
      mockServices.operationTracker.getOperation.mockReturnValue({
        status: 'completed',
        completedAt: Date.now(),
        lastMessage: `Exported to ${exportPath}`,
      });

      const result = await gate.requireBackup(target);

      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.backup.type).toBe('local');
        if (result.backup.type === 'local') {
          expect(result.backup.path).toBe(exportPath);
          expect(result.backup.createdAt).toBeGreaterThan(Date.now() - 5000);
        }
      }
    });

    it('returns backup reference when remote backup completes successfully', async () => {
      const target = { type: 'remote' as const, installId: 'test-install' };
      const backupId = 'backup-456';
      const createdAt = new Date().toISOString();

      mockServices.localServices.capiCreateBackup.mockResolvedValue({ id: backupId });

      // Mock CAPI to return completed backup on first poll
      mockServices.localServices.capiDirect.mockResolvedValue({
        status: 'complete',
        created_at: createdAt,
      });

      const result = await gate.requireBackup(target);

      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.backup.type).toBe('remote');
        if (result.backup.type === 'remote') {
          expect(result.backup.backupId).toBe(backupId);
          expect(result.backup.createdAt).toBeGreaterThan(0);
        }
      }
    });

    it('polls multiple times before completion', async () => {
      const target = { type: 'remote' as const, installId: 'test-install' };
      mockServices.localServices.capiCreateBackup.mockResolvedValue({ id: 'backup-789' });

      let pollCount = 0;
      mockServices.localServices.capiDirect.mockImplementation(async () => {
        pollCount++;
        if (pollCount < 3) {
          return { status: 'running' };
        }
        return { status: 'complete', created_at: new Date().toISOString() };
      });

      const result = await gate.requireBackup(target);

      expect(result.success).toBe(true);
      expect(pollCount).toBe(3);
    });
  });

  describe('requireBackup - edge cases', () => {
    it('refuses when backup ID is missing from remote creation response', async () => {
      const target = { type: 'remote' as const, installId: 'test-install' };
      mockServices.localServices.capiCreateBackup.mockResolvedValue({});

      const result = await gate.requireBackup(target);

      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error).toContain('backup ID');
      }
    });

    it('refuses when operation tracker has no record of local export', async () => {
      const target = { type: 'local' as const, siteId: 'test-site', siteName: 'Test Site' };
      mockServices.localServices.exportSite.mockResolvedValue(undefined);
      mockServices.operationTracker.getOperation.mockReturnValue(undefined);

      const result = await gate.requireBackup(target);

      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error).toContain('timed out');
      }
    });

    it('extracts export path from operation tracker lastMessage', async () => {
      const target = { type: 'local' as const, siteId: 'test-site', siteName: 'Test Site' };
      const exportPath = '/custom/path/backup.zip';

      mockServices.localServices.exportSite.mockResolvedValue(undefined);
      mockServices.operationTracker.getOperation.mockReturnValue({
        status: 'completed',
        completedAt: Date.now(),
        lastMessage: `Exported to ${exportPath}`,
      });

      const result = await gate.requireBackup(target);

      expect(result.success).toBe(true);
      if (result.success && result.backup.type === 'local') {
        expect(result.backup.path).toBe(exportPath);
      }
    });
  });
});
