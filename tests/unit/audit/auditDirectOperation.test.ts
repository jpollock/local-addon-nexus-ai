/**
 * C2 — the direct-call audit path.
 *
 * Only 8 GraphQL resolver call sites route through `ToolRegistry.call()`. The
 * rest call `services.localServices` directly and, before this change, produced
 * no durable audit entry at all — including arbitrary WP-CLI against production
 * WP Engine installs and `DELETE /installs/{id}`.
 *
 * These tests cover the shared helper plus representative destructive paths on
 * each surface (GraphQL resolver, IPC handler-equivalent, bulk manager). They
 * deliberately do not attempt all ~30 sites; the helper is the thing that must
 * not drift.
 */

import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { auditDirectOperation } from '../../../src/main/audit/auditDirectOperation';
import { OperationAuditLog, AuditEntry } from '../../../src/main/audit/OperationAuditLog';
import { createResolvers } from '../../../src/main/graphql/resolvers';
import { createWpeResolvers } from '../../../src/main/graphql/resolvers/wpe';
import { BulkOperationManager } from '../../../src/main/bulk/BulkOperationManager';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeLog(): { dir: string; logPath: string; log: OperationAuditLog } {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'nexus-direct-audit-'));
  const logPath = path.join(dir, 'operation-audit.log');
  return { dir, logPath, log: new OperationAuditLog(logPath) };
}

function readEntries(logPath: string): AuditEntry[] {
  if (!fs.existsSync(logPath)) return [];
  return fs
    .readFileSync(logPath, 'utf-8')
    .split('\n')
    .filter(Boolean)
    .map((l) => JSON.parse(l) as AuditEntry);
}

// ---------------------------------------------------------------------------
// The helper itself
// ---------------------------------------------------------------------------

describe('auditDirectOperation', () => {
  it('writes a durable entry through operationAuditLog', () => {
    const { dir, logPath, log } = makeLog();

    auditDirectOperation({ operationAuditLog: log }, {
      operation: 'wpe.install.delete',
      target: 'acme-prod',
      parameters: { installId: 'i-123', confirmName: 'acme-prod' },
      outcome: 'success',
    });

    const entries = readEntries(logPath);
    expect(entries).toHaveLength(1);
    expect(entries[0].operation).toBe('wpe.install.delete');
    expect(entries[0].target).toBe('acme-prod');
    expect(entries[0].outcome).toBe('success');
    expect(entries[0].parameters.installId).toBe('i-123');
    expect(entries[0].id).toHaveLength(36);

    fs.rmSync(dir, { recursive: true, force: true });
  });

  it('records failures with the error message', () => {
    const { dir, logPath, log } = makeLog();

    auditDirectOperation({ operationAuditLog: log }, {
      operation: 'wpe.install.delete',
      target: 'acme-prod',
      parameters: { installId: 'i-123' },
      outcome: 'failure',
      error: 'CAPI 403 Forbidden',
    });

    const entries = readEntries(logPath);
    expect(entries[0].outcome).toBe('failure');
    expect(entries[0].error).toBe('CAPI 403 Forbidden');

    fs.rmSync(dir, { recursive: true, force: true });
  });

  it('redacts inside log() — the call site cannot leak a credential', () => {
    const { dir, logPath, log } = makeLog();

    auditDirectOperation({ operationAuditLog: log }, {
      operation: 'cli.wp.command',
      target: 'wpe:acme-prod',
      parameters: { command: ['config', 'set', '--user_pass=hunter2super'], api_key: 'sk-live-Zz0123456789AbCdEfGh' },
      outcome: 'failure',
      error: 'connect failed: mysql://wp:tr0ub4dorpw@db/wordpress',
    });

    const raw = fs.readFileSync(logPath, 'utf-8');
    expect(raw).not.toContain('sk-live-Zz0123456789AbCdEfGh');
    expect(raw).not.toContain('hunter2super');
    expect(raw).not.toContain('tr0ub4dorpw');
    expect(raw).toContain('[REDACTED]');

    fs.rmSync(dir, { recursive: true, force: true });
  });

  it('is a no-op when operationAuditLog is absent, and never throws', () => {
    expect(() =>
      auditDirectOperation({}, { operation: 'o', target: 't', parameters: {}, outcome: 'success' }),
    ).not.toThrow();
    expect(() =>
      auditDirectOperation(undefined, { operation: 'o', target: 't', parameters: {}, outcome: 'success' }),
    ).not.toThrow();
  });

  it('never throws when the underlying log throws', () => {
    const exploding = { log() { throw new Error('disk on fire'); } } as unknown as OperationAuditLog;
    expect(() =>
      auditDirectOperation({ operationAuditLog: exploding }, {
        operation: 'o', target: 't', parameters: {}, outcome: 'success',
      }),
    ).not.toThrow();
  });
});

// ---------------------------------------------------------------------------
// Representative destructive paths
// ---------------------------------------------------------------------------

describe('direct-call audit coverage — GraphQL resolvers', () => {
  // `delete` and `push` are denied on every environment by default, so these
  // resolvers would refuse before reaching CAPI. Grant them explicitly — a
  // refusal is correctly NOT audited (nothing happened), which the
  // "only previewed" case below asserts.
  const PERMISSIVE_SETTINGS = {
    wpeOperationPermissions: {
      delete: { development: true, staging: true, production: true },
      push: { development: true, staging: true, production: true },
      wpcli: { development: true, staging: true, production: true },
    },
  };

  function makeRegistryStorage() {
    return {
      get: (key: string) => (key.includes('settings') ? PERMISSIVE_SETTINGS : {}),
      set: () => {},
    };
  }

  function getMutation(localServices: any, log: OperationAuditLog) {
    const services: any = {
      localServices,
      operationAuditLog: log,
      registryStorage: makeRegistryStorage(),
      siteData: { getSites: () => ({}) },
      graphService: { getDb: () => null },
      indexRegistry: { listAll: () => [] },
    };
    return createResolvers({ services, registry: { call: jest.fn() } as any }).Mutation as any;
  }

  it('audits wpe install delete (DELETE /installs/{id})', async () => {
    const { dir, logPath, log } = makeLog();
    const capiDirect = jest.fn(async (p: string, method?: string) => {
      if (method === undefined) return { id: 'i-123', name: 'acme-prod', environment: 'production' };
      return {};
    });
    const Mutation = getMutation({ capiDirect }, log);

    const res = await Mutation.nexusWpeDeleteInstall(null, { installId: 'i-123', confirmName: 'acme-prod' });
    expect(res.success).toBe(true);

    const entries = readEntries(logPath);
    expect(entries).toHaveLength(1);
    expect(entries[0].operation).toBe('wpe.install.delete');
    expect(entries[0].target).toBe('acme-prod');
    expect(entries[0].outcome).toBe('success');

    fs.rmSync(dir, { recursive: true, force: true });
  });

  it('audits a failed wpe install delete', async () => {
    const { dir, logPath, log } = makeLog();
    const capiDirect = jest.fn(async (p: string, method?: string) => {
      if (method === 'DELETE') throw new Error('CAPI 403 Forbidden');
      return { id: 'i-123', name: 'acme-prod', environment: 'production' };
    });
    const Mutation = getMutation({ capiDirect }, log);

    const res = await Mutation.nexusWpeDeleteInstall(null, { installId: 'i-123', confirmName: 'acme-prod' });
    expect(res.success).toBe(false);

    const entries = readEntries(logPath);
    expect(entries).toHaveLength(1);
    expect(entries[0].operation).toBe('wpe.install.delete');
    expect(entries[0].outcome).toBe('failure');
    expect(entries[0].error).toContain('403');

    fs.rmSync(dir, { recursive: true, force: true });
  });

  it('audits install_copy, which overwrites the destination environment', async () => {
    const { dir, logPath, log } = makeLog();
    const capiDirect = jest.fn(async (p: string) => {
      if (p === '/installs/src-1') return { id: 'src-1', name: 'acme-staging', environment: 'staging' };
      if (p === '/installs/dst-1') return { id: 'dst-1', name: 'acme-prod', environment: 'production' };
      return {};
    });
    const Mutation = getMutation({ capiDirect }, log);

    await Mutation.nexusWpePromote(null, {
      sourceInstallId: 'src-1', destInstallId: 'dst-1', includeDatabase: true, confirm: true,
    });

    const entries = readEntries(logPath);
    expect(entries).toHaveLength(1);
    expect(entries[0].operation).toBe('wpe.install.copy');
    expect(entries[0].target).toBe('acme-prod');
    expect(entries[0].parameters.destEnvironment).toBe('production');

    fs.rmSync(dir, { recursive: true, force: true });
  });

  it('does NOT audit a promote that only previewed (no --confirm)', async () => {
    const { dir, logPath, log } = makeLog();
    const capiDirect = jest.fn(async () => ({ id: 'x', name: 'n', environment: 'production' }));
    const Mutation = getMutation({ capiDirect }, log);

    const res = await Mutation.nexusWpePromote(null, {
      sourceInstallId: 'src-1', destInstallId: 'dst-1', confirm: false,
    });
    expect(res.requiresConfirmation).toBe(true);
    expect(readEntries(logPath)).toHaveLength(0);

    fs.rmSync(dir, { recursive: true, force: true });
  });

  it('audits remote WP-CLI against a WP Engine install', async () => {
    const { dir, logPath, log } = makeLog();
    const remoteWpCliRun = jest.fn(async () => ({ success: true, stdout: 'Success', stderr: '' }));
    const Mutation = getMutation({
      remoteWpCliRun,
      isSSHKeyAvailable: () => true,
    }, log);

    const res = await Mutation.nexusWpCommand(null, {
      target: 'wpe:acme/acme-prod@staging',
      command: ['plugin', 'update', 'akismet'],
    });
    expect(res.success).toBe(true);

    const entries = readEntries(logPath);
    expect(entries).toHaveLength(1);
    expect(entries[0].operation).toBe('cli.wp.command');
    expect(entries[0].target).toBe('wpe:acme-prod');
    expect(entries[0].parameters.remote).toBe(true);
    // CHANGED EXPECTATION (withhold list): the argv is withheld, not recorded.
    // Everything that identifies the operation still survives, which is the
    // property the withheld marker exists to preserve.
    expect(entries[0].parameters.command).toBe('[WITHHELD: freeform input, 3 elements, 19 chars]');

    fs.rmSync(dir, { recursive: true, force: true });
  });

  it('audits local WP-CLI', async () => {
    const { dir, logPath, log } = makeLog();
    const wpCliRun = jest.fn(async () => ({ success: true, stdout: 'ok', stderr: '', exitCode: 0 }));
    const services: any = {
      localServices: { wpCliRun, getSiteStatus: () => 'running' },
      operationAuditLog: log,
      registryStorage: { get: () => ({}), set: () => {} },
      siteData: { getSites: () => ({ 's1': { id: 's1', name: 'mysite' } }) },
      graphService: { getDb: () => null },
      indexRegistry: { listAll: () => [] },
    };
    const Mutation = createResolvers({ services, registry: { call: jest.fn() } as any }).Mutation as any;

    const res = await Mutation.nexusWpCommand(null, { target: 'mysite@local', command: ['plugin', 'list'] });
    expect(res.success).toBe(true);

    const entries = readEntries(logPath);
    expect(entries).toHaveLength(1);
    expect(entries[0].operation).toBe('cli.wp.command');
    expect(entries[0].target).toBe('mysite');
    expect(entries[0].parameters.remote).toBe(false);

    fs.rmSync(dir, { recursive: true, force: true });
  });

  it('audits the split wpe resolver module too (resolvers/wpe.ts)', async () => {
    const { dir, logPath, log } = makeLog();
    const capiDirect = jest.fn(async () => ({ id: 'i-1', name: 'acme-prod' }));
    const wpe = createWpeResolvers({
      localServices: { capiDirect, capiGetInstall: async () => ({ id: 'i-1' }) },
      operationAuditLog: log,
    } as any) as any;

    await wpe.nexusWpeDeleteInstall(null, { installId: 'i-1', confirmName: 'acme-prod' });

    const entries = readEntries(logPath);
    expect(entries).toHaveLength(1);
    expect(entries[0].operation).toBe('wpe.install.delete');
    expect(entries[0].target).toBe('acme-prod');

    fs.rmSync(dir, { recursive: true, force: true });
  });
});

describe('direct-call audit coverage — BulkOperationManager', () => {
  it('audits each per-site plugin update in a fleet-wide bulk operation', async () => {
    const { dir, logPath, log } = makeLog();

    const wpCliRun = jest.fn(async (siteId: string) => ({
      success: siteId !== 'site-b',
      stdout: '{}',
    }));

    const mgr = new BulkOperationManager({
      contentPipeline: { indexSite: jest.fn() } as any,
      siteDataBridge: {
        resolveSiteObject: (id: string) => ({ id, name: id }),
        getSiteStatus: () => 'running',
        startSite: jest.fn(),
        stopSite: jest.fn(),
        wpCliRun,
        getPlugins: jest.fn(),
        getThemes: jest.fn(),
        getWpVersion: jest.fn(),
        getOption: jest.fn(),
      } as any,
      healthCalculator: { calculateScore: jest.fn() } as any,
      onProgress: () => {},
      auditServices: { operationAuditLog: log },
    });

    const opId = mgr.execute({
      type: 'plugin-update',
      siteIds: ['site-a', 'site-b'],
      options: { pluginSlug: 'akismet' },
    } as any);
    await mgr.waitForCompletion(opId);

    const entries = readEntries(logPath).sort((a, b) => a.target.localeCompare(b.target));
    expect(entries).toHaveLength(2);
    expect(entries.every((e) => e.operation === 'bulk.plugin.update')).toBe(true);
    expect(entries[0].target).toBe('site-a');
    expect(entries[0].outcome).toBe('success');
    expect(entries[1].target).toBe('site-b');
    expect(entries[1].outcome).toBe('failure');
    expect(entries[1].error).toContain('akismet');

    fs.rmSync(dir, { recursive: true, force: true });
  });
});
