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
    };

    // Use short timeouts for testing (1 second timeout, 100ms poll interval)
    gate = new BackupGate(mockServices, 1000, 100);
  });

  describe('requireBackup - refusal paths (TDD: RED first)', () => {
    it('refuses when local export fails', async () => {
      const target = { type: 'local' as const, siteId: 'test-site', siteName: 'Test Site' };
      mockServices.localServices.exportSite.mockRejectedValue(new Error('Export failed'));

      const result = await gate.requireBackup(target);

      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error).toContain('Export failed');
        expect(result.error).toContain('backup did not complete');
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

    it('refuses when backup ID is missing from remote creation response', async () => {
      const target = { type: 'remote' as const, installId: 'test-install' };
      mockServices.localServices.capiCreateBackup.mockResolvedValue({});

      const result = await gate.requireBackup(target);

      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error).toContain('backup ID');
      }
    });
  });

  describe('requireBackup - success paths', () => {
    it('returns backup reference when local export completes successfully', async () => {
      const target = { type: 'local' as const, siteId: 'test-site', siteName: 'Test Site' };
      const exportPath = '/Users/test/Downloads/Test Site-2026-08-13T10-30-00-000Z.zip';

      // I2 fix: exportSite returns the path directly
      mockServices.localServices.exportSite.mockResolvedValue(exportPath);

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

    it('C1: generates unique filenames with timestamp', async () => {
      const target = { type: 'local' as const, siteId: 'test-site', siteName: 'Test Site' };
      const firstPath = '/Users/test/Downloads/Test Site-2026-08-13T10-30-00-000Z.zip';
      const secondPath = '/Users/test/Downloads/Test Site-2026-08-13T10-35-00-000Z.zip';

      mockServices.localServices.exportSite
        .mockResolvedValueOnce(firstPath)
        .mockResolvedValueOnce(secondPath);

      const result1 = await gate.requireBackup(target);
      const result2 = await gate.requireBackup(target);

      expect(result1.success).toBe(true);
      expect(result2.success).toBe(true);

      if (result1.success && result2.success && result1.backup.type === 'local' && result2.backup.type === 'local') {
        // Both backups succeeded and returned different paths
        expect(result1.backup.path).not.toBe(result2.backup.path);
      }
    });
  });
});
