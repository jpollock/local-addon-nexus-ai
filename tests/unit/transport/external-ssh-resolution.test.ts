import { EventEmitter } from 'events';
import Database from 'better-sqlite3';

const spawnMock = jest.fn();
jest.mock('child_process', () => ({ spawn: (...args: any[]) => spawnMock(...args) }));

import { resolveTransport } from '../../../src/main/transport';
import { STORAGE_KEYS } from '../../../src/common/constants';

function fakeProc(opts: { code?: number; stdout?: string; stderr?: string } = {}) {
  const proc: any = new EventEmitter();
  proc.stdout = new EventEmitter();
  proc.stderr = new EventEmitter();
  setImmediate(() => {
    if (opts.stdout) proc.stdout.emit('data', Buffer.from(opts.stdout));
    if (opts.stderr) proc.stderr.emit('data', Buffer.from(opts.stderr));
    proc.emit('close', opts.code ?? 0);
  });
  return proc;
}

/**
 * A REAL sqlite database, not a SQL-text mock. findExternalSites' correctness
 * depends on `source='external'`, `is_active=1` and `account_id=?` actually
 * being applied; a hand-rolled mock that re-implements the filtering cannot
 * detect their removal (that gap was found in this plan's Task 3 review).
 */
const openDb = () => {
  const db = new Database(':memory:');
  db.exec(`CREATE TABLE sites (
    id TEXT PRIMARY KEY, name TEXT NOT NULL, domain TEXT,
    account_id TEXT, is_active INTEGER DEFAULT 1, source TEXT DEFAULT 'local',
    environment TEXT, wp_path TEXT, wp_cli_path TEXT
  )`);
  return db;
};

const dbs: any[] = [];
afterEach(() => {
  while (dbs.length) { try { dbs.pop().close(); } catch { /* already closed */ } }
});

type SiteRow = {
  name: string;
  account_id: string;
  environment?: string | null;
  wp_path?: string | null;
  wp_cli_path?: string | null;
  is_active?: number;
  source?: string;
};

/** Build a NexusServices stand-in with a connection profile and graph site rows. */
function makeServices(opts: { profile?: any; profiles?: any[]; sites?: SiteRow[] } = {}) {
  const store: Record<string, unknown> = {};
  const profiles = opts.profiles ?? (opts.profile ? [opts.profile] : []);
  store[STORAGE_KEYS.EXTERNAL_SITE_PROFILES] = Object.fromEntries(
    profiles.map((p) => [p.alias, p]),
  );

  const db = openDb();
  dbs.push(db);
  const insert = db.prepare(
    `INSERT INTO sites (id, name, domain, account_id, is_active, source, environment, wp_path, wp_cli_path)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  );
  for (const s of opts.sites ?? []) {
    insert.run(
      `ssh:${s.account_id}/${s.name}`, s.name, s.account_id, s.account_id,
      s.is_active ?? 1, s.source ?? 'external',
      s.environment ?? null, s.wp_path ?? null, s.wp_cli_path ?? null,
    );
  }

  return {
    registryStorage: {
      get: (k: string) => store[k],
      set: (k: string, v: unknown) => { store[k] = v; },
    },
    graphService: { getDb: () => db },
  } as any;
}

const text = (r: any) => r.content[0].text as string;

beforeEach(() => {
  spawnMock.mockReset();
  spawnMock.mockImplementation(() => fakeProc({ stdout: 'ok' }));
});

describe('resolveTransport — external SSH', () => {
  it('resolves ssh_target to an external-ssh transport', async () => {
    const services = makeServices({
      profile: { alias: 'acme-box', firstSeenAt: 1, lastSeenAt: 1 },
      sites: [{ name: 'main', account_id: 'acme-box', environment: 'staging' }],
    });
    const transport = await resolveTransport(
      { ssh_target: 'ssh:acme-box@staging' }, services, 'wpcli_read');
    expect(transport).not.toHaveProperty('content');
    expect(transport).not.toHaveProperty('isError');
    if ('kind' in transport) {
      expect(transport.kind).toBe('external-ssh');
      expect(transport.siteRef).toEqual({ kind: 'external', alias: 'acme-box' });
    } else {
      fail('Expected transport, got error result');
    }
  });

  it('rejects a non-external target on the ssh_target arg', async () => {
    const t = await resolveTransport(
      { ssh_target: 'mysite@local' }, makeServices(), 'wpcli_read');
    if (!('content' in t)) fail('Expected a refusal');
    expect(text(t)).toMatch(/Not an external SSH target/);
  });

  it('reports an unparseable ssh target rather than throwing', async () => {
    const t = await resolveTransport(
      { ssh_target: 'ssh:no-environment' }, makeServices(), 'wpcli_read');
    if (!('content' in t)) fail('Expected a refusal');
    expect(text(t)).toMatch(/Incomplete SSH target/);
  });
});

describe('resolveTransport — external connection/site resolution', () => {
  it('a site registered --env production is still gated as production via the bare shorthand with a @development suffix', async () => {
    // The whole point: wpcli is {development:true, staging:true, production:false}
    // by default, so gating on the target string alone would allow this.
    const services = makeServices({
      profile: { alias: 'hostinger-test', firstSeenAt: 1, lastSeenAt: 1 },
      sites: [{ name: 'site-a', account_id: 'hostinger-test', environment: 'production' }],
    });
    const result = await resolveTransport(
      { ssh_target: 'ssh:hostinger-test@development' }, services, 'wpcli');
    expect('content' in result).toBe(true);
    if ('content' in result) {
      expect(text(result)).toMatch(/blocked|not permitted/i);
      expect(text(result)).toContain('production');
      expect(text(result)).toContain('hostinger-test/site-a');
    }
  });

  it('the same regression check via the full /<site> form', async () => {
    const services = makeServices({
      profile: { alias: 'hostinger-test', firstSeenAt: 1, lastSeenAt: 1 },
      sites: [{ name: 'site-a', account_id: 'hostinger-test', environment: 'production' }],
    });
    const result = await resolveTransport(
      { ssh_target: 'ssh:hostinger-test/site-a@development' }, services, 'wpcli');
    expect('content' in result).toBe(true);
    if ('content' in result) expect(text(result)).toMatch(/blocked|not permitted/i);
  });

  it('gates per-site: a development site under a connection with a production sibling is writable', async () => {
    // The environment is the SITE's, not the connection's — the sibling must
    // not leak its label across.
    const services = makeServices({
      profile: { alias: 'multi', firstSeenAt: 1, lastSeenAt: 1 },
      sites: [
        { name: 'live', account_id: 'multi', environment: 'production' },
        { name: 'dev', account_id: 'multi', environment: 'development' },
      ],
    });
    const ok = await resolveTransport(
      { ssh_target: 'ssh:multi/dev@development' }, services, 'wpcli');
    expect('content' in ok).toBe(false);
    const blocked = await resolveTransport(
      { ssh_target: 'ssh:multi/live@development' }, services, 'wpcli');
    expect('content' in blocked).toBe(true);
  });

  it('still allows a read on a production-registered site addressed as @development', async () => {
    // wpcli_read is true on every environment — the floor must not over-block.
    const services = makeServices({
      profile: { alias: 'hostinger-test', firstSeenAt: 1, lastSeenAt: 1 },
      sites: [{ name: 'site-a', account_id: 'hostinger-test', environment: 'production' }],
    });
    const t = await resolveTransport(
      { ssh_target: 'ssh:hostinger-test@development' }, services, 'wpcli_read');
    expect('content' in t).toBe(false);
  });

  it('refuses the write when the target says production too', async () => {
    const services = makeServices({
      profile: { alias: 'hostinger-test', firstSeenAt: 1, lastSeenAt: 1 },
      sites: [{ name: 'site-a', account_id: 'hostinger-test', environment: 'production' }],
    });
    const t = await resolveTransport(
      { ssh_target: 'ssh:hostinger-test/site-a@production' }, services, 'wpcli');
    expect('content' in t).toBe(true);
    // Both labels agree, so there is no "registered as" clarification to add.
    if ('content' in t) expect(text(t)).not.toMatch(/which is what applies/);
  });

  it('lets the target tighten a site registered as development', async () => {
    // Restrictiveness runs both ways: a caller may voluntarily address a
    // development site as production, and the stricter of the two applies.
    const services = makeServices({
      profile: { alias: 'dev-box', firstSeenAt: 1, lastSeenAt: 1 },
      sites: [{ name: 'site-a', account_id: 'dev-box', environment: 'development' }],
    });
    const t = await resolveTransport(
      { ssh_target: 'ssh:dev-box/site-a@production' }, services, 'wpcli');
    expect('content' in t).toBe(true);
  });

  it('allows a write on a site registered as development addressed as development', async () => {
    const services = makeServices({
      profile: { alias: 'dev-box', firstSeenAt: 1, lastSeenAt: 1 },
      sites: [{ name: 'site-a', account_id: 'dev-box', environment: 'development' }],
    });
    const t = await resolveTransport(
      { ssh_target: 'ssh:dev-box@development' }, services, 'wpcli');
    expect('content' in t).toBe(false);
  });

  it('a site row with no environment label is governed by the typed target', async () => {
    const services = makeServices({
      profile: { alias: 'unlabelled', firstSeenAt: 1, lastSeenAt: 1 },
      sites: [{ name: 'site-a', account_id: 'unlabelled', environment: null }],
    });
    const dev = await resolveTransport(
      { ssh_target: 'ssh:unlabelled@development' }, services, 'wpcli');
    expect('content' in dev).toBe(false);
    const prod = await resolveTransport(
      { ssh_target: 'ssh:unlabelled@production' }, services, 'wpcli');
    expect('content' in prod).toBe(true);
  });

  it('a connection with zero registered sites refuses with guidance, and the gate never runs', async () => {
    const services = makeServices({
      profile: { alias: 'empty-conn', firstSeenAt: 1, lastSeenAt: 1 }, sites: [],
    });
    // wpcli_read is permitted everywhere, so a transport would be returned if
    // the gate were what decided this — the refusal must come from resolution.
    const result = await resolveTransport(
      { ssh_target: 'ssh:empty-conn@production' }, services, 'wpcli_read');
    expect('content' in result).toBe(true);
    if ('content' in result) {
      expect(text(result)).toMatch(/no registered sites/i);
      expect(text(result)).toMatch(/nexus host add empty-conn/);
      expect(text(result)).not.toMatch(/blocked/i);
    }
  });

  it('an entirely unregistered alias refuses the same way rather than resolving blind', async () => {
    const result = await resolveTransport(
      { ssh_target: 'ssh:stranger@development' }, makeServices(), 'wpcli_read');
    expect('content' in result).toBe(true);
    if ('content' in result) expect(text(result)).toMatch(/no registered sites/i);
  });

  it('two sites under one connection, bare shorthand, refuses with a disambiguation naming both', async () => {
    const services = makeServices({
      profile: { alias: 'hostinger-test', firstSeenAt: 1, lastSeenAt: 1 },
      sites: [
        { name: 'site-a', account_id: 'hostinger-test', environment: 'production' },
        { name: 'site-b', account_id: 'hostinger-test', environment: 'production' },
      ],
    });
    const result = await resolveTransport(
      { ssh_target: 'ssh:hostinger-test@production' }, services, 'wpcli_read');
    expect('content' in result).toBe(true);
    if ('content' in result) {
      expect(text(result)).toContain('site-a');
      expect(text(result)).toContain('site-b');
      expect(text(result)).toContain('/');
      // The suggestions must be usable verbatim.
      expect(text(result)).toContain('ssh:hostinger-test/site-a@production');
    }
  });

  it('a /<site> naming a site that does not exist under the connection is not-found, distinct from zero-sites', async () => {
    const services = makeServices({
      profile: { alias: 'hostinger-test', firstSeenAt: 1, lastSeenAt: 1 },
      sites: [{ name: 'site-a', account_id: 'hostinger-test', environment: 'production' }],
    });
    const result = await resolveTransport(
      { ssh_target: 'ssh:hostinger-test/nope@production' }, services, 'wpcli_read');
    expect('content' in result).toBe(true);
    if ('content' in result) {
      expect(text(result)).toMatch(/no site "nope"/i);
      expect(text(result)).not.toMatch(/no registered sites/i);
    }
  });

  it('a soft-deleted site is not resolvable (nexus host remove sets is_active=0)', async () => {
    const services = makeServices({
      profile: { alias: 'gone', firstSeenAt: 1, lastSeenAt: 1 },
      sites: [{ name: 'site-a', account_id: 'gone', environment: 'production', is_active: 0 }],
    });
    const bare = await resolveTransport(
      { ssh_target: 'ssh:gone@production' }, services, 'wpcli_read');
    expect('content' in bare).toBe(true);
    const scoped = await resolveTransport(
      { ssh_target: 'ssh:gone/site-a@production' }, services, 'wpcli_read');
    expect('content' in scoped).toBe(true);
  });

  it('a same-named site on another connection is not borrowed', async () => {
    const services = makeServices({
      profile: { alias: 'conn-a', firstSeenAt: 1, lastSeenAt: 1 },
      sites: [{ name: 'shared', account_id: 'conn-b', environment: 'production' }],
    });
    const result = await resolveTransport(
      { ssh_target: 'ssh:conn-a/shared@production' }, services, 'wpcli_read');
    expect('content' in result).toBe(true);
    if ('content' in result) expect(text(result)).toMatch(/no site "shared"/i);
  });

  it('builds a transport with the resolved site\'s wpPath, and the connection\'s wpCliPath', async () => {
    const services = makeServices({
      profile: { alias: 'hostinger-test', wpCliPath: '/usr/bin/wp', firstSeenAt: 1, lastSeenAt: 1 },
      sites: [{
        name: 'site-a', account_id: 'hostinger-test', environment: 'staging',
        wp_path: '/home/u1/site-a',
      }],
    });
    const result = await resolveTransport(
      { ssh_target: 'ssh:hostinger-test/site-a@staging' }, services, 'wpcli_read');
    expect('content' in result).toBe(false);
    if ('content' in result) return;
    expect((result as any).siteRef.alias).toBe('hostinger-test');
    await result.runWpCli(['core', 'version']);
    const remoteCommand = spawnMock.mock.calls[0][1].at(-1);
    expect(remoteCommand).toContain("--path='/home/u1/site-a'");
    expect(remoteCommand).toMatch(/^'\/usr\/bin\/wp' /);
  });

  it('a per-site wp_cli_path overrides the connection default', async () => {
    const services = makeServices({
      profile: { alias: 'h1', wpCliPath: '/usr/bin/wp', firstSeenAt: 1, lastSeenAt: 1 },
      sites: [{
        name: 'site-a', account_id: 'h1', environment: 'production',
        wp_cli_path: '/opt/cpanel/composer/bin/wp',
      }],
    });
    const t = await resolveTransport(
      { ssh_target: 'ssh:h1@production' }, services, 'wpcli_read');
    if ('content' in t) fail('Expected transport, got error');
    await t.runWpCli(['core', 'version']);
    expect(spawnMock.mock.calls[0][1].at(-1)).toMatch(/^'\/opt\/cpanel\/composer\/bin\/wp' /);
  });

  it('uses the stored per-site wp_path when no --path is given', async () => {
    const services = makeServices({
      profile: { alias: 'h1', firstSeenAt: 1, lastSeenAt: 1 },
      sites: [{
        name: 'site-a', account_id: 'h1', environment: 'production',
        wp_path: '/home/u/public_html',
      }],
    });
    const t = await resolveTransport(
      { ssh_target: 'ssh:h1@production' }, services, 'wpcli_read');
    if ('content' in t) fail('Expected transport, got error');
    await t.runWpCli(['core', 'version']);
    expect(spawnMock.mock.calls[0][1].at(-1)).toContain("--path='/home/u/public_html'");
  });

  it('lets an explicit wp_path override the stored one', async () => {
    const services = makeServices({
      profile: { alias: 'h1', firstSeenAt: 1, lastSeenAt: 1 },
      sites: [{
        name: 'site-a', account_id: 'h1', environment: 'production',
        wp_path: '/home/u/public_html',
      }],
    });
    const t = await resolveTransport(
      { ssh_target: 'ssh:h1@production', wp_path: '/srv/other' }, services, 'wpcli_read');
    if ('content' in t) fail('Expected transport, got error');
    await t.runWpCli(['core', 'version']);
    const remoteCommand = spawnMock.mock.calls[0][1].at(-1);
    expect(remoteCommand).toContain("--path='/srv/other'");
    expect(remoteCommand).not.toContain('/home/u/public_html');
  });

  it('omits --path entirely when the site has none stored', async () => {
    const services = makeServices({
      profile: { alias: 'h1', firstSeenAt: 1, lastSeenAt: 1 },
      sites: [{ name: 'site-a', account_id: 'h1', environment: 'production' }],
    });
    const t = await resolveTransport(
      { ssh_target: 'ssh:h1@production' }, services, 'wpcli_read');
    if ('content' in t) fail('Expected transport, got error');
    await t.runWpCli(['core', 'version']);
    expect(spawnMock.mock.calls[0][1].at(-1)).not.toContain('--path');
  });

  it('does not throw when no storage or graph is available at all', async () => {
    const t = await resolveTransport({ ssh_target: 'ssh:h1@development' }, {} as any, 'wpcli');
    // No graph ⇒ no sites ⇒ refusal, but never an exception.
    expect('content' in t).toBe(true);
  });
});
