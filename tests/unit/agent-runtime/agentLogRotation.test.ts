import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { buildAgentContext } from '../../../src/main/agent-runtime/buildAgentContext';
import { rotateIfNeeded, pruneOldFiles } from '../../../src/main/logging/rotate';

const makeAgent = () => ({
  name: 'test-agent',
  version: '1.0.0',
  triggers: [{ type: 'cron' as const, expression: '0 * * * *' }],
  run: async () => {},
});

const makeStubs = (logDir: string) => ({
  toolRegistry: { list: jest.fn().mockReturnValue([]), call: jest.fn() } as any,
  services: {} as any,
  stateStore: { buildHandle: jest.fn().mockReturnValue({ get: jest.fn(), set: jest.fn(), delete: jest.fn(), scratch: {}, isCoolingDown: jest.fn().mockReturnValue(false), setCooldown: jest.fn() }) } as any,
  resolvedProvider: { provider: 'anthropic', apiKey: '', model: 'claude-3-haiku', useLocalGateway: false } as any,
  logDir,
});

describe('agent log rotation and pruning', () => {
  describe('rotation primitive', () => {
    let dir: string;
    beforeEach(() => { dir = fs.mkdtempSync(path.join(os.tmpdir(), 'nexus-agentlog-')); });
    afterEach(() => { fs.rmSync(dir, { recursive: true, force: true }); });

    it('bounds a continuously appended agent.log', () => {
      const logFile = path.join(dir, 'agent.log');
      const line = `[INFO] ${new Date().toISOString()} ${'x'.repeat(200)}\n`;
      for (let i = 0; i < 200; i++) {
        rotateIfNeeded(logFile, 4096, 2);
        fs.appendFileSync(logFile, line);
      }
      expect(fs.statSync(logFile).size).toBeLessThan(4096 + line.length);
      expect(fs.existsSync(`${logFile}.1`)).toBe(true);
      expect(fs.existsSync(`${logFile}.3`)).toBe(false); // keep=2
    });
  });

  describe('pruning primitive', () => {
    let dir: string;
    beforeEach(() => { dir = fs.mkdtempSync(path.join(os.tmpdir(), 'nexus-agentlog-')); });
    afterEach(() => { fs.rmSync(dir, { recursive: true, force: true }); });

    it('prunes old per-run logs and reports, keeping the newest', () => {
      for (let i = 1; i <= 6; i++) {
        const log = path.join(dir, `run-${i}.log`);
        const report = path.join(dir, `run-${i}-report.md`);
        fs.writeFileSync(log, 'log'); fs.writeFileSync(report, 'report');
        const t = new Date(i * 100000);
        fs.utimesSync(log, t, t); fs.utimesSync(report, t, t);
      }
      pruneOldFiles(dir, /^run-.*\.log$/, 3);
      pruneOldFiles(dir, /^run-.*-report\.md$/, 3);

      expect(fs.existsSync(path.join(dir, 'run-6.log'))).toBe(true);
      expect(fs.existsSync(path.join(dir, 'run-1.log'))).toBe(false);
      expect(fs.existsSync(path.join(dir, 'run-6-report.md'))).toBe(true);
      expect(fs.existsSync(path.join(dir, 'run-1-report.md'))).toBe(false);
    });

    it('does not prune agent.log when pruning run-*.log files', () => {
      // Verify that the pruning regex only targets run-*.log and run-*-report.md,
      // not the main agent.log file. This prevents accidental deletion.
      fs.writeFileSync(path.join(dir, 'agent.log'), 'main log');
      for (let i = 1; i <= 5; i++) {
        const log = path.join(dir, `run-${i}.log`);
        fs.writeFileSync(log, `run ${i}`);
        const t = new Date(i * 100000);
        fs.utimesSync(log, t, t);
      }

      pruneOldFiles(dir, /^run-.*\.log$/, 2);

      // agent.log must still exist
      expect(fs.existsSync(path.join(dir, 'agent.log'))).toBe(true);
      // Old run-*.log should be pruned
      expect(fs.existsSync(path.join(dir, 'run-1.log'))).toBe(false);
      expect(fs.existsSync(path.join(dir, 'run-2.log'))).toBe(false);
      // Newest run-*.log should survive
      expect(fs.existsSync(path.join(dir, 'run-5.log'))).toBe(true);
    });
  });

  describe('buildAgentContext wiring', () => {
    let logDir: string;
    beforeEach(() => { logDir = fs.mkdtempSync(path.join(os.tmpdir(), 'nexus-ctx-')); });
    afterEach(() => { fs.rmSync(logDir, { recursive: true, force: true }); });

    it('prunes old per-run logs and reports on context construction', () => {
      // Seed the logDir with old per-run artifacts
      for (let i = 1; i <= 6; i++) {
        const log = path.join(logDir, `run-${i}.log`);
        const report = path.join(logDir, `run-${i}-report.md`);
        fs.writeFileSync(log, `run ${i} log`);
        fs.writeFileSync(report, `run ${i} report`);
        const t = new Date(i * 100000);
        fs.utimesSync(log, t, t);
        fs.utimesSync(report, t, t);
      }

      // Construct context; pruning should run automatically
      buildAgentContext({
        agent: makeAgent(),
        ...makeStubs(logDir),
      });

      // Create more than 20 runs to trigger pruning on the second construct
      for (let i = 7; i <= 25; i++) {
        const log = path.join(logDir, `run-${i}.log`);
        const report = path.join(logDir, `run-${i}-report.md`);
        fs.writeFileSync(log, `run ${i} log`);
        fs.writeFileSync(report, `run ${i} report`);
        const t = new Date(i * 100000);
        fs.utimesSync(log, t, t);
        fs.utimesSync(report, t, t);
      }

      // Construct again; pruning should keep only 20 newest
      buildAgentContext({
        agent: makeAgent(),
        ...makeStubs(logDir),
      });

      // run-1 through run-5 should be deleted (older than top 20)
      expect(fs.existsSync(path.join(logDir, 'run-1.log'))).toBe(false);
      expect(fs.existsSync(path.join(logDir, 'run-1-report.md'))).toBe(false);
      expect(fs.existsSync(path.join(logDir, 'run-5.log'))).toBe(false);
      expect(fs.existsSync(path.join(logDir, 'run-5-report.md'))).toBe(false);

      // run-6 and run-25 should survive (within top 20)
      expect(fs.existsSync(path.join(logDir, 'run-6.log'))).toBe(true);
      expect(fs.existsSync(path.join(logDir, 'run-6-report.md'))).toBe(true);
      expect(fs.existsSync(path.join(logDir, 'run-25.log'))).toBe(true);
      expect(fs.existsSync(path.join(logDir, 'run-25-report.md'))).toBe(true);
    });

    it('rotates agent.log when appending logs (via ctx.log calls)', () => {
      const logFile = path.join(logDir, 'agent.log');

      // Pre-seed agent.log to just over the 5 MiB rotation threshold so that
      // a single ctx.log.info() call triggers rotation. This is fast and will
      // fail immediately if rotateIfNeeded is not wired into appendLog.
      const seedSize = 5 * 1024 * 1024 + 1;
      fs.writeFileSync(logFile, 'x'.repeat(seedSize));

      const { ctx } = buildAgentContext({
        agent: makeAgent(),
        ...makeStubs(logDir),
      });

      // Single log call should trigger rotation
      ctx.log.info('trigger');

      // After rotation, agent.log.1 should exist with the seed content
      expect(fs.existsSync(`${logFile}.1`)).toBe(true);
      expect(fs.statSync(`${logFile}.1`).size).toBe(seedSize);

      // agent.log should now be small (contains only the new log line)
      expect(fs.existsSync(logFile)).toBe(true);
      const currentSize = fs.statSync(logFile).size;
      expect(currentSize).toBeLessThan(1024); // New log line is tiny
    });
  });
});
